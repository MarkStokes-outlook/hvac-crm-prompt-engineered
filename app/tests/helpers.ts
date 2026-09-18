import os from "node:os";
import path from "node:path";
import fs from "node:fs";
process.env.FROSTLINE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "frostline-test-"));
import { createSchema, openDatabase } from "../server/db.js";
import { seedDatabase } from "../server/seed.js";
import { setNow } from "../server/time.js";
import { Actor } from "../server/permissions.js";

/** Fresh in-memory database seeded with demo data, with the clock frozen on a weekday morning. */
export function freshDb(at = new Date(2026, 8, 16, 10, 0)) {
  setNow(at);
  const db = openDatabase(":memory:");
  createSchema(db);
  db.transaction(() => seedDatabase(db))();
  return db;
}

export function actor(email: string): Actor {
  const { getDb } = requireDb();
  const u = getDb().prepare("SELECT * FROM users WHERE email = ?").get(`${email}@frostline.example`) as any;
  if (!u) throw new Error(`No user ${email}`);
  return { id: u.id, name: u.name, role: u.role, via: "ui" };
}

import * as dbmod from "../server/db.js";
function requireDb() {
  return dbmod;
}

export const q = <T = any>(sql: string, ...params: unknown[]) => dbmod.getDb().prepare(sql).get(...params) as T;
export const qa = <T = any>(sql: string, ...params: unknown[]) => dbmod.getDb().prepare(sql).all(...params) as T[];
