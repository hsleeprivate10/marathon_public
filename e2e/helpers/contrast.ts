import type { Page } from "@playwright/test";

export async function computedContrast(
  page: Page,
  foregroundSelector: string,
  backgroundSelector: string,
): Promise<number> {
  return page.evaluate(
    ({ foreground, background }) => {
      const foregroundElement = document.querySelector(foreground);
      const backgroundElement = document.querySelector(background);
      if (!(foregroundElement instanceof HTMLElement)) throw new Error(`Missing ${foreground}`);
      if (!(backgroundElement instanceof HTMLElement)) throw new Error(`Missing ${background}`);
      const luminance = (color: string): number => {
        const channels =
          color
            .match(/\d+(?:\.\d+)?/gu)
            ?.slice(0, 3)
            .map(Number) ?? [];
        if (channels.length !== 3) throw new Error(`Unsupported color ${color}`);
        const linear = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
      };
      const foregroundLuminance = luminance(getComputedStyle(foregroundElement).color);
      const backgroundLuminance = luminance(getComputedStyle(backgroundElement).backgroundColor);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);
      return (lighter + 0.05) / (darker + 0.05);
    },
    { foreground: foregroundSelector, background: backgroundSelector },
  );
}
