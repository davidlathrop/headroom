import { openDb, getDbPath } from "../src/db/client";

openDb();
console.log(`Migrated ${getDbPath()}`);
