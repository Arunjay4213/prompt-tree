// End-to-end regression run of prompt-tree in a real browser.
// Needs the app running in demo mode (`pnpm dev:demo`). Run with `pnpm e2e`.
// Every flow prints PASS or FAIL. The run fails if a flow fails, or if the browser logs a console
// error or warning, a page error, a failed request or an HTTP error that the flow did not expect.
// It creates conversations titled "E2E ..." and deletes them at the end.

import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const URL = "http://localhost:5173";
const TITLE = "E2E ";

try {
  const res = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(3000) });
  const health = await res.json();
  if (health.mode !== "demo") throw new Error(`the server runs in "${health.mode}" mode`);
  if (!Array.isArray(health.models) || health.models.length < 2) throw new Error("the server does not list the two demo models");
} catch (err) {
  console.error(`The app does not answer in demo mode at ${URL} (${err.message}).`);
  console.error("Start it with `pnpm dev:demo` and run `pnpm e2e` again.");
  process.exit(1);
}

// ---------- API helpers ----------

const api = {
  list: async () => (await fetch(`${URL}/api/conversations`)).json(),
  get: async (id) => {
    const res = await fetch(`${URL}/api/conversations/${id}`);
    return res.status === 200 ? res.json() : null;
  },
  put: (conv) => fetch(`${URL}/api/conversations/${conv.id}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Base-Version": "new" }, body: JSON.stringify(conv) }),
  del: (id) => fetch(`${URL}/api/conversations/${id}`, { method: "DELETE" }),
};
async function deleteOurConversations() {
  for (const c of await api.list()) if (c.title.startsWith(TITLE)) await api.del(c.id);
}
// The saved JSON without the save stamp, for comparing two saves.
const normalized = (conv) => JSON.stringify({ ...conv, updatedAt: 0 });

// ---------- browser, and the problems it reports ----------

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(10_000);

let problems = []; // unexpected browser problems in the current flow
let expected = []; // { pattern, left } problems the current flow causes on purpose
function report(text) {
  const allow = expected.find((e) => e.left > 0 && e.pattern.test(text));
  if (allow) allow.left -= 1;
  else problems.push(text);
}
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") report(`console.${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => report(`page error: ${e.message}`));
page.on("requestfailed", (r) => report(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) report(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
});
page.on("dialog", (d) => {
  report(`native dialog: ${d.message()}`);
  void d.dismiss();
});
// A request to /api/complete that the flow aborts on purpose (Stop, delete).
const expectAbortedAnswer = (times = 1) => expected.push({ pattern: /request failed: POST .*\/api\/complete net::ERR_ABORTED/, left: times });

const results = [];
async function flow(name, fn) {
  problems = [];
  expected = [];
  let detail;
  let ok = true;
  try {
    detail = (await fn()) ?? "";
  } catch (err) {
    ok = false;
    detail = err.message.split("\n")[0];
    // Set E2E_SHOT_DIR to keep a screenshot of each failed flow.
    if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/fail-${name.split(" ")[0]}.png` }).catch(() => {});
  }
  await page.waitForTimeout(150);
  if (problems.length > 0) {
    ok = false;
    detail += ` | browser: ${problems.slice(0, 3).join(" ; ")}`;
  }
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- page helpers ----------

const composer = () => page.getByTestId("composer-input");
const card = (threadId) => page.getByTestId(`card-${threadId}`);
const panelTurn = (turnId) => page.getByTestId(`turn-panel-${turnId}`);
const sidebarRow = (id) => page.locator(`[data-conversation-id="${id}"]`);
const openId = () => page.evaluate(() => localStorage.getItem("prompt-tree:last-conversation"));
const settle = () => page.waitForFunction(() => document.querySelectorAll(".live-dot").length === 0, null, { timeout: 15_000 });
const visibleCards = () => page.$$eval(".pt-slot[data-phase='shown'] article", (els) => els.map((e) => e.dataset.testid.slice(5)));
const pathNumber = (threadId) => card(threadId).locator("header span.num").first().innerText();
const panelWidth = () => page.locator('aside[aria-label="Thread and output"]').evaluate((el) => el.parentElement.getBoundingClientRect().width);

// Waits until the top bar says SAVED, then returns what the server has.
async function saved(id) {
  await page.waitForFunction(() => {
    const text = document.querySelector("main > header")?.innerText ?? "";
    return /\bSAVED\b/.test(text) && !/NOT SAVED|SAVING/.test(text);
  });
  return api.get(id ?? (await openId()));
}
async function send(text, keys = "Enter") {
  await composer().fill(text);
  await composer().press(keys);
  await page.waitForTimeout(150);
  await settle();
}
// Fits the view (so every card is on screen) and selects a card by its header.
async function select(threadId) {
  await page.getByTestId("canvas-fit").click();
  await page.waitForTimeout(500);
  await card(threadId).click({ position: { x: 80, y: 14 } });
  await page.waitForTimeout(200);
}
async function answerOf(turnId) {
  return page.locator(`[data-answer-turn="${turnId}"]`).innerText();
}
async function openConversation(id) {
  await sidebarRow(id).locator("button").first().click();
  await page.waitForSelector(`[data-conversation-id="${id}"] button[aria-current="page"]`);
  await page.waitForTimeout(300);
}
// Selects the given text inside an answer, the way a mouse drag would end.
async function selectInAnswer(turnId, text) {
  await page.evaluate(
    ({ turnId, text }) => {
      const answer = document.querySelector(`[data-answer-turn="${turnId}"]`);
      const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const at = node.textContent.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      throw new Error(`"${text}" not found in the answer`);
    },
    { turnId, text },
  );
  await page.waitForTimeout(200);
}

// ---------- the flows ----------

await deleteOurConversations();
await page.goto(URL);
await page.waitForLoadState("networkidle");

// State shared by the flows that build one tree.
let mainId;
let root; // the root thread, as saved
const ids = {}; // thread ids by path number

await flow("a first prompt on the start screen", async () => {
  await page.keyboard.press("Alt+n");
  await page.getByLabel("First question").waitFor();
  await page.waitForTimeout(500); // the panel slides out in 300 ms
  check((await panelWidth()) === 0, "the right panel is shown before the first prompt");
  await page.getByLabel("First question").fill(`${TITLE}main: how should I plan a trip?`);
  await page.keyboard.press("Enter");
  await page.waitForSelector("article[data-testid^='card-']");
  await page.waitForSelector(".live-dot");
  await settle();
  await page.waitForTimeout(400);
  // The default width: half of the area right of the sidebar (248px), between 560 and 820.
  const expectedWidth = Math.round(Math.min(820, Math.max(560, (1600 - 248) / 2)));
  check((await panelWidth()) === expectedWidth, `panel width after the first prompt is ${await panelWidth()}, not ${expectedWidth}`);
  mainId = await openId();
  const conv = await saved(mainId);
  root = conv.threads[0];
  ids.ROOT = root.id;
  check(root.turns[0].status === "complete", `turn status is ${root.turns[0].status}`);
  check((await answerOf(root.turns[0].id)).includes("(turn 1)"), "the answer did not stream in");
  check(await sidebarRow(mainId).count(), "the conversation is not listed in the sidebar");
  return "panel hidden, then shown; answer complete and listed";
});

await flow("b continue twice", async () => {
  await send("What should I pack?");
  await send("How early should I book?");
  const conv = await saved(mainId);
  root = conv.threads[0];
  check(conv.threads.length === 1, `${conv.threads.length} threads`);
  check(root.turns.length === 3, `${root.turns.length} turns`);
  check((await visibleCards()).length === 1, "more than one card");
  check((await card(root.id).locator("[data-turn-row]").count()) === 3, "the card does not show three turns");
  check((await answerOf(root.turns[2].id)).includes("(turn 3)"), "the third answer does not see two earlier turns");
  return "one card, three turns";
});

await flow("c branch off and branch", async () => {
  await send("Side question: what about trains?", "Control+Enter");
  await select(root.id);
  await panelTurn(root.turns[0].id).getByTestId("turn-branch").click();
  await page.waitForTimeout(200);
  check((await composer().evaluate((el) => el === document.activeElement)), "Branch did not focus the composer");
  await send("Early side question: is it the right season?");
  const conv = await saved(mainId);
  const off = conv.threads.find((t) => t.turns[0]?.prompt.startsWith("Side question"));
  const early = conv.threads.find((t) => t.turns[0]?.prompt.startsWith("Early side"));
  check(off && early, "a branch is missing");
  check(off.parent.turnId === root.turns[2].id && early.parent.turnId === root.turns[0].id, "a branch leaves from the wrong turn");
  ids["1"] = early.id;
  ids["2"] = off.id;
  check((await pathNumber(early.id)) === "1" && (await pathNumber(off.id)) === "2", "wrong path numbers for the branches");
  await select(off.id);
  check((await answerOf(off.turns[0].id)).includes("(turn 4)"), "Branch off does not see the three root turns");
  await select(early.id);
  check((await answerOf(early.turns[0].id)).includes("(turn 2)"), "Branch from turn 1 does not see exactly one root turn");
  return "branches 1 (from turn 1, context 1 turn) and 2 (after turn 3, context 3 turns)";
});

await flow("d a branch of a branch", async () => {
  await select(ids["1"]);
  await send("Deeper: which month exactly?", "Control+Enter");
  const conv = await saved(mainId);
  const deep = conv.threads.find((t) => t.turns[0]?.prompt.startsWith("Deeper"));
  ids["1.1"] = deep.id;
  check((await answerOf(deep.turns[0].id)).includes("(turn 3)"), "the branch of a branch has the wrong context");
  const numbers = [];
  for (const id of [ids.ROOT, ids["1"], ids["1.1"], ids["2"]]) numbers.push(await pathNumber(id));
  check(numbers.join(",") === "ROOT,1,1.1,2", `path numbers are ${numbers.join(",")}`);
  return "ROOT, 1, 1.1, 2";
});

await flow("e path marking and keyboard selection", async () => {
  await select(ids["1.1"]);
  const state = async (id) => card(id).getAttribute("data-path-state");
  const states = [await state(ids["1.1"]), await state(ids["1"]), await state(ids.ROOT), await state(ids["2"])];
  check(states.join(",") === "selected,path,path,normal", `path states are ${states.join(",")}`);
  const selected = async () => (await page.locator("article[aria-current='true']").getAttribute("data-testid")).slice(5);
  const walk = [];
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    const now = await selected();
    walk.push(Object.keys(ids).find((k) => ids[k] === now));
  }
  check(walk.join(" ") === "1 ROOT 1 2 1", `arrow keys went ${walk.join(" ")}`);
  return "path marked; arrows went 1 ROOT 1 2 1";
});

await flow("f fold, hide branches, fold all", async () => {
  await select(ids.ROOT);
  // Fold and open through the panel's card menu ("Collapse card" / "Expand card"); the card's own
  // fold button can be hidden when "fit" zooms into the overview look.
  const rootView = async () => (await saved(mainId)).threads[0].cardView;
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-fold").click();
  check((await rootView()) === "folded", "the card did not fold");
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-fold").click();
  check((await rootView()) === "open", "the card did not open");
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-branches").click();
  await page.waitForTimeout(400);
  check((await visibleCards()).length === 1, "branches are still drawn");
  check((await saved(mainId)).threads[0].branchesView === "hidden", "hidden branches were not saved");
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-branches").click();
  await page.waitForTimeout(400);
  check((await visibleCards()).length === 4, "branches did not come back");
  await page.getByRole("button", { name: "Fold all cards" }).click();
  let conv = await saved(mainId);
  check(conv.threads.every((t) => t.cardView === "folded"), "Fold all did not fold every card");
  check((await page.locator(".pt-body").count()) === 0, "a card body is still drawn");
  await page.getByRole("button", { name: "Open all cards" }).click();
  conv = await saved(mainId);
  check(conv.threads.every((t) => t.cardView === "open"), "Open all did not open every card");
  return "fold, open, hide, show, fold all, open all";
});

await flow("g split off then merge into parent", async () => {
  const before = await saved(mainId);
  await select(ids.ROOT);
  await panelTurn(root.turns[2].id).getByTestId("turn-more").click();
  await page.getByTestId("turn-split").click();
  let conv = await saved(mainId);
  check(conv.threads.length === before.threads.length + 1 && conv.threads[0].turns.length === 2, "split did not make a new card");
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-merge").click();
  conv = await saved(mainId);
  check(normalized(conv) === normalized(before), "the saved JSON differs from before the split");
  return "identical saved JSON after split and merge";
});

await flow("h clips and combine", async () => {
  await select(ids.ROOT);
  await panelTurn(root.turns[0].id).getByTestId("turn-clip").click();
  await panelTurn(root.turns[1].id).scrollIntoViewIfNeeded();
  await selectInAnswer(root.turns[1].id, "Each branch only sees its own path");
  await page.getByTestId("selection-bar").getByRole("button", { name: "Add to output" }).click();
  let conv = await saved(mainId);
  check(conv.clips.length === 2 && conv.clips[1].kind === "excerpt", "the two clips were not saved");
  check(conv.clips[1].text === "Each branch only sees its own path", `excerpt text is "${conv.clips[1].text}"`);
  await page.getByTestId("tab-output").click();
  const second = page.getByTestId(`clip-${conv.clips[1].id}`);
  await second.hover();
  await second.getByRole("button", { name: "Move up" }).click();
  conv = await saved(mainId);
  check(conv.clips[0].kind === "excerpt", "Move up did not reorder");
  await page.getByTestId("combine-run").click();
  await page.waitForSelector("[data-testid='combine-stop']");
  await settle();
  conv = await saved(mainId);
  check(conv.output.status === "complete", `output status is ${conv.output.status}`);
  check((await page.getByTestId("output-document").innerText()).includes("combined document"), "the document is not shown");
  await page.getByTestId("tab-thread").click();
  return "answer and excerpt clipped, reordered, combined";
});

await flow("i reload keeps everything", async () => {
  const before = await saved(mainId);
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  await page.waitForTimeout(800);
  const after = await api.get(mainId);
  check(normalized(after) === normalized(before), "the saved JSON changed on reload");
  check((await visibleCards()).length === before.threads.length, "not every card is drawn");
  await page.getByTestId("tab-output").click();
  check((await page.locator("[data-testid^='clip-']").filter({ has: page.getByTestId("clip-text") }).count()) === 2, "clips are missing");
  check((await page.getByTestId("output-document").count()) === 1, "the combined document is missing");
  await page.getByTestId("tab-thread").click();
  return "tree, clips and output unchanged";
});

await flow("j delete a branch with a child and a clip", async () => {
  await select(ids["1"]);
  await panelTurn((await api.get(mainId)).threads.find((t) => t.id === ids["1"]).turns[0].id).getByTestId("turn-clip").click();
  let conv = await saved(mainId);
  check(conv.clips.length === 3, "the clip was not added");
  await page.getByTestId("header-menu").click();
  await page.getByTestId("header-delete").click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  conv = await saved(mainId);
  check(conv.threads.length === 2, `${conv.threads.length} threads left`);
  check(!conv.threads.some((t) => t.id === ids["1.1"]), "the child was not deleted");
  check(conv.clips.length === 2, `${conv.clips.length} clips left`);
  check((await visibleCards()).length === 2, "deleted cards are still drawn");
  check((await page.locator("article[aria-current='true']").getAttribute("data-testid")) === `card-${ids.ROOT}`, "the parent is not selected");
  return "branch, child and clip gone; parent selected";
});

await flow("k switching conversations keeps an answer streaming", async () => {
  const other = { id: randomUUID(), title: `${TITLE}other`, createdAt: Date.now(), updatedAt: Date.now(), clips: [], output: { status: "empty", text: "", instruction: "", error: null, model: null } };
  other.threads = [{ id: randomUUID(), parent: null, title: other.title, cardView: "open", branchesView: "shown", createdAt: Date.now(), turns: [{ id: randomUUID(), prompt: "Hi", answer: "Hello.", status: "complete", error: null, model: null, createdAt: Date.now() }] }];
  await api.put(other);
  await page.reload();
  await page.waitForSelector(`[data-conversation-id="${other.id}"]`);
  await select(ids.ROOT);
  await composer().fill("An answer that finishes in the background");
  await composer().press("Enter");
  await page.waitForSelector(".live-dot");
  await openConversation(other.id);
  check((await sidebarRow(mainId).locator(".live-dot").count()) === 1, "the sidebar does not show the live answer");
  await page.waitForTimeout(3500);
  const conv = await api.get(mainId);
  const last = conv.threads[0].turns.at(-1);
  check(last.status === "complete" && last.answer.includes("End of the placeholder answer from"), `background turn is ${last.status}`);
  await openConversation(mainId);
  root = conv.threads[0];
  return "completed and saved in the background";
});

await flow("l stop then retry", async () => {
  expectAbortedAnswer();
  await select(ids.ROOT);
  await composer().fill("Stop me halfway");
  await composer().press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-testid='turn-stop']") && document.querySelectorAll("[data-answer-turn]").length > 0);
  await page.waitForTimeout(300);
  await page.getByTestId("turn-stop").click();
  let conv = await saved(mainId);
  let last = conv.threads[0].turns.at(-1);
  check(last.status === "stopped" && last.answer.length > 0, `after Stop the turn is ${last.status}`);
  await page.getByTestId("turn-retry").click();
  await page.waitForTimeout(150);
  await settle();
  conv = await saved(mainId);
  last = conv.threads[0].turns.at(-1);
  check(last.status === "complete" && last.answer.includes("End of the placeholder answer from"), `after Retry the turn is ${last.status}`);
  root = conv.threads[0];
  return "stopped with partial text, retried to complete";
});

await flow("m delete a conversation right after sending", async () => {
  expectAbortedAnswer();
  await page.keyboard.press("Alt+n");
  await page.getByLabel("First question").fill(`${TITLE}delete me`);
  await page.keyboard.press("Enter");
  await page.waitForFunction((t) => [...document.querySelectorAll("[data-conversation-id]")].some((r) => r.innerText.includes(t) && !r.innerText.includes("NOT SAVED")), `${TITLE}delete me`);
  const id = await openId();
  const row = sidebarRow(id);
  await row.hover();
  await row.getByRole("button", { name: "Delete conversation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(3000);
  check((await api.get(id)) === null, "the conversation still exists on the server");
  await page.reload();
  await page.waitForLoadState("networkidle");
  check((await sidebarRow(id).count()) === 0, "the conversation is listed again after a reload");
  await openConversation(mainId);
  return "gone after 3 s and after a reload";
});

await flow("n sidebar and panel width survive a reload", async () => {
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.waitForTimeout(400);
  const start = await panelWidth();
  const handle = page.getByRole("separator", { name: "Resize the panel" });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x - 97, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check((await panelWidth()) === start + 100, `panel width after dragging is ${await panelWidth()}, not ${start + 100}`);
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  await page.waitForTimeout(500);
  const sidebar = await page.locator('aside[aria-label="Conversations"]').evaluate((el) => el.getBoundingClientRect().width);
  check(sidebar === 0, `sidebar is ${sidebar}px wide after reload`);
  check((await panelWidth()) === start + 100, `panel is ${await panelWidth()}px after reload`);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.evaluate(() => localStorage.removeItem("prompt-tree:panel-width"));
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  return `collapsed sidebar and ${start + 100}px panel kept`;
});

await flow("o rename the conversation and a thread", async () => {
  await page.locator("main > header").getByRole("button", { name: /E2E main/ }).click();
  await page.getByLabel("Conversation title").fill(`${TITLE}main renamed`);
  await page.keyboard.press("Enter");
  await select(ids["2"]);
  await page.getByTestId("thread-title").click();
  await page.getByLabel("Thread title").fill("Trains");
  await page.keyboard.press("Enter");
  const conv = await saved(mainId);
  check(conv.title === `${TITLE}main renamed`, `conversation title is "${conv.title}"`);
  check(conv.threads.find((t) => t.id === ids["2"]).title === "Trains", "thread title not saved");
  check((await card(ids["2"]).locator("[data-card-title]").innerText()) === "Trains", "card title not updated");
  check((await sidebarRow(mainId).innerText()).includes("main renamed"), "sidebar not updated");
  return "both saved and shown";
});

await flow("p geometry", async () => {
  // A wider tree for the check: two more branches from the root's first turn.
  await select(ids.ROOT);
  for (const prompt of ["Geometry one", "Geometry two"]) {
    await select(ids.ROOT);
    await panelTurn(root.turns[0].id).getByTestId("turn-branch").click();
    await send(prompt);
  }
  await page.getByTestId("canvas-fit").click();
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => {
    const issues = [];
    const at = (el) => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const cards = [...document.querySelectorAll(".pt-slot[data-phase='shown']")].map((slot) => {
      const article = slot.querySelector("article");
      const p = at(slot);
      const ports = [...slot.querySelectorAll(".pt-port")].map((el) => ({ x: p.x + el.offsetLeft + 3.5, y: p.y + el.offsetTop + 3.5 }));
      return { id: article.dataset.testid.slice(5), ...p, w: article.offsetWidth, h: article.offsetHeight, ports };
    });
    for (const a of cards)
      for (const b of cards)
        if (a.id < b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) issues.push(`cards overlap`);
    const edges = [...document.querySelectorAll(".pt-edge")];
    for (const edge of edges) {
      const n = edge.getAttribute("d").match(/-?[\d.]+/g).map(Number);
      const child = cards.find((c) => c.id === edge.dataset.edge);
      if (!child) {
        issues.push("an edge leads to a card that is not drawn");
        continue;
      }
      if (!cards.some((c) => c.ports.some((p) => Math.abs(p.x - n[0]) <= 1 && Math.abs(p.y - n[1]) <= 1))) issues.push("an edge starts off its port");
      if (Math.abs(n.at(-2) - child.x) > 1 || Math.abs(n.at(-1) - (child.y + 20)) > 1) issues.push("an edge ends off the child header");
    }
    return { issues, cards: cards.length, edges: edges.length };
  });
  check(result.cards === 4 && result.edges === 3, `${result.cards} cards and ${result.edges} edges`);
  check(result.issues.length === 0, result.issues.join(", "));
  return `${result.cards} cards, ${result.edges} edges, no overlap, edges on ports and headers`;
});

await flow("q a different model per branch", async () => {
  const pick = async (id) => {
    await page.getByTestId("model-picker").first().click();
    await page.getByTestId(`model-option-${id}`).click();
    await page.waitForTimeout(150);
  };
  await page.keyboard.press("Alt+n");
  await page.getByLabel("First question").waitFor();
  await pick("demo:placeholder-a");
  await page.getByLabel("First question").fill(`${TITLE}models: answered by A`);
  await page.keyboard.press("Enter");
  await page.waitForSelector("article[data-testid^='card-']");
  await settle();
  await pick("demo:placeholder-b");
  await send("Branched off and answered by B", "Control+Enter");
  const conv = await saved();
  const [rootThread, branch] = conv.threads;
  const a = rootThread.turns[0];
  const b = branch.turns[0];
  check(a.model === "demo:placeholder-a" && b.model === "demo:placeholder-b", `saved models ${a.model} and ${b.model}`);
  check(b.answer.includes("placeholder-b") && a.answer.includes("placeholder-a"), "each answer names its model");
  const label = async (threadId, turnId) => {
    await select(threadId);
    return (await panelTurn(turnId).getByTestId("turn-model").innerText()).trim();
  };
  check((await label(branch.id, b.id)) === "PLACEHOLDER-B", "branch label");
  check((await label(rootThread.id, a.id)) === "PLACEHOLDER-A", "root label");
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  await page.waitForTimeout(500);
  check((await label(branch.id, b.id)) === "PLACEHOLDER-B" && (await label(rootThread.id, a.id)) === "PLACEHOLDER-A", "labels after reload");
  check((await page.getByTestId("model-picker").first().innerText()).trim() === "placeholder-b", "the choice survives the reload");
  await pick("demo:placeholder-a"); // leave the default choice for the next run
  return "A on the root, B on the branch, labels and choice kept after reload";
});

// An answer with three option headings, for the option flows.
const OPTIONS = ["Option 1: Trains", "Option 2: Car", "Option 3: Bus"];
const OPTIONS_ANSWER = `Three ways:\n\n${OPTIONS.map((o) => `### ${o}\n\n- one detail\n- another detail`).join("\n\n")}`;
function seedOptions(title) {
  const c = { id: randomUUID(), title: `${TITLE}${title}`, titleSource: "user", createdAt: Date.now(), updatedAt: Date.now(), clips: [], output: { status: "empty", text: "", instruction: "", error: null, model: null } };
  c.threads = [{ id: randomUUID(), parent: null, title: c.title, titleSource: "user", cardView: "open", branchesView: "shown", createdAt: Date.now(), turns: [{ id: randomUUID(), prompt: "How should I travel?", answer: OPTIONS_ANSWER, status: "complete", error: null, model: "demo:placeholder-a", createdAt: Date.now() }] }];
  return c;
}

await flow("r New branch with an empty box; an empty branch with a draft is kept", async () => {
  await openConversation(mainId);
  await select(ids.ROOT);
  const before = (await saved(mainId)).threads.length;
  await composer().fill("");
  await page.getByTestId("composer-branch").click();
  await page.waitForTimeout(300);
  check((await page.getByTestId("thread-title").innerText()) === "New branch", "no empty branch is selected");
  check(await composer().evaluate((el) => el === document.activeElement), "the new branch's box is not focused");
  await composer().fill("A draft for later");
  await page.waitForTimeout(600);
  await select(ids.ROOT);
  let conv = await saved(mainId);
  const kept = conv.threads.find((t) => t.turns.length === 0);
  check(conv.threads.length === before + 1 && kept, "the empty branch with a draft was discarded");
  await select(kept.id);
  check((await composer().inputValue()) === "A draft for later", "its draft is gone");
  await composer().fill("");
  await select(ids.ROOT);
  conv = await saved(mainId);
  check(conv.threads.length === before, "an empty branch without a draft stayed");
  return "empty branch made and focused; kept with a draft, dropped without";
});

await flow("s Branch per option: one, then all", async () => {
  const c = seedOptions("options");
  await api.put(c);
  await page.reload();
  await page.waitForSelector(`[data-conversation-id="${c.id}"]`);
  await openConversation(c.id);
  const last = c.threads[0].turns[0];
  const turn = panelTurn(last.id);
  check((await turn.getByTestId("option-block").count()) === 1, "no option block under the answer");
  await turn.getByTestId("option-0").click();
  await page.waitForTimeout(300);
  check((await page.getByTestId("thread-title").innerText()) === OPTIONS[0], "the branch is not titled with the option");
  check((await composer().inputValue()) === `> ${OPTIONS[0]}\n\n`, "the draft is not the quoted option");
  const branchCard = (await saved(c.id)).threads.find((t) => t.title === OPTIONS[0]);
  check((await card(branchCard.id).locator("header").innerText()).includes(OPTIONS[0]), "the empty option card does not show its title");
  await select(c.threads[0].id);
  check((await panelTurn(last.id).getByTestId("option-0").getAttribute("data-has-branch")) === "yes", "option 1 is not shown as a link");
  await panelTurn(last.id).getByTestId("options-branch-all").click();
  await page.waitForTimeout(400);
  check((await page.getByTestId("thread-title").innerText()) === OPTIONS[0], "Branch all did not select the first option's branch");
  const conv = await saved(c.id);
  const optionThreads = conv.threads.filter((t) => t.parent?.turnId === last.id && OPTIONS.includes(t.title));
  check(optionThreads.length === 3 && optionThreads.every((t) => t.titleSource === "user"), `${optionThreads.length} option branches`);
  return "one branch from an option (its card shows the title), then the other two with Branch all";
});

await flow("t reading mode survives a reload", async () => {
  await page.getByTestId("reading-mode").click();
  await page.waitForTimeout(450);
  const wide = Math.floor(1600 * 0.7);
  check((await panelWidth()) === wide, `reading width ${await panelWidth()}, not ${wide}`);
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  await page.waitForTimeout(500);
  check((await panelWidth()) === wide, `after reload ${await panelWidth()}`);
  await page.getByTestId("reading-mode").click();
  await page.waitForTimeout(450);
  check((await panelWidth()) < wide, "the normal width did not come back");
  return `${wide}px, kept after reload, back to normal`;
});

await flow("u Ask each splits one question across the options", async () => {
  const c = { id: randomUUID(), title: `${TITLE}ask each`, titleSource: "user", createdAt: Date.now(), updatedAt: Date.now(), clips: [], output: { status: "empty", text: "", instruction: "", error: null, model: null } };
  const answer = "Two ways:\n\n### Option 1: Trains\n\n- fast\n- scenic\n\n### Option 2: Car\n\n- flexible\n- cheap";
  c.threads = [{ id: randomUUID(), parent: null, title: c.title, titleSource: "user", cardView: "open", branchesView: "shown", createdAt: Date.now(), turns: [{ id: randomUUID(), prompt: "How should I travel?", answer, status: "complete", error: null, model: "demo:placeholder-a", createdAt: Date.now() }] }];
  await api.put(c);
  await page.reload();
  await page.waitForSelector(`[data-conversation-id="${c.id}"]`);
  await openConversation(c.id);
  await composer().fill("What does each cost?");
  const button = page.getByTestId("composer-ask-each");
  check((await button.innerText()).includes("2"), "Ask each does not show the option count");
  await button.click();
  await page.waitForSelector(".live-dot");
  await settle();
  const conv = await saved(c.id);
  const kids = conv.threads.filter((t) => t.parent?.turnId === c.threads[0].turns[0].id);
  check(kids.length === 2, `${kids.length} branches`);
  check(kids.map((k) => k.title).join(" | ") === "Option 1: Trains | Option 2: Car", `titles ${kids.map((k) => k.title).join(" | ")}`);
  check(kids.every((k, i) => k.turns[0].prompt === `> ${["Option 1: Trains", "Option 2: Car"][i]}\n\nWhat does each cost?`), "the prompts are not the quoted option plus the question");
  check(kids.every((k) => k.turns[0].status === "complete" && k.turns[0].answer.includes("(turn 2)")), "an answer did not complete with the path through the parent turn");
  check((await page.getByTestId("thread-title").innerText()) === "Option 1: Trains", "the first new branch is not selected");
  check((await composer().inputValue()) === "", "the box was not cleared");
  await page.reload();
  await page.waitForSelector("article[data-testid^='card-']");
  const again = await api.get(c.id);
  check(again.threads.length === 3, "the branches did not survive a reload");
  return "two option branches, quoted prompts, both answered, kept after reload";
});

await deleteOurConversations();
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\nAll ${results.length} flows passed.` : `\n${failed} of ${results.length} flows failed.`);
process.exit(failed === 0 ? 0 : 1);
