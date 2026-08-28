import { contextBridge } from "electron";

/** The page runs sandboxed; this is the only bridge, and it exposes nothing sensitive. */
contextBridge.exposeInMainWorld("headroom", {
  desktop: true,
  platform: process.platform,
});
