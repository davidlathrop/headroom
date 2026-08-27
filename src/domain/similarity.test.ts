import { describe, expect, it } from "vitest";
import { diceTokens, jaroWinkler, payeeSimilarity } from "./similarity";

describe("jaroWinkler", () => {
  it("behaves", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("", "x")).toBe(0);
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("BLUE BOTTLE COFFEE", "SQUARE BLUE BOTTLE")).toBeLessThan(0.85);
    expect(jaroWinkler("BLUE BOTTLE COFFEE", "BLUE BOTTLE")).toBeGreaterThan(0.85);
  });
  it("token similarity ignores numeric tokens and processor words", () => {
    expect(diceTokens("BLUE BOTTLE COFFEE", "SQUARE BLUE BOTTLE COFFEE 12")).toBeCloseTo(0.857, 2);
    expect(diceTokens("PHILZ COFFEE", "BLUE BOTTLE COFFEE")).toBeCloseTo(0.4, 2);
    expect(payeeSimilarity("SAFEWAY", "SAFEWAY")).toBe(1);
    expect(payeeSimilarity("SHELL OIL", "CHEVRON")).toBeLessThan(0.85);
  });
});
