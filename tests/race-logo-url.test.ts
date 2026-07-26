import { describe, expect, it } from "vitest";
import { safeRaceLogoUrl } from "../src/race-logo-url.js";

const ASCII_CONTROL_CASES = Array.from({ length: 33 }, (_, index) => {
  const codePoint = index === 32 ? 127 : index;
  return [codePoint, String.fromCharCode(codePoint)] as const;
});

describe("safeRaceLogoUrl", () => {
  it("returns an absolute HTTPS logo URL when the input is public and credential-free", () => {
    // Given
    const raw = "https://cdn.example.com/races/seoul-logo.png?size=2#mark";

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBe(raw);
  });

  it("resolves a relative logo URL when the base is HTTPS", () => {
    // Given
    const raw = "../images/race-logo.svg";
    const base = "https://race.example.com/events/2026/index.html";

    // When
    const result = safeRaceLogoUrl(raw, base);

    // Then
    expect(result).toBe("https://race.example.com/events/images/race-logo.svg");
  });

  it("retains one canonical trailing FQDN dot", () => {
    // Given
    const raw = "https://cdn.example.com./races/race-logo.png";

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBe(raw);
  });

  it.each([" https://cdn.example.com/race-logo.png", "https://cdn.example.com/race-logo.png "])(
    "rejects leading or trailing whitespace in raw input: %s",
    (raw) => {
      // Given / When
      const result = safeRaceLogoUrl(raw);

      // Then
      expect(result).toBeNull();
    },
  );

  it.each([" https://race.example.com/event", "https://race.example.com/event "])(
    "rejects leading or trailing whitespace in base input: %s",
    (base) => {
      // Given / When
      const result = safeRaceLogoUrl("race-logo.png", base);

      // Then
      expect(result).toBeNull();
    },
  );

  it.each(ASCII_CONTROL_CASES)("rejects ASCII control U+%i in raw input", (_code, control) => {
    // Given
    const raw = `https://cdn.example.com/race${control}logo.png`;

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it.each(ASCII_CONTROL_CASES)("rejects ASCII control U+%i in base input", (_code, control) => {
    // Given
    const base = `https://race.example.com/${control}/event`;

    // When
    const result = safeRaceLogoUrl("race-logo.png", base);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    "https://./race-logo.png",
    "https://../race-logo.png",
    "https://race..example.com/race-logo.png",
    "https://.race.example.com/race-logo.png",
    "https://race.example.com../race-logo.png",
  ])("rejects an empty, only-dot, or empty-label hostname: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it("rejects a raw URL longer than 4096 characters", () => {
    // Given
    const raw = "https://cdn.example.com/".padEnd(4097, "a");

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it("rejects a base URL longer than 4096 characters", () => {
    // Given
    const base = "https://race.example.com/".padEnd(4097, "a");

    // When
    const result = safeRaceLogoUrl("logo.png", base);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    [null, undefined],
    ["", undefined],
    ["   ", undefined],
    ["not a url", undefined],
    ["/logo.png", undefined],
    ["/logo.png", "not a base"],
    ["/logo.png", "http://race.example.com/event"],
  ] as const)("rejects malformed, empty, or unresolved input: %s", (raw, base) => {
    // Given / When
    const result = safeRaceLogoUrl(raw, base);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    "http://cdn.example.com/logo.png",
    "ftp://cdn.example.com/logo.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ])("rejects a non-HTTPS URL: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    "https://user@cdn.example.com/logo.png",
    "https://user:secret@cdn.example.com/logo.png",
  ])("rejects a URL containing credentials: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    "https://localhost/logo.png",
    "https://images.localhost/logo.png",
    "https://race.local/logo.png",
    "https://LOCALHOST./logo.png",
  ])("rejects a local hostname: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    "https://127.0.0.1/logo.png",
    "https://10.0.0.1/logo.png",
    "https://169.254.1.1/logo.png",
    "https://224.0.0.1/logo.png",
    "https://[::1]/logo.png",
    "https://[fc00::1]/logo.png",
    "https://[fe80::1]/logo.png",
    "https://[ff02::1]/logo.png",
  ])("rejects a non-public IP literal: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it.each(["https://192.0.2.1/logo.png", "https://[2001:db8::1]/logo.png"])(
    "rejects a reserved IP literal: %s",
    (raw) => {
      // Given / When
      const result = safeRaceLogoUrl(raw);

      // Then
      expect(result).toBeNull();
    },
  );

  it.each([
    "https://cdn.example.com/favicon.ico",
    "https://cdn.example.com/APPLE-TOUCH-ICON.PNG",
    "https://cdn.example.com/assets/default.svg",
    "https://cdn.example.com/assets/placeholder.webp",
    "https://cdn.example.com/assets/no-image.jpg",
    "https://cdn.example.com/assets/noimage.avif",
    "https://cdn.example.com/assets/%256e%256f%252d%2569%256d%2561%2567%2565.png",
  ])("rejects a generic or placeholder basename: %s", (raw) => {
    // Given / When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it("rejects a placeholder basename encoded through five layers", () => {
    // Given
    const raw =
      "https://cdn.example.com/%252525256e%252525256f%252525252d%2525252569%252525256d%2525252561%2525252567%2525252565.png";

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBeNull();
  });

  it("rejects a 100KB 50000-layer input within a conservative bound", () => {
    // Given
    const raw = `https://cdn.example.com/%${"25".repeat(50_000)}6e%6f%2d%69%6d%61%67%65.png`;
    const startedAt = performance.now();

    // When
    const result = safeRaceLogoUrl(raw);
    const elapsedMilliseconds = performance.now() - startedAt;

    // Then
    expect(result).toBeNull();
    expect(elapsedMilliseconds).toBeLessThan(1_000);
  });

  it("accepts a public HTTPS IPv4 literal", () => {
    // Given
    const raw = "https://8.8.8.8/race-logo.png";

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBe(raw);
  });

  it("accepts a public HTTPS IPv6 literal", () => {
    // Given
    const raw = "https://[2606:4700:4700::1111]/race-logo.png";

    // When
    const result = safeRaceLogoUrl(raw);

    // Then
    expect(result).toBe(raw);
  });
});
