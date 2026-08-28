/**
 * Assemble the Next standalone build into electron/dist/app, the folder the desktop shell runs
 * and electron-builder ships as <resources>/app:
 *
 *   .next/standalone/*          the server and its traced node_modules
 *   .next/static     → .next/static   (standalone does not include static assets; the dist dir
 *                                      name is kept, so NEXT_DIST_DIR is honored)
 *   public           → public
 *   drizzle          → drizzle        (migrations run from cwd on first open)
 *
 * and check that better-sqlite3's prebuilt N-API binary came along (it needs no Electron rebuild).
 *
 * Usage: ELECTRON_BUILD=1 next build && node scripts/electron-assemble.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = process.env.NEXT_DIST_DIR ?? ".next";
const standalone = path.join(root, dist, "standalone");
const out = path.join(root, "electron", "dist", "app");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error(`No standalone build in ${standalone}. Run: ELECTRON_BUILD=1 npx next build`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.cpSync(standalone, out, { recursive: true });

// Belt and braces: next.config excludes data/ from tracing, and nothing that looks like a user's
// database or uploaded file may ship regardless of how it got here.
fs.rmSync(path.join(out, "data"), { recursive: true, force: true });
const leaked = [];
const scan = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      if (e.name === "imports" || e.name === "data") leaked.push(p);
      else scan(p);
    } else if (/\.(sqlite|sqlite-wal|sqlite-shm|ofx|qfx|qbo|csv)$/i.test(e.name)) leaked.push(p);
  }
};
scan(out);
if (leaked.length) {
  console.error("Refusing to assemble: user data would ship with the app:");
  for (const p of leaked) console.error("  " + path.relative(root, p));
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(1);
}
fs.cpSync(path.join(root, dist, "static"), path.join(out, dist, "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public")))
  fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), { recursive: true });

// better-sqlite3 >= 13 is an N-API addon and ships its prebuilt binaries inside the package, so
// the traced copy works under Electron as is — no rebuild against Electron's ABI. The binary is
// required by a computed path, which file tracing can miss, so copy it from the repo's module if
// the trace left it out.
const prebuildName = `${process.platform}-${process.arch}.node`;
const prebuild = path.join(out, "node_modules", "better-sqlite3", "prebuilds", prebuildName);
if (!fs.existsSync(prebuild)) {
  const source = path.join(root, "node_modules", "better-sqlite3", "prebuilds", prebuildName);
  if (!fs.existsSync(source)) {
    console.error(`No better-sqlite3 prebuild for ${prebuildName} in ${path.dirname(source)}.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(prebuild), { recursive: true });
  fs.copyFileSync(source, prebuild);
  console.log(`copied ${prebuildName} (not in the standalone trace)`);
}
console.log(`assembled ${out} (better-sqlite3 prebuild: ${path.relative(root, prebuild)})`);
