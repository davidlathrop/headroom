# Headroom as a desktop app (Electron)

Branch: `electron`. Status: **works end to end** — `npm run electron:smoke` starts the standalone
server against a temporary profile, fetches four pages and exits 0, and `electron-builder` produces
a runnable (unsigned) `Headroom.app` whose bundle contains no user data. Icons, signing and
auto-update are not done.

## How it fits together

Headroom is a Next.js server app — server components, server actions, SQLite through
`better-sqlite3`. Rather than rewrite that as IPC, the desktop app **runs the same server locally
and shows it in a window**:

```
Electron main (electron/main.ts)
  ├─ utilityProcess.fork(<resources>/app/server.js)   Next standalone server, 127.0.0.1:<free port>
  │     env: HEADROOM_DATA_DIR → ~/.headroom (shared with the web app)
  └─ BrowserWindow → http://127.0.0.1:<port>          sandboxed, contextIsolation, tiny preload
```

- **Data** lives in `~/.headroom/` — `headroom.sqlite` plus `imports/` with the uploaded files —
  the same place the web app uses, so `next dev` and the desktop app share one database.
  `HEADROOM_DATA_DIR` moves it. Migrations run on first open exactly as in the web app
  (`drizzle/` ships next to the server).
- **Nothing listens beyond localhost**, and the port is chosen per launch.
- External links open in the system browser; the app stays in the window.

## Commands

| Command | What it does |
|---|---|
| `npm run electron:dev` | `next dev` under system Node + an Electron window on it. Same `~/.headroom` data as web dev. No native rebuild needed. |
| `npm run electron:assemble` | `ELECTRON_BUILD=1 next build` (standalone output, into `.next-electron` so a running `next dev` is untouched), then `scripts/electron-assemble.mjs` copies server + static + public + drizzle into `electron/dist/app`. |
| `npm run electron:smoke` | Runs the assembled app headless against a temp profile, fetches `/`, `/budgets`, `/accounts`, `/forecast`, prints `SMOKE_OK` / `SMOKE_FAIL`, exits accordingly. The pipeline's integration test. |
| `npm run electron:build` | assemble + compile + `electron-builder` → `release/` (dmg + zip on macOS, nsis on Windows, AppImage on Linux). |

`HEADROOM_STANDALONE=1 electron .` runs the assembled build in a real window without packaging;
`npx electron-builder --mac --dir` packages an unpacked `release/mac-arm64/Headroom.app` without a
DMG (faster for checking the bundle). electron-builder drops a `node_modules` folder inside
`extraResources`, so `electron-builder.yml` copies it as its own entry.

## User data never ships

Next's standalone file trace follows the cwd-relative paths in `src/db/client.ts` and would happily
copy `data/` — the live database and every uploaded bank file — into the build. Two independent
guards stop that: `outputFileTracingExcludes` in `next.config.ts` (with patterns specific enough not
to collide with Next's own `metadata` modules, since Next matches them with *contains* semantics),
and `scripts/electron-assemble.mjs`, which deletes any `data/` folder and refuses to assemble if
anything that looks like a database or import file is present. `electron-builder` only ever sees
the assembled folder.

## The native module

`better-sqlite3` is a native addon. Since 13.x it is built on **N-API**, whose ABI is stable across
Node and Electron versions, and it ships its prebuilt binaries inside the npm package
(`prebuilds/<platform>-<arch>/`). So the very same module that `next dev` and vitest use under
system Node loads inside Electron unchanged — no `electron-rebuild`, no compiler. (Older 11.x
builds were V8-ABI-specific and did not compile against Electron 44; the branch bumped to 13.x for
this reason.) `scripts/electron-assemble.mjs` only checks that Next's file trace carried the
prebuild for the current platform.

## What's next

- App icon (`electron/build/icon.icns|ico|png`) and a proper `appId`.
- macOS code signing + notarization; Windows signing. Until then Gatekeeper will warn.
- Auto-update (`electron-updater`) once releases live somewhere.
- Native file picker for Import (the web `<input type="file">` works, but a menu item + dialog is nicer).
- Menu: File → Import…, Backup database…, and a Help → Open data folder.
- Crash/log files under userData.
