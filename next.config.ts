import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The desktop app ships the standalone server (see electron/main.ts); the web app stays as is.
  output: process.env.ELECTRON_BUILD ? "standalone" : undefined,
  // File tracing follows the cwd-relative paths in db/client.ts and would otherwise copy the live
  // database and every uploaded bank file into the standalone build. Never. (Patterns match with
  // "contains" semantics — `data/**` would also hit next/dist/lib/metadata — so they are specific;
  // scripts/electron-assemble.mjs refuses to ship anything that slips through regardless.)
  outputFileTracingExcludes: {
    "*": ["data/imports/**", "data/*.sqlite", "data/*.sqlite-*", "data/.gitkeep"],
  },
  // Verification builds can target a separate directory so they never clobber a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
