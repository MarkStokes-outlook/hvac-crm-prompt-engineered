// Deletes all data and recreates the demo dataset (relative to the current date).
import "./time.js";
import fs from "node:fs";
import { UPLOAD_DIR, createSchema, dropAll, openDatabase } from "./db.js";
import { DEMO_PASSWORD, seedDatabase } from "./seed.js";

const db = openDatabase();
dropAll(db);
createSchema(db);
const r = db.transaction(() => seedDatabase(db))();
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
console.log(`Demo data reset: ${r.users} users, ${r.customers} customers, ${r.jobs} jobs, ${r.quotes} quotes. Password for all demo users: "${DEMO_PASSWORD}".`);
