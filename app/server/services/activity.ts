import { getDb } from "../db.js";
import { Actor } from "../permissions.js";
import { now } from "../time.js";

export interface ActivityRefs {
  customer_id?: number | null;
  site_id?: number | null;
  job_id?: number | null;
  visit_id?: number | null;
  quote_id?: number | null;
  equipment_id?: number | null;
  contract_id?: number | null;
  po_id?: number | null;
}

export function logActivity(actor: Actor, action: string, summary: string, refs: ActivityRefs, details?: unknown) {
  getDb()
    .prepare(
      `INSERT INTO activity (at, user_id, via, action, summary, customer_id, site_id, job_id, visit_id, quote_id, equipment_id, contract_id, po_id, details)
       VALUES (@at, @user_id, @via, @action, @summary, @customer_id, @site_id, @job_id, @visit_id, @quote_id, @equipment_id, @contract_id, @po_id, @details)`,
    )
    .run({
      at: now(),
      user_id: actor.id || null,
      via: actor.via ?? "ui",
      action,
      summary,
      customer_id: refs.customer_id ?? null,
      site_id: refs.site_id ?? null,
      job_id: refs.job_id ?? null,
      visit_id: refs.visit_id ?? null,
      quote_id: refs.quote_id ?? null,
      equipment_id: refs.equipment_id ?? null,
      contract_id: refs.contract_id ?? null,
      po_id: refs.po_id ?? null,
      details: details === undefined ? null : JSON.stringify(details),
    });
}

export function listActivity(filter: ActivityRefs & { via?: string; limit?: number }) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  for (const k of ["customer_id", "site_id", "job_id", "visit_id", "quote_id", "equipment_id", "contract_id", "po_id"] as const) {
    if (filter[k]) {
      where.push(`a.${k} = @${k}`);
      params[k] = filter[k];
    }
  }
  if (filter.via) {
    where.push("a.via = @via");
    params.via = filter.via;
  }
  params.limit = Math.min(filter.limit ?? 100, 500);
  return getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT @limit`,
    )
    .all(params);
}
