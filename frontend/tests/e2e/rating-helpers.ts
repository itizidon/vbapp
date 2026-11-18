import { expect, type Page, type Locator } from "@playwright/test";
export async function setPeerRating(
  scope: Page | Locator,
  skillName: string,
  value: number,
) {
  const slider = scope.getByRole("slider", {
    name: `${skillName} rating`,
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  const tenths = Math.round(value * 10) - 10;
  for (let i = 0; i < Math.floor(tenths / 10); i++)
    await slider.press("PageUp");
  for (let i = 0; i < tenths % 10; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(value));
}
