import { z } from "zod";
import { getDb } from "../db.js";
import { invalid } from "../errors.js";

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    throw invalid(`Invalid input — ${issues.join("; ")}`, issues);
  }
  return r.data;
}

/** Next sequential reference such as J-10042, based on the highest existing numeric suffix. */
export function nextRef(table: string, prefix: string, start = 10001): string {
  const row = getDb()
    .prepare(`SELECT MAX(CAST(SUBSTR(reference, ${prefix.length + 2}) AS INTEGER)) AS n FROM ${table} WHERE reference LIKE ?`)
    .get(`${prefix}-%`) as { n: number | null };
  return `${prefix}-${Math.max((row.n ?? 0) + 1, start)}`;
}

export const optStr = z.string().trim().max(4000).optional().nullable().transform((v) => (v ? v : null));
export const reqStr = (max = 500) => z.string().trim().min(1).max(max);
export const id = z.coerce.number().int().positive();

export function money(n: number) {
  return Math.round(n * 100) / 100;
}

// Global warming potentials (AR4, as used by the UK F-gas regulation) for common refrigerants.
export const REFRIGERANT_GWP: Record<string, number> = {
  R32: 675, R410A: 2088, R407C: 1774, R404A: 3922, R134a: 1430, R448A: 1387, R449A: 1397,
  R22: 1810, R290: 3, R744: 1, R1234yf: 4, R513A: 631, R454B: 466,
};

export function co2eTonnes(refrigerant?: string | null, kg?: number | null): number | null {
  if (!refrigerant || kg == null) return null;
  const gwp = REFRIGERANT_GWP[refrigerant];
  if (gwp == null) return null;
  return Math.round(gwp * kg) / 1000;
}

/** Parse a partial update, keeping only keys the caller actually supplied (zod 4 applies defaults inside .partial()). */
export function parsePartial<T extends z.ZodObject<any>>(schema: T, input: unknown): Partial<z.infer<T>> {
  const parsed = parse(schema.partial(), input) as Record<string, unknown>;
  const supplied = input && typeof input === "object" ? Object.keys(input) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => supplied.includes(k))) as Partial<z.infer<T>>;
}
