import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adoptLegacyData } from "./client";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headroom-adopt-"));
}

describe("adoptLegacyData", () => {
  it("copies the old ./data database and imports to the new location once, leaving the originals", () => {
    const legacy = tmp();
    const legacyDb = new Database(path.join(legacy, "headroom.sqlite"));
    legacyDb.exec("create table t (x); insert into t values (42)");
    legacyDb.close();
    fs.mkdirSync(path.join(legacy, "imports"));
    fs.writeFileSync(path.join(legacy, "imports", "abc.ofx"), "OFXHEADER:100");

    const home = tmp();
    const target = {
      dbPath: path.join(home, "headroom.sqlite"),
      importDir: path.join(home, "imports"),
    };
    expect(adoptLegacyData(target, legacy)).toBe(true);
    const copied = new Database(target.dbPath, { readonly: true });
    expect(copied.prepare("select x from t").get()).toEqual({ x: 42 });
    copied.close();
    expect(fs.readFileSync(path.join(target.importDir, "abc.ofx"), "utf8")).toBe("OFXHEADER:100");
    expect(fs.existsSync(path.join(legacy, "headroom.sqlite"))).toBe(true);
    // Second call: the target exists, nothing happens.
    expect(adoptLegacyData(target, legacy)).toBe(false);
  });

  it("does nothing without a legacy database, and never for in-memory databases", () => {
    const home = tmp();
    const target = {
      dbPath: path.join(home, "headroom.sqlite"),
      importDir: path.join(home, "imports"),
    };
    expect(adoptLegacyData(target, tmp())).toBe(false);
    expect(fs.existsSync(target.dbPath)).toBe(false);
    expect(adoptLegacyData({ dbPath: ":memory:", importDir: home }, tmp())).toBe(false);
  });
});
