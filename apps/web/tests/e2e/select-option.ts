import { expect, type Locator } from "@playwright/test";

type OptionChoice = string | number | { label: string } | { value: string | number } | { index: number };

/** Operate the visible custom control, never a hidden native select or application state. */
export async function openSelect(trigger: Locator): Promise<Locator> {
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const listId = await trigger.getAttribute("aria-controls");
  if (!listId) throw new Error("自定义选择框缺少选项列表关联");
  const listbox = trigger.page().locator(`[id=${JSON.stringify(listId)}]`);
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveAttribute("role", "listbox");
  return listbox;
}

export async function chooseOption(trigger: Locator, choice: OptionChoice): Promise<void> {
  const listbox = await openSelect(trigger);
  const options = listbox.getByRole("option");
  const option =
    typeof choice === "object" && "label" in choice
      ? listbox.getByRole("option", { name: choice.label, exact: true })
      : typeof choice === "object" && "index" in choice
        ? options.nth(choice.index)
        : listbox.locator(`[role="option"][data-value=${JSON.stringify(String(typeof choice === "object" ? choice.value : choice))}]`);
  await expect(option).toBeEnabled();
  const value = await option.getAttribute("data-value");
  if (value === null) throw new Error("自定义选择项缺少稳定值");
  await option.click();
  await expect(trigger).toHaveAttribute("data-value", value);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
