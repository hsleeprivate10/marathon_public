import type { Locator, Page } from "@playwright/test";

export type PageSignals = {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
};

export function observeErrors(page: Page): PageSignals {
  const signals: PageSignals = { consoleErrors: [], pageErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") signals.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => signals.pageErrors.push(error.message));
  return signals;
}

export const sectionMonths = async (locator: Locator): Promise<string[]> =>
  locator.evaluateAll((sections) =>
    sections.map((section) => section.getAttribute("data-month") ?? "missing"),
  );

export const optionValues = async (select: Locator): Promise<string[]> =>
  select
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option instanceof HTMLOptionElement ? option.value : "missing")),
    );
