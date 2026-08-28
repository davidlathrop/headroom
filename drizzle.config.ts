import os from "node:os";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.HEADROOM_DB ??
      path.join(
        process.env.HEADROOM_DATA_DIR ?? path.join(os.homedir(), ".headroom"),
        "headroom.sqlite",
      ),
  },
});
