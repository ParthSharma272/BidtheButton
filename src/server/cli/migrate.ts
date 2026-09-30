import { getDb } from "../db.ts";

// getDb() applies the idempotent schema on open.
const db = getDb();
const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
console.log(`Database ready at schema version ${v.v}.`);
