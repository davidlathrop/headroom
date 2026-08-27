import { describe, expect, it } from "vitest";
import { BUILTIN_PROFILES } from "./builtins";
import { csvProfileSchema } from "./profile";

describe("BUILTIN_PROFILES", () => {
  it("every CSV profile validates and has a signature; ids are unique", () => {
    const ids = new Set<string>();
    for (const p of BUILTIN_PROFILES) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.isBuiltin).toBe(true);
      if (p.format === "csv") {
        expect(() => csvProfileSchema.parse(p.config)).not.toThrow();
        expect(p.config!.signature.length).toBeGreaterThan(0);
      } else {
        expect(p.config).toBeNull();
      }
    }
    expect(ids.has("builtin-ofx")).toBe(true);
  });
});
