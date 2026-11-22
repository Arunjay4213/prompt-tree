// Smoke run of the main path of prompt-tree in a real browser, about a minute.
// Needs the app running in demo mode (`pnpm dev:demo`). Run with `pnpm e2e`.
// Each step prints PASS or FAIL. The run fails on a failed step, a page error or a console error.
// It creates conversations titled "E2E ..." and deletes them at the end.

import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const URL = "http://localhost:5173";
const TITLE = "E2E ";
const STEP_MS = 20_000;

let health;
try {
  health = await (await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(3000) })).json();
  if (health.mode !== "demo") throw new Error(`the server runs in "${health.mode}" mode`);
  if (health.models.length < 2) throw new Error("the server does not list the two demo models");
} catch (err) {
  console.error(`The app does not answer in demo mode at ${URL} (${err.message}).`);
  console.error("Start it with `pnpm dev:demo` and run `pnpm e2e` again.");
  process.exit(1);
}

const api = {
  list: async () => (await fetch(`${URL}/api/conversations`)).json(),
  get: async (id) => (await fetch(`${URL}/api/conversations/${id}`)).json(),
  put: (conv) => fetch(`${URL}/api/conversations/${conv.id}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Base-Version": "new" }, body: JSON.stringify(conv) }),
};
async function deleteOurConversations() {
  for (const c of await api.list()) if (c.title.startsWith(TITLE)) await fetch(`${URL}/api/conversations/${c.id}`, { method: "DELETE" });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls get() until ok(value) holds (for example the saved conversation in the expected state).
async function until(get, ok, what) {
  for (const end = Date.now() + STEP_MS; Date.now() < end; await sleep(100)) {
    const value = await get();
    if (ok(value)) return value;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const done = (turn) => turn?.status === "complete";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(STEP_MS);
let problems = []; // page errors and console errors in the current step
page.on("console", (m) => m.type() === "error" && problems.push(`console error: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

let failed = false;
async function step(name, fn) {
  if (failed) return console.log(`SKIP ${name}`);
  problems = [];
  let detail;
  try {
    let timer;
    const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`step took over ${STEP_MS / 1000} s`)), STEP_MS)));
    detail = await Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
    if (problems.length > 0) throw new Error(`browser: ${problems.slice(0, 3).join(" ; ")}`);
  } catch (err) {
    failed = true;
    detail = err.message.split("\n")[0];
  }
  console.log(`${failed ? "FAIL" : "PASS"} ${name}: ${detail}`);
}

const composer = () => page.getByTestId("composer-input");
const card = (threadId) => page.getByTestId(`card-${threadId}`);
const panelTurn = (turnId) => page.getByTestId(`turn-panel-${turnId}`);
const visibleCards = () => page.locator(".pt-slot[data-phase='shown'] article").count();
const answerShows = (turnId, text) => page.locator(`[data-answer-turn="${turnId}"]`, { hasText: text }).waitFor();
const modelLabel = async (turnId) => (await panelTurn(turnId).getByTestId("turn-model").innerText()).trim().toLowerCase();
async function send(text, keys = "Enter") {
  await composer().fill(text);
  await composer().press(keys);
}
// Fits the view (so every card is on screen) and selects a card by its header.
async function select(threadId) {
  await page.getByTestId("canvas-fit").click();
  await card(threadId).click({ position: { x: 80, y: 14 } });
  await page.locator(`article[aria-current="true"][data-testid="card-${threadId}"]`).waitFor();
}
const openConversation = async (id) => {
  await page.locator(`[data-conversation-id="${id}"] button`).first().click();
  await page.locator(`[data-conversation-id="${id}"] button[aria-current="page"]`).waitFor();
};

await deleteOurConversations();
await page.goto(URL);
let mainId, rootId, branchId, other; // other: the demo model the first answers did not use
const main = () => api.get(mainId);
await step("1 start", async () => {
  await page.keyboard.press("Alt+n");
  await page.getByLabel("First question").fill(`${TITLE}main: how should I plan a trip?`);
  await page.keyboard.press("Enter");
  const ours = async () => {
    const row = (await api.list()).find((c) => c.title.startsWith(`${TITLE}main`));
    return row ? api.get(row.id) : null;
  };
  const conv = await until(ours, (c) => done(c?.threads[0].turns[0]), "the first answer to complete and save");
  mainId = conv.id;
  rootId = conv.threads[0].id;
  await answerShows(conv.threads[0].turns[0].id, "(turn 1)");
  return "answer streamed, completed and saved";
});

await step("2 send", async () => {
  await send("What should I pack?");
  const conv = await until(main, (c) => done(c.threads[0].turns[1]), "the second answer");
  check(conv.threads.length === 1, `${conv.threads.length} threads`);
  check((await visibleCards()) === 1, "more than one card");
  check((await card(rootId).locator("[data-turn-row]").count()) === 2, "the card does not show two turns");
  await answerShows(conv.threads[0].turns[1].id, "(turn 2)");
  return "one card, two turns";
});

await step("3 new branch", async () => {
  await send("Side question: what about trains?", "Control+Enter");
  const conv = await until(main, (c) => c.threads.length === 2 && done(c.threads[1].turns[0]), "the branch answer");
  const branch = conv.threads[1];
  branchId = branch.id;
  other = health.models.find((m) => m.id !== branch.turns[0].model);
  check(branch.parent.turnId === conv.threads[0].turns[1].id, "the branch leaves from the wrong turn");
  await until(visibleCards, (n) => n === 2, "two cards");
  check((await card(branchId).locator("header span.num").first().innerText()) === "1", "the branch is not path 1");
  await select(branchId);
  await answerShows(branch.turns[0].id, "(turn 3)");
  return "card 1 sees the two root turns and its own prompt";
});

await step("4 model per branch", async () => {
  await page.getByTestId("model-picker").first().click();
  await page.getByTestId(`model-option-${other.id}`).click();
  await send("Answer this one with the other model");
  const turn = await until(async () => (await main()).threads[1].turns[1], done, "the answer from the other model");
  check(turn.model === other.id, `saved model is ${turn.model}`);
  check(turn.answer.includes(other.name), `the answer does not name ${other.name}`);
  await answerShows(turn.id, other.name);
  check((await modelLabel(turn.id)) === other.name.toLowerCase(), `turn label is "${await modelLabel(turn.id)}"`);
  return `answered by ${other.name}, label shows it`;
});

await step("5 ask each", async () => {
  // The demo answers have no options, so this step seeds one answer with two option headings.
  const now = Date.now();
  const empty = { status: "empty", text: "", instruction: "", error: null, model: null };
  const answer = "Two ways:\n\n### Option 1: Trains\n\n- fast\n- scenic\n\n### Option 2: Car\n\n- flexible\n- cheap";
  const seed = { id: randomUUID(), title: `${TITLE}ask each`, titleSource: "user", createdAt: now, updatedAt: now, clips: [], output: empty };
  const parentTurn = { id: randomUUID(), prompt: "How should I travel?", answer, status: "complete", error: null, model: other.id, createdAt: now };
  seed.threads = [{ id: randomUUID(), parent: null, title: seed.title, titleSource: "user", cardView: "open", branchesView: "shown", createdAt: now, turns: [parentTurn] }];
  check((await api.put(seed)).status === 204, "the seed was not saved");
  await page.reload();
  await openConversation(seed.id);
  await composer().fill("What does each cost?");
  await page.getByTestId("composer-ask-each").click();
  const branches = async () => (await api.get(seed.id)).threads.filter((t) => t.parent?.turnId === parentTurn.id);
  const kids = await until(branches, (k) => k.length === 2 && k.every((t) => done(t.turns[0])), "two answered option branches");
  const titles = kids.map((k) => k.title).join(" | ");
  check(titles === "Option 1: Trains | Option 2: Car", `titles are ${titles}`);
  for (const k of kids) await card(k.id).locator("header", { hasText: k.title }).waitFor();
  await openConversation(mainId);
  return "two cards titled with the options, both answered";
});

await step("6 collect and combine", async () => {
  const rootTurn = (await main()).threads[0].turns[0];
  await select(rootId);
  await panelTurn(rootTurn.id).getByTestId("turn-clip").click();
  await until(main, (c) => c.clips.length === 1, "the clip to save");
  await page.getByTestId("tab-output").click();
  await page.getByTestId("combine-run").click();
  await until(main, (c) => c.output.status === "complete", "the combined document");
  await page.getByTestId("output-document").filter({ hasText: "combined document" }).waitFor();
  return "one answer clipped, document combined";
});

await step("7 reload", async () => {
  const before = await main();
  await page.reload();
  await card(rootId).waitFor();
  await until(visibleCards, (n) => n === 2, "both cards to be drawn");
  await page.getByTestId("tab-output").click();
  check((await page.getByTestId("clip-text").count()) === 1, "the clip is missing");
  await page.getByTestId("output-document").filter({ hasText: "combined document" }).waitFor();
  await page.getByTestId("tab-thread").click();
  await select(branchId);
  check((await modelLabel(before.threads[1].turns[1].id)) === other.name.toLowerCase(), "the branch model label is gone");
  await select(rootId);
  const first = health.models.find((m) => m.id === before.threads[0].turns[0].model).name.toLowerCase();
  check((await modelLabel(before.threads[0].turns[0].id)) === first, "the root model label is gone");
  return "cards, output and model labels kept";
});

await deleteOurConversations();
await browser.close();
console.log(failed ? "\nThe smoke run failed." : "\nAll steps passed.");
process.exit(failed ? 1 : 0);
