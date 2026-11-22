import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { ModelInfo } from "../../shared/api";
import { chooseModel, selectModels, useStore } from "../store";
import { modelName } from "../text";
import { MENU_CONTENT } from "./Menu";
import { ICON, Tip } from "./ui";

// The models in their providers' order, one group per provider.
function byProvider(models: ModelInfo[]): [string, ModelInfo[]][] {
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) groups.set(m.providerName, [...(groups.get(m.providerName) ?? []), m]);
  return [...groups];
}

// The model the next message uses: a ghost button with the model name that opens a menu of the
// available models, grouped by provider, the current one checked. Hidden when the server offers
// one model or none. `className` sets the button's room in its row (it truncates the name).
export function ModelPicker({ className = "" }: { className?: string }) {
  const models = useStore(selectModels);
  const choice = useStore((s) => s.modelChoice);
  if (models.length < 2 || choice.kind !== "chosen") return null;
  const current = models.find((m) => m.id === choice.id);

  return (
    <Menu.Root>
      <Tip content={current ? `Model for the next message: ${current.providerName} ${current.name}` : "Model for the next message"}>
        <Menu.Trigger asChild>
          <button
            type="button"
            data-testid="model-picker"
            aria-label={`Model: ${modelName(choice.id)}`}
            className={`inline-flex h-[30px] min-w-0 shrink items-center gap-1.5 rounded-cell px-2 text-[13px] font-medium text-fg transition-colors duration-150 ease-out-expo hover:bg-surface data-[state=open]:bg-surface ${className}`}
          >
            <span className="min-w-0 truncate">{modelName(choice.id)}</span>
            <ChevronDown {...ICON} className="shrink-0 text-muted" />
          </button>
        </Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          data-testid="model-menu"
          className={MENU_CONTENT}
        >
          {byProvider(models).map(([provider, items], i) => (
            <Menu.Group key={provider}>
              {i > 0 && <Menu.Separator className="mx-1 my-1 h-px bg-line-soft" />}
              <Menu.Label className="label-sm px-2 pt-2 pb-1">{provider}</Menu.Label>
              <Menu.RadioGroup value={choice.id} onValueChange={chooseModel}>
                {items.map((m) => (
                  <Menu.RadioItem
                    key={m.id}
                    value={m.id}
                    data-testid={`model-option-${m.id}`}
                    className="flex h-[34px] cursor-pointer items-center gap-2 rounded-cell px-2 text-[13.5px] text-fg outline-none select-none data-[highlighted]:bg-surface"
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      <Menu.ItemIndicator>
                        <Check {...ICON} />
                      </Menu.ItemIndicator>
                    </span>
                    <span className="min-w-0 truncate">{m.name}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
