/**
 * Headroom desktop shell.
 *
 * The web app is a Next.js server (server components, server actions, SQLite), so the desktop
 * app runs that server and shows it in a window:
 *
 *  - packaged: the Next standalone build lives in <resources>/app and is started as an Electron
 *    utility process on a free localhost port; the database and uploaded files live in
 *    ~/.headroom (HEADROOM_DATA_DIR to move them), shared with the web app.
 *  - development (`npm run electron:dev`): a normal `next dev` runs under system Node and the
 *    window simply opens it, so native modules need no rebuild until packaging.
 *
 * HEADROOM_STANDALONE=1 forces the packaged path in development (after `electron:assemble`);
 * HEADROOM_SMOKE=1 starts the server against a temporary data folder, fetches two pages, prints
 * the result and exits — the packaging pipeline's end-to-end check.
 */
import {
  app,
  BrowserWindow,
  dialog,
  net,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import nodeNet from "node:net";
import path from "node:path";

const isDev = !app.isPackaged;
const useStandalone = !isDev || process.env.HEADROOM_STANDALONE === "1";
const smoke = process.env.HEADROOM_SMOKE === "1";
const DEV_URL = process.env.HEADROOM_DEV_URL ?? "http://localhost:3000";

let server: UtilityProcess | null = null;
let win: BrowserWindow | null = null;

function log(...args: unknown[]) {
  console.log("[headroom]", ...args);
}

/** Where the standalone build is: next to the compiled main in dev, in resources when packaged. */
function appRoot(): string {
  return isDev ? path.join(__dirname, "..", "app") : path.join(process.resourcesPath, "app");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = nodeNet.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await net.fetch(url, { method: "GET" });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not answer within ${timeoutMs / 1000}s: ${String(lastError)}`);
}

/** Start the Next standalone server and resolve to its URL. */
async function startStandalone(): Promise<string> {
  const root = appRoot();
  const serverJs = path.join(root, "server.js");
  if (!fs.existsSync(serverJs))
    throw new Error(
      `No standalone build at ${root}. Run \`npm run electron:assemble\` (or \`electron:build\`) first.`,
    );
  // Data lives where the web app keeps it too — ~/.headroom unless HEADROOM_DATA_DIR says
  // otherwise — so `next dev` and the desktop app see the same database.
  const dataDir = process.env.HEADROOM_DATA_DIR ?? path.join(os.homedir(), ".headroom");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  log(`starting server on ${url}, data in ${dataDir}`);
  server = utilityProcess.fork(serverJs, [], {
    cwd: root,
    serviceName: "headroom-server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      HEADROOM_DATA_DIR: dataDir,
    },
  });
  server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));
  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));
  server.on("exit", (code) => {
    log(`server exited with code ${code}`);
    server = null;
    if (!app.isReady() || code === 0) return;
    if (win && !win.isDestroyed())
      dialog.showErrorBox("Headroom", `The local server stopped unexpectedly (code ${code}).`);
  });
  await waitForServer(`${url}/`);
  return url;
}

function stopServer() {
  if (server) {
    server.kill();
    server = null;
  }
}

function createWindow(url: string) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Headroom",
    backgroundColor: "#f6f8f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Links to other origins open in the system browser; the app itself stays in the window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(url) || target.startsWith(DEV_URL)) return { action: "allow" };
    void shell.openExternal(target);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(url);
}

async function runSmoke(url: string) {
  const pages = ["/", "/budgets", "/accounts", "/forecast"];
  let ok = true;
  for (const p of pages) {
    const res = await net.fetch(`${url}${p}`);
    const body = await res.text();
    const good = res.status === 200 && body.includes("Headroom");
    ok &&= good;
    log(`SMOKE ${p} → ${res.status} ${good ? "ok" : "FAIL"}`);
  }
  log(ok ? "SMOKE_OK" : "SMOKE_FAIL");
  stopServer();
  app.exit(ok ? 0 : 1);
}

if (smoke) {
  // Never touch real data from the smoke test.
  process.env.HEADROOM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-smoke-"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const url = useStandalone ? await startStandalone() : DEV_URL;
      if (smoke) return runSmoke(url);
      createWindow(url);
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
      });
    } catch (e) {
      log("startup failed", e);
      if (smoke) {
        log("SMOKE_FAIL");
        app.exit(1);
        return;
      }
      dialog.showErrorBox("Headroom could not start", (e as Error).message);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", stopServer);
  app.on("will-quit", stopServer);
}
