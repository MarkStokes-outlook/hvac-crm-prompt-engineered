import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.FROSTLINE_DATA_DIR ?? path.resolve(here, "../data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

export type DB = Database.Database;

let current: DB | null = null;

export function openDatabase(file = process.env.FROSTLINE_DB ?? path.join(DATA_DIR, "frostline.db")): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  current = db;
  return db;
}

export function createSchema(db: DB) {
  const sql = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  db.exec(sql);
}

export function hasSchema(db: DB) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
}

export function dropAll(db: DB) {
  db.pragma("foreign_keys = OFF");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.pragma("foreign_keys = ON");
}

export function getDb(): DB {
  if (!current) throw new Error("Database not opened");
  return current;
}

export function setDb(db: DB) {
  current = db;
}

/** Run fn inside a transaction and always roll back; returns fn's result (used for AI dry-runs). */
export function dryRun<T>(db: DB, fn: () => T): T {
  const ROLLBACK = Symbol("rollback");
  let result: T | undefined;
  try {
    db.transaction(() => {
      result = fn();
      throw ROLLBACK;
    })();
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result as T;
}
