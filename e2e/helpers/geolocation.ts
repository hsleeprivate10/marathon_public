import type { Page } from "@playwright/test";

export async function denyGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: () => Promise.resolve({ state: "granted" }),
      },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback | null | undefined,
          options?: PositionOptions,
        ) => {
          const requestCount = Number(document.documentElement.dataset.weatherLocationCount ?? "0");
          document.documentElement.dataset.weatherLocationCount = String(requestCount + 1);
          document.documentElement.dataset.weatherLocationOptions = JSON.stringify(options);
          const disclosure = document.querySelector<HTMLElement>(".home-weather-message");
          const disclosureStyle = disclosure === null ? null : getComputedStyle(disclosure);
          const disclosureBox = disclosure?.getBoundingClientRect();
          document.documentElement.dataset.weatherDisclosureVisible = String(
            disclosureStyle !== null &&
              disclosureStyle.visibility === "visible" &&
              disclosureStyle.display !== "none" &&
              disclosureBox !== undefined &&
              disclosureBox.width > 0 &&
              disclosureBox.height > 0,
          );
          error?.({
            code: 1,
            message: "permission denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
      },
    });
  });
}
