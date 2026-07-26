import { type Page, expect, test } from "@playwright/test";
import { routeCollection } from "./fixtures/collection.js";

const logoPath = "/marathon/logo2.png";
const expectedWidth = 237;
const expectedHeight = 256;
const pixelSamples = {
  topGlow: [118, 15],
  internalWhite: [118, 127],
  blueEmblem: [118, 48],
  blackContent: [122, 196],
  cyanContent: [122, 226],
  background: [12, 12],
} as const;

type Pixel = readonly [number, number, number, number];
type AlphaBox = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

type LogoStats = {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly transparentRatio: number;
  readonly partialAlpha: number;
  readonly alphaGt8Box: AlphaBox;
  readonly alphaGt127Box: AlphaBox;
  readonly opaqueWhite: number;
  readonly opaqueBlue: number;
  readonly opaqueBlack: number;
  readonly opaqueCyan: number;
  readonly pixels: {
    readonly topLeft: Pixel;
    readonly topRight: Pixel;
    readonly bottomLeft: Pixel;
    readonly bottomRight: Pixel;
    readonly background: Pixel;
    readonly topGlow: Pixel;
    readonly internalWhite: Pixel;
    readonly blueEmblem: Pixel;
    readonly blackContent: Pixel;
    readonly cyanContent: Pixel;
  };
};

async function logoStats(page: Page): Promise<LogoStats> {
  return page.evaluate(
    async ({ logoPath, pixelSamples }): Promise<LogoStats> => {
      const image = new Image();
      image.src = logoPath;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("Canvas context is unavailable");
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const channel = (offset: number): number => {
        const value = data.at(offset);
        if (value === undefined) throw new Error("Pixel channel is outside the logo canvas");
        return value;
      };
      const pixel = (x: number, y: number): Pixel => {
        const offset = (y * canvas.width + x) * 4;
        return [channel(offset), channel(offset + 1), channel(offset + 2), channel(offset + 3)];
      };
      let transparent = 0;
      let partialAlpha = 0;
      let minA8X = canvas.width;
      let minA8Y = canvas.height;
      let maxA8X = -1;
      let maxA8Y = -1;
      let minA127X = canvas.width;
      let minA127Y = canvas.height;
      let maxA127X = -1;
      let maxA127Y = -1;
      let opaqueWhite = 0;
      let opaqueBlue = 0;
      let opaqueBlack = 0;
      let opaqueCyan = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const pixelIndex = offset / 4;
        const x = pixelIndex % canvas.width;
        const y = Math.floor(pixelIndex / canvas.width);
        const red = channel(offset);
        const green = channel(offset + 1);
        const blue = channel(offset + 2);
        const alpha = channel(offset + 3);
        if (alpha === 0) transparent += 1;
        if (alpha > 0 && alpha < 250) partialAlpha += 1;
        if (alpha > 8) {
          minA8X = Math.min(minA8X, x);
          minA8Y = Math.min(minA8Y, y);
          maxA8X = Math.max(maxA8X, x);
          maxA8Y = Math.max(maxA8Y, y);
        }
        if (alpha > 127) {
          minA127X = Math.min(minA127X, x);
          minA127Y = Math.min(minA127Y, y);
          maxA127X = Math.max(maxA127X, x);
          maxA127Y = Math.max(maxA127Y, y);
        }
        if (alpha >= 250 && red >= 242 && green >= 242 && blue >= 242) opaqueWhite += 1;
        if (alpha >= 250 && blue >= 92 && red <= 135 && (blue > red + 28 || green > red + 28))
          opaqueBlue += 1;
        if (alpha >= 250 && red <= 45 && green <= 45 && blue <= 45) opaqueBlack += 1;
        if (alpha >= 250 && red <= 80 && green >= 130 && blue >= 145) opaqueCyan += 1;
      }
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        transparentRatio: transparent / (canvas.width * canvas.height),
        partialAlpha,
        alphaGt8Box: { left: minA8X, top: minA8Y, right: maxA8X, bottom: maxA8Y },
        alphaGt127Box: { left: minA127X, top: minA127Y, right: maxA127X, bottom: maxA127Y },
        opaqueWhite,
        opaqueBlue,
        opaqueBlack,
        opaqueCyan,
        pixels: {
          topLeft: pixel(0, 0),
          topRight: pixel(canvas.width - 1, 0),
          bottomLeft: pixel(0, canvas.height - 1),
          bottomRight: pixel(canvas.width - 1, canvas.height - 1),
          background: pixel(...pixelSamples.background),
          topGlow: pixel(...pixelSamples.topGlow),
          internalWhite: pixel(...pixelSamples.internalWhite),
          blueEmblem: pixel(...pixelSamples.blueEmblem),
          blackContent: pixel(...pixelSamples.blackContent),
          cyanContent: pixel(...pixelSamples.cyanContent),
        },
      };
    },
    { logoPath, pixelSamples },
  );
}

test("logo2 is a transparent RGBA cutout with protected internal marks", async ({ page }) => {
  // Given the production-served shared logo asset,
  await page.goto("./");

  // When the asset pixels are inspected through browser canvas,
  const stats = await logoStats(page);

  // Then the canvas is transparent while intentional logo content remains opaque.
  expect(stats.naturalWidth).toBe(expectedWidth);
  expect(stats.naturalHeight).toBe(expectedHeight);
  expect(stats.pixels.topLeft[3]).toBe(0);
  expect(stats.pixels.topRight[3]).toBe(0);
  expect(stats.pixels.bottomLeft[3]).toBe(0);
  expect(stats.pixels.bottomRight[3]).toBe(0);
  expect(stats.pixels.background[3]).toBe(0);
  expect(stats.transparentRatio).toBeGreaterThan(0.52);
  expect(stats.transparentRatio).toBeLessThan(0.75);
  expect(stats.partialAlpha).toBeGreaterThan(3_000);
  expect(stats.partialAlpha).toBeLessThan(6_000);
  expect(stats.alphaGt8Box).toEqual({ left: 10, top: 15, right: 226, bottom: 240 });
  expect(stats.alphaGt127Box).toEqual({ left: 11, top: 16, right: 225, bottom: 239 });
  expect(stats.pixels.topGlow[0]).toBeLessThanOrEqual(35);
  expect(stats.pixels.topGlow[2]).toBeGreaterThanOrEqual(110);
  expect(stats.pixels.topGlow[3]).toBeGreaterThanOrEqual(20);
  expect(stats.pixels.topGlow[3]).toBeLessThanOrEqual(80);
  expect(stats.pixels.internalWhite[0]).toBeGreaterThanOrEqual(242);
  expect(stats.pixels.internalWhite[1]).toBeGreaterThanOrEqual(242);
  expect(stats.pixels.internalWhite[2]).toBeGreaterThanOrEqual(242);
  expect(stats.pixels.internalWhite[3]).toBeGreaterThanOrEqual(250);
  expect(stats.pixels.blueEmblem[0]).toBeLessThanOrEqual(135);
  expect(stats.pixels.blueEmblem[2]).toBeGreaterThanOrEqual(92);
  expect(stats.pixels.blueEmblem[3]).toBeGreaterThanOrEqual(250);
  expect(stats.pixels.blackContent[0]).toBeLessThanOrEqual(45);
  expect(stats.pixels.blackContent[1]).toBeLessThanOrEqual(45);
  expect(stats.pixels.blackContent[2]).toBeLessThanOrEqual(45);
  expect(stats.pixels.blackContent[3]).toBeGreaterThanOrEqual(250);
  expect(stats.pixels.cyanContent[0]).toBeLessThanOrEqual(80);
  expect(stats.pixels.cyanContent[1]).toBeGreaterThanOrEqual(130);
  expect(stats.pixels.cyanContent[2]).toBeGreaterThanOrEqual(145);
  expect(stats.pixels.cyanContent[3]).toBeGreaterThanOrEqual(250);
  expect(stats.opaqueWhite).toBeGreaterThan(3_000);
  expect(stats.opaqueBlue).toBeGreaterThan(13_000);
  expect(stats.opaqueBlack).toBeGreaterThan(4_500);
  expect(stats.opaqueCyan).toBeGreaterThan(5_000);
});

test("logo2 remains the shared home, hero, and calendar brand asset", async ({ page }) => {
  // Given routed collection data and the homepage,
  await routeCollection(page);
  await page.goto("./");

  // When each shared logo placement is inspected,
  const homeBrand = page.locator(".home-brand img");
  const heroArt = page.locator(".home-hero-visual > img.home-hero-art");
  await expect(homeBrand).toHaveAttribute("src", /\/marathon\/logo2\.png$/u);
  await expect(heroArt).toHaveAttribute("src", /\/marathon\/logo2\.png$/u);
  await expect(homeBrand).toHaveJSProperty("naturalWidth", expectedWidth);
  await expect(homeBrand).toHaveJSProperty("naturalHeight", expectedHeight);
  await expect(heroArt).toHaveJSProperty("naturalWidth", expectedWidth);
  await expect(heroArt).toHaveJSProperty("naturalHeight", expectedHeight);

  // Then the calendar header reuses the same in-place asset contract.
  await page.goto("./#/calendar");
  const calendarBrand = page.locator(".calendar-brand img");
  await expect(calendarBrand).toHaveAttribute("src", /\/marathon\/logo2\.png$/u);
  await expect(calendarBrand).toHaveJSProperty("naturalWidth", expectedWidth);
  await expect(calendarBrand).toHaveJSProperty("naturalHeight", expectedHeight);
});
