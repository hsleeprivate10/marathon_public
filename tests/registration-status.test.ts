import { describe, expect, it } from "vitest";
import { computeRegistrationStatus } from "../src/contract.js";

describe("computeRegistrationStatus", () => {
  it("returns unknown when deadline is null", () => {
    expect(computeRegistrationStatus(null, "2025-12-31")).toBe("unknown");
  });

  it("returns closed when deadline has passed", () => {
    expect(computeRegistrationStatus("2020-01-01", "2025-12-31")).toBe("closed");
  });

  it("returns closed when event date has passed", () => {
    expect(computeRegistrationStatus("2099-01-01", "2020-01-01")).toBe("closed");
  });

  it("returns open when deadline is far in the future", () => {
    expect(computeRegistrationStatus("2099-12-31", "2099-12-31")).toBe("open");
  });
});
