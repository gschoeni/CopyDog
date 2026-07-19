import { describe, expect, it } from "vitest";

import { avatarHue, avatarInitial } from "./avatar";

describe("avatarHue", () => {
  it("is deterministic — same person, same color", () => {
    const id = "5a3c9d2e-1f4b-4c8a-9e7d-2b6f8a1c3d5e";
    expect(avatarHue(id)).toBe(avatarHue(id));
  });

  it("always lands on one of the eight muted hues", () => {
    const hues = new Set([25, 70, 115, 160, 205, 250, 295, 340]);
    for (let i = 0; i < 50; i++) {
      expect(hues.has(avatarHue(`user-${i}`))).toBe(true);
    }
  });

  it("spreads different users across more than one hue", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(avatarHue(`user-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("avatarInitial", () => {
  it("takes the first letter, uppercased", () => {
    expect(avatarInitial("greg")).toBe("G");
    expect(avatarInitial("  sarah chen")).toBe("S");
  });

  it("falls back to ? for empty names", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });
});
