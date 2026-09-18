import { z } from "zod";
import { getDb } from "../db.js";
import { conflict, forbidden, invalid, notFound } from "../errors.js";
import { Actor, can, require } from "../permissions.js";
import { addHours, now, parseLocal, weekdayIndex } from "../time.js";
import { logActivity } from "./activity.js";
import { activeContractsForSite } from "./customers.js";
import { getSetting } from "./settings.js";
import { nextRef, optStr, parse, reqStr } from "./util.js";

export const JOB_TYPES = ["reactive", "planned_maintenance", "quoted_works", "installation", "survey", "warranty"] as const;
export const PRIORITIES = ["emergency", "urgent", "routine", "planned"] as const;
export const OPEN_JOB_STATUSES = ["to_schedule", "scheduled", "in_progress", "on_hold"];
export const HOLD_REASONS = ["awaiting_parts", "awaiting_quote", "awaiting_access", "awaiting_customer", "review", "other"] as const;

export type JobType = (typeof JOB_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];

const HOLD_LABEL: Record<string, string> = {
  awaiting_parts: "awaiting parts",
  awaiting_quote: "awaiting quote decision",
  awaiting_access: "awaiting site access",
  awaiting_customer: "awaiting customer",
  review: "needs office review",
  other: "on hold",
};

// ---------- response targets ----------

export interface ResponseTarget {
  due: string | null;
  hours: number | null;
  source: string;
}

/**
 * Derive the response target for a newly logged job. Targets come from the covering
 * contract, or from configurable non-contract settings (unset by default). Planned
 * and quoted work has no response target — it is scheduled against a due date.
 */
export function computeResponseTarget(jobType: string, priority: string, contract: any | null, loggedAt: string): ResponseTarget {
  if (priority === "planned" || !["reactive", "warranty"].includes(jobType)) {
    return { due: null, hours: null, source: "Not applicable — planned/quoted work is scheduled against a due date" };
  }
  if (contract) {
    const hours = contract[`response_${priority}_hours`] as number | null;
    if (hours == null) return { due: null, hours: null, source: `Contract ${contract.reference} has no ${priority} response target` };
    return { due: addHours(loggedAt, hours), hours, source: `Contract ${contract.reference}: ${priority} response within ${hours}h (clock hours)` };
  }
  const hours = getSetting<number | null>(`noncontract_response_${priority}_hours`);
  if (hours == null) return { due: null, hours: null, source: "No contract — no committed response time (none configured for non-contract work)" };
  return { due: addHours(loggedAt, hours), hours, source: `No contract — configured non-contract ${priority} target of ${hours}h` };
}

export function isWithinWorkingHours(at: string): boolean {
  const days = getSetting<number[]>("working_days");
  const start = getSetting<string>("working_day_start");
  const end = getSetting<string>("working_day_end");
  const [date, time] = at.split("T");
  return days.includes(weekdayIndex(date)) && time.slice(0, 5) >= start && time.slice(0, 5) < end;
}

// ---------- create ----------

export const CreateJobInput = z.object({
  site_id: z.number().int().positive(),
  job_type: z.enum(JOB_TYPES),
  priority: z.enum(PRIORITIES),
  title: reqStr(200),
  description: optStr,
  equipment_ids: z.array(z.number().int().positive()).default([]),
  reported_via: z.enum(["phone", "email", "engineer", "planned", "quote", "other"]).optional().nullable(),
  reported_by_contact_id: z.number().int().positive().optional().nullable(),
  reported_by_name: optStr,
  customer_order_ref: optStr,
  estimated_hours: z.number().positive().max(500).optional().nullable(),
  due_date: optStr,
  /** undefined = resolve automatically; null = explicitly treat as non-contract work */
  contract_id: z.number().int().positive().nullable().optional(),
  quote_id: z.number().int().positive().optional().nullable(),
  parent_job_id: z.number().int().positive().optional().nullable(),
  ppm_key: z.string().optional().nullable(),
});

export type CreateJobData = z.input<typeof CreateJobInput>;

export function createJob(actor: Actor, input: unknown) {
  require(actor, "job.create");
  return insertJob(actor, parse(CreateJobInput, input));
}

/** Internal creation path shared by the UI, AI, quote conversion and PPM generation. */
export function insertJob(actor: Actor, d: z.infer<typeof CreateJobInput>) {
  const db = getDb();
  const warnings: string[] = [];
  const site = db
    .prepare("SELECT s.*, c.name AS customer_name, c.status AS customer_status, c.account_hold, c.account_hold_note FROM sites s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?")
    .get(d.site_id) as any;
  if (!site) throw notFound("Site");
  if (!site.active) throw invalid(`Site "${site.name}" is marked inactive`);
  if (site.customer_status === "inactive") throw invalid(`${site.customer_name} is an inactive customer`);
  if (site.account_hold) {
    if (getSetting<boolean>("block_jobs_on_account_hold")) {
      throw conflict(`${site.customer_name} is on account hold (${site.account_hold_note ?? "no reason recorded"}). New jobs are blocked by current settings.`);
    }
    warnings.push(`${site.customer_name} is on account hold: ${site.account_hold_note ?? "no reason recorded"}`);
  }
  if (d.priority === "planned" && d.job_type === "reactive") throw invalid("Reactive jobs need an emergency, urgent or routine priority");

  for (const eid of d.equipment_ids) {
    const e = db.prepare("SELECT site_id, status, asset_tag FROM equipment WHERE id = ?").get(eid) as any;
    if (!e) throw notFound(`Equipment ${eid}`);
    if (e.site_id !== d.site_id) throw invalid(`Equipment ${e.asset_tag ?? eid} is not at this site`);
    if (e.status === "decommissioned") throw invalid(`Equipment ${e.asset_tag ?? eid} is decommissioned`);
  }

  if (d.reported_by_contact_id) {
    const ct = db.prepare("SELECT customer_id FROM contacts WHERE id = ?").get(d.reported_by_contact_id) as any;
    if (!ct || ct.customer_id !== site.customer_id) throw invalid("Reporting contact does not belong to this customer");
  }

  // Contract resolution
  const loggedAt = now();
  let contract: any = null;
  const candidates = activeContractsForSite(d.site_id, loggedAt.slice(0, 10));
  if (d.contract_id && d.ppm_key) {
    // Planned maintenance generation has already validated the contract against the visit's due date.
    contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(d.contract_id);
  } else if (d.contract_id) {
    contract = candidates.find((k) => k.id === d.contract_id);
    if (!contract) throw invalid("That contract is not active for this site today");
  } else if (d.contract_id === undefined && candidates.length) {
    contract = candidates[0];
    if (candidates.length > 1) warnings.push(`Site is covered by ${candidates.length} active contracts; ${contract.reference} was applied — change it if another is correct.`);
  }

  const target = computeResponseTarget(d.job_type, d.priority, contract, loggedAt);
  if (["reactive", "warranty"].includes(d.job_type) && !isWithinWorkingHours(loggedAt)) {
    warnings.push(contract?.out_of_hours_cover ? `Logged out of hours — contract ${contract.reference} includes out-of-hours cover.` : "Logged outside normal working hours and the customer has no out-of-hours cover on record.");
  }

  const reference = nextRef("jobs", "J");
  const r = db
    .prepare(
      `INSERT INTO jobs (reference, customer_id, site_id, contract_id, job_type, priority, status, title, description, reported_via,
         reported_by_contact_id, reported_by_name, customer_order_ref, estimated_hours, due_date, response_due_at, response_target_source,
         quote_id, parent_job_id, ppm_key, created_by, created_at, updated_at)
       VALUES (@reference, @customer_id, @site_id, @contract_id, @job_type, @priority, 'to_schedule', @title, @description, @reported_via,
         @reported_by_contact_id, @reported_by_name, @customer_order_ref, @estimated_hours, @due_date, @response_due_at, @response_target_source,
         @quote_id, @parent_job_id, @ppm_key, @created_by, @now, @now)`,
    )
    .run({
      reference,
      customer_id: site.customer_id,
      site_id: d.site_id,
      contract_id: contract?.id ?? null,
      job_type: d.job_type,
      priority: d.priority,
      title: d.title,
      description: d.description ?? null,
      reported_via: d.reported_via ?? null,
      reported_by_contact_id: d.reported_by_contact_id ?? null,
      reported_by_name: d.reported_by_name ?? null,
      customer_order_ref: d.customer_order_ref ?? null,
      estimated_hours: d.estimated_hours ?? null,
      due_date: d.due_date ?? null,
      response_due_at: target.due,
      response_target_source: target.source,
      quote_id: d.quote_id ?? null,
      parent_job_id: d.parent_job_id ?? null,
      ppm_key: d.ppm_key ?? null,
      created_by: actor.id || null,
      now: loggedAt,
    });
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare("INSERT INTO job_equipment (job_id, equipment_id) VALUES (?, ?)");
  for (const eid of new Set(d.equipment_ids)) ins.run(id, eid);

  logActivity(actor, "job.create", `Logged ${d.job_type.replace("_", " ")} job ${reference}: ${d.title}${contract ? ` (contract ${contract.reference})` : " (no contract)"}`, {
    customer_id: site.customer_id, site_id: d.site_id, job_id: id, contract_id: contract?.id,
  }, { warnings, response: target });
  return { ...getJobRow(id), warnings };
}

/** What logging a job here would mean — shown on the form before the user commits. */
export function previewJob(actor: Actor, siteId: number, jobType: string, priority: string) {
  require(actor, "job.create");
  const db = getDb();
  const site = db.prepare("SELECT s.*, c.account_hold, c.account_hold_note, c.name AS customer_name FROM sites s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?").get(siteId) as any;
  if (!site) throw notFound("Site");
  const at = now();
  const candidates = activeContractsForSite(siteId, at.slice(0, 10));
  const contract = candidates[0] ?? null;
  const target = computeResponseTarget(jobType, priority, contract, at);
  const warnings: string[] = [];
  if (site.account_hold) warnings.push(`${site.customer_name} is on account hold: ${site.account_hold_note ?? ""}${getSetting<boolean>("block_jobs_on_account_hold") ? " — new jobs are blocked by current settings" : ""}`);
  if (candidates.length > 1) warnings.push(`Covered by ${candidates.length} contracts; ${contract.reference} will be applied.`);
  if (["reactive", "warranty"].includes(jobType) && !isWithinWorkingHours(at)) warnings.push(contract?.out_of_hours_cover ? "Out of hours — contract includes out-of-hours cover." : "Out of hours — no out-of-hours cover on record.");
  return {
    contract: contract ? { id: contract.id, reference: contract.reference, name: contract.name, out_of_hours_cover: !!contract.out_of_hours_cover, labour_included: !!contract.labour_included, parts_included: !!contract.parts_included } : null,
    target,
    warnings,
  };
}

// ---------- read ----------

export function getJobRow(id: number) {
  const j = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
  if (!j) throw notFound("Job");
  return j;
}

export function responseState(j: any): "none" | "met" | "missed" | "pending" | "at_risk" | "overdue" {
  if (!j.response_due_at) return "none";
  if (j.first_attended_at) return j.first_attended_at <= j.response_due_at ? "met" : "missed";
  if (["cancelled"].includes(j.status)) return "none";
  const n = now();
  if (n > j.response_due_at) return "overdue";
  const frac = getSetting<number>("response_at_risk_fraction");
  const total = parseLocal(j.response_due_at).getTime() - parseLocal(j.created_at).getTime();
  const elapsed = parseLocal(n).getTime() - parseLocal(j.created_at).getTime();
  return total > 0 && elapsed / total >= frac ? "at_risk" : "pending";
}

function assertJobRead(actor: Actor, job: any) {
  if (can(actor, "job.read")) return;
  if (actor.role === "engineer") {
    const assigned = getDb().prepare("SELECT 1 FROM visits WHERE job_id = ? AND engineer_id = ? AND status != 'cancelled'").get(job.id, actor.id);
    if (assigned) return;
  }
  throw forbidden("You can only view jobs you are assigned to");
}

export function getJob(actor: Actor, id: number) {
  const db = getDb();
  const j = db
    .prepare(
      `SELECT j.*, c.name AS customer_name, c.account_hold, c.account_hold_note, s.name AS site_name, s.address AS site_address, s.postcode AS site_postcode,
              s.access_notes, s.region AS site_region, k.reference AS contract_reference, k.name AS contract_name, k.labour_included, k.parts_included,
              u.name AS created_by_name, ct.name AS reported_by_contact_name, ct.phone AS reported_by_contact_phone,
              q.reference AS quote_reference, pj.reference AS parent_job_reference
       FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN sites s ON s.id = j.site_id
       LEFT JOIN contracts k ON k.id = j.contract_id LEFT JOIN users u ON u.id = j.created_by
       LEFT JOIN contacts ct ON ct.id = j.reported_by_contact_id LEFT JOIN quotes q ON q.id = j.quote_id
       LEFT JOIN jobs pj ON pj.id = j.parent_job_id
       WHERE j.id = ?`,
    )
    .get(id) as any;
  if (!j) throw notFound("Job");
  assertJobRead(actor, j);
  const equipment = db
    .prepare(`SELECT e.*, ec.label AS category_label FROM job_equipment je JOIN equipment e ON e.id = je.equipment_id JOIN equipment_categories ec ON ec.code = e.category WHERE je.job_id = ?`)
    .all(id);
  const visits = db
    .prepare(
      `SELECT v.*, u.name AS engineer_name,
        (SELECT COUNT(*) FROM visit_photos p WHERE p.visit_id = v.id) AS photo_count
       FROM visits v JOIN users u ON u.id = v.engineer_id WHERE v.job_id = ? ORDER BY v.scheduled_start`,
    )
    .all(id) as any[];
  for (const v of visits) {
    v.parts = db.prepare(`SELECT vp.*, COALESCE(p.name, vp.description) AS part_name, p.sku FROM visit_parts vp LEFT JOIN parts p ON p.id = vp.part_id WHERE vp.visit_id = ?`).all(v.id);
    v.equipment_checks = db.prepare(`SELECT ve.*, e.asset_tag, e.location FROM visit_equipment ve JOIN equipment e ON e.id = ve.equipment_id WHERE ve.visit_id = ?`).all(v.id);
    v.photos = db.prepare("SELECT * FROM visit_photos WHERE visit_id = ?").all(v.id);
  }
  const parts = db
    .prepare(
      `SELECT jp.*, p.sku, po.reference AS po_reference, po.status AS po_status, po.id AS po_id
       FROM job_parts jp LEFT JOIN parts p ON p.id = jp.part_id LEFT JOIN po_lines pl ON pl.id = jp.po_line_id LEFT JOIN purchase_orders po ON po.id = pl.po_id
       WHERE jp.job_id = ? ORDER BY jp.id`,
    )
    .all(id);
  const recommendations = db.prepare("SELECT r.*, e.asset_tag, q.reference AS quote_reference FROM recommendations r LEFT JOIN equipment e ON e.id = r.equipment_id LEFT JOIN quotes q ON q.id = r.quote_id WHERE r.job_id = ?").all(id);
  const quotes = can(actor, "quote.read")
    ? db.prepare("SELECT id, reference, revision, title, status FROM quotes WHERE origin_job_id = ? OR converted_job_id = ? ORDER BY id").all(id, id)
    : [];
  const followUps = db.prepare("SELECT id, reference, title, status FROM jobs WHERE parent_job_id = ?").all(id);
  const activity = db
    .prepare("SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.job_id = ? ORDER BY a.id DESC")
    .all(id);
  const pos = db.prepare("SELECT id, reference, status, expected_date FROM purchase_orders WHERE job_id = ?").all(id);
  const viaAi = (activity as any[]).some((a) => a.action === "job.create" && a.via === "ai");
  return { ...j, via_ai: viaAi, response_state: responseState(j), equipment, visits, parts, recommendations, quotes, follow_ups: followUps, activity, purchase_orders: pos };
}

export interface JobFilter {
  status?: string; // single status, or 'open'
  job_type?: string;
  priority?: string;
  customer_id?: number;
  site_id?: number;
  engineer_id?: number;
  query?: string;
  response?: string; // 'at_risk' | 'overdue'
  limit?: number;
}

export function listJobs(actor: Actor, f: JobFilter) {
  require(actor, "job.read");
  const where: string[] = [];
  const p: Record<string, unknown> = { limit: Math.min(f.limit ?? 200, 500) };
  if (f.status === "open") where.push(`j.status IN ('to_schedule','scheduled','in_progress','on_hold')`);
  else if (f.status) {
    where.push("j.status = @status");
    p.status = f.status;
  }
  for (const k of ["job_type", "priority", "customer_id", "site_id"] as const) {
    if (f[k]) {
      where.push(`j.${k} = @${k}`);
      p[k] = f[k];
    }
  }
  if (f.engineer_id) {
    where.push("EXISTS (SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.engineer_id = @engineer_id AND v.status != 'cancelled')");
    p.engineer_id = f.engineer_id;
  }
  if (f.query?.trim()) {
    where.push("(j.reference LIKE @q OR j.title LIKE @q OR j.description LIKE @q OR c.name LIKE @q OR s.name LIKE @q OR s.postcode LIKE @q)");
    p.q = `%${f.query.trim()}%`;
  }
  const rows = getDb()
    .prepare(
      `SELECT j.*, c.name AS customer_name, s.name AS site_name, s.postcode AS site_postcode, k.reference AS contract_reference,
        (SELECT MIN(v.scheduled_start) FROM visits v WHERE v.job_id = j.id AND v.status IN ('scheduled','travelling','on_site')) AS next_visit,
        (SELECT GROUP_CONCAT(DISTINCT u.name) FROM visits v JOIN users u ON u.id = v.engineer_id WHERE v.job_id = j.id AND v.status IN ('scheduled','travelling','on_site')) AS engineers
       FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN sites s ON s.id = j.site_id LEFT JOIN contracts k ON k.id = j.contract_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY CASE j.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'routine' THEN 2 ELSE 3 END,
                COALESCE(j.response_due_at, j.due_date || 'T23:59', j.created_at)
       LIMIT @limit`,
    )
    .all(p) as any[];
  let out = rows.map((j) => ({ ...j, response_state: responseState(j) }));
  if (f.response === "at_risk") out = out.filter((j) => ["at_risk", "overdue"].includes(j.response_state));
  if (f.response === "overdue") out = out.filter((j) => j.response_state === "overdue");
  return out;
}

// ---------- update & lifecycle ----------

const UpdateJobInput = z.object({
  title: reqStr(200).optional(),
  description: optStr,
  priority: z.enum(PRIORITIES).optional(),
  customer_order_ref: optStr,
  estimated_hours: z.number().positive().max(500).nullable().optional(),
  due_date: optStr,
  equipment_ids: z.array(z.number().int().positive()).optional(),
  next_action: optStr,
});

function refs(j: any) {
  return { customer_id: j.customer_id, site_id: j.site_id, job_id: j.id };
}

function assertOpen(j: any, what: string) {
  if (["closed", "cancelled"].includes(j.status)) throw conflict(`Cannot ${what}: job ${j.reference} is ${j.status}`);
}

export function updateJob(actor: Actor, id: number, input: unknown) {
  require(actor, "job.manage");
  const d = parse(UpdateJobInput, input);
  const db = getDb();
  const j = getJobRow(id);
  assertOpen(j, "edit job");
  return db.transaction(() => {
    const changes: string[] = [];
    const set: Record<string, unknown> = {};
    for (const k of ["title", "description", "customer_order_ref", "estimated_hours", "due_date", "next_action"] as const) {
      if (d[k] !== undefined && d[k] !== j[k]) {
        set[k] = d[k];
        changes.push(k.replace("_", " "));
      }
    }
    if (d.priority && d.priority !== j.priority) {
      if (d.priority === "planned" && j.job_type === "reactive") throw invalid("Reactive jobs need an emergency, urgent or routine priority");
      set.priority = d.priority;
      // Re-derive the response target from the original logging time; never silently keep a stale target.
      if (!j.first_attended_at) {
        const contract = j.contract_id ? db.prepare("SELECT * FROM contracts WHERE id = ?").get(j.contract_id) : null;
        const t = computeResponseTarget(j.job_type, d.priority, contract, j.created_at);
        set.response_due_at = t.due;
        set.response_target_source = t.source;
      }
      changes.push(`priority ${j.priority} → ${d.priority}`);
    }
    if (Object.keys(set).length) {
      db.prepare(`UPDATE jobs SET ${Object.keys(set).map((k) => `${k} = @${k}`).join(", ")}, updated_at = @now WHERE id = @id`).run({ ...set, now: now(), id });
    }
    if (d.equipment_ids) {
      for (const eid of d.equipment_ids) {
        const e = db.prepare("SELECT site_id FROM equipment WHERE id = ?").get(eid) as any;
        if (!e || e.site_id !== j.site_id) throw invalid(`Equipment ${eid} is not at this job's site`);
      }
      db.prepare("DELETE FROM job_equipment WHERE job_id = ?").run(id);
      const ins = db.prepare("INSERT INTO job_equipment (job_id, equipment_id) VALUES (?, ?)");
      for (const eid of new Set(d.equipment_ids)) ins.run(id, eid);
      changes.push("equipment");
    }
    if (changes.length) logActivity(actor, "job.update", `Updated ${changes.join(", ")}`, refs(j));
    return getJobRow(id);
  })();
}

export function addJobNote(actor: Actor, id: number, note: string) {
  const j = getJobRow(id);
  if (!can(actor, "job.manage") && !can(actor, "job.read")) {
    const assigned = getDb().prepare("SELECT 1 FROM visits WHERE job_id = ? AND engineer_id = ?").get(id, actor.id);
    if (!assigned) throw forbidden();
  }
  if (!note?.trim()) throw invalid("Note is empty");
  logActivity(actor, "job.note", note.trim(), refs(j));
  return { ok: true };
}

/** Re-derive job status from its visits. Explicit states (hold/completed/closed/cancelled) are kept. */
export function recomputeJobStatus(jobId: number) {
  const db = getDb();
  const j = getJobRow(jobId);
  if (["closed", "cancelled"].includes(j.status)) return j.status;
  const active = db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status IN ('travelling','on_site')").get(jobId) as any;
  const scheduled = db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status = 'scheduled'").get(jobId) as any;
  let status = j.status;
  if (active.n > 0) status = "in_progress";
  else if (j.status === "on_hold" || j.status === "completed") status = j.status;
  else if (scheduled.n > 0) status = "scheduled";
  else status = "to_schedule";
  if (status !== j.status) db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), jobId);
  return status;
}

export function setJobStatus(jobId: number, status: string, extra: Record<string, unknown> = {}) {
  const set = { status, ...extra, updated_at: now() };
  getDb().prepare(`UPDATE jobs SET ${Object.keys(set).map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id: jobId });
}

export function holdJob(actor: Actor, id: number, reason: string, note?: string | null) {
  require(actor, "job.manage");
  if (!(HOLD_REASONS as readonly string[]).includes(reason)) throw invalid("Unknown hold reason");
  const j = getJobRow(id);
  assertOpen(j, "put job on hold");
  if (j.status === "completed") throw conflict("Completed jobs cannot be put on hold — reopen first");
  const db = getDb();
  const active = db.prepare("SELECT 1 FROM visits WHERE job_id = ? AND status IN ('travelling','on_site')").get(id);
  if (active) throw conflict("An engineer is currently travelling to or on site for this job");
  db.transaction(() => {
    setJobStatus(id, "on_hold", { hold_reason: reason, next_action: note?.trim() || null });
    logActivity(actor, "job.hold", `Put on hold (${HOLD_LABEL[reason]})${note ? `: ${note}` : ""}`, refs(j));
  })();
  const scheduled = db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status = 'scheduled'").get(id) as any;
  return { ...getJobRow(id), warnings: scheduled.n ? [`${scheduled.n} visit(s) are still booked — cancel them if the engineer should not attend.`] : [] };
}

export function releaseHold(actor: Actor, id: number, note?: string | null, system = false) {
  if (!system) require(actor, "job.manage");
  const j = getJobRow(id);
  if (j.status !== "on_hold") throw conflict(`Job ${j.reference} is not on hold`);
  getDb().transaction(() => {
    setJobStatus(id, "to_schedule", { hold_reason: null, next_action: note?.trim() || null });
    recomputeJobStatus(id);
    logActivity(actor, "job.release", `Taken off hold${note ? `: ${note}` : ""}`, refs(j));
  })();
  return getJobRow(id);
}

export function cancelJob(actor: Actor, id: number, reason: string) {
  require(actor, "job.manage");
  if (!reason?.trim()) throw invalid("A cancellation reason is required");
  const j = getJobRow(id);
  assertOpen(j, "cancel");
  if (j.status === "completed") throw conflict("Completed jobs cannot be cancelled");
  const db = getDb();
  const active = db.prepare("SELECT 1 FROM visits WHERE job_id = ? AND status IN ('travelling','on_site')").get(id);
  if (active) throw conflict("An engineer is travelling to or on site for this job — complete or abort that visit first");
  return db.transaction(() => {
    const cancelled = db.prepare("UPDATE visits SET status = 'cancelled', cancelled_reason = ? WHERE job_id = ? AND status = 'scheduled'").run(`Job cancelled: ${reason}`, id);
    const partsCancelled = db.prepare("UPDATE job_parts SET status = 'cancelled' WHERE job_id = ? AND status IN ('needed')").run(id);
    setJobStatus(id, "cancelled", { cancelled_reason: reason.trim(), hold_reason: null });
    logActivity(actor, "job.cancel", `Cancelled: ${reason}${cancelled.changes ? ` (${cancelled.changes} booked visit(s) cancelled)` : ""}`, refs(j));
    const warnings: string[] = [];
    const ordered = db.prepare("SELECT COUNT(*) n FROM job_parts WHERE job_id = ? AND status = 'ordered'").get(id) as any;
    if (ordered.n) warnings.push(`${ordered.n} part line(s) are already on order for this job — review the purchase order.`);
    if (partsCancelled.changes) warnings.push(`${partsCancelled.changes} outstanding parts requirement(s) were cancelled.`);
    return { ...getJobRow(id), warnings };
  })();
}

/** Office marks work complete (e.g. after reviewing visits). */
export function completeJob(actor: Actor, id: number, note?: string | null) {
  require(actor, "job.manage");
  const j = getJobRow(id);
  assertOpen(j, "complete");
  if (j.status === "completed") return j;
  const db = getDb();
  const open = db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status IN ('scheduled','travelling','on_site')").get(id) as any;
  if (open.n) throw conflict(`Job has ${open.n} visit(s) still booked or in progress — complete or cancel them first`);
  const done = db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status = 'completed'").get(id) as any;
  if (!done.n && !note?.trim()) throw invalid("No visit has been completed on this job; add a note explaining how the work was completed");
  db.transaction(() => {
    setJobStatus(id, "completed", { completed_at: now(), hold_reason: null });
    logActivity(actor, "job.complete", `Marked complete${note ? `: ${note}` : ""}`, refs(j));
  })();
  return getJobRow(id);
}

export function reopenJob(actor: Actor, id: number, reason: string) {
  require(actor, "job.manage");
  if (!reason?.trim()) throw invalid("Give a reason for reopening");
  const j = getJobRow(id);
  if (j.status !== "completed") throw conflict("Only completed (not yet closed) jobs can be reopened");
  getDb().transaction(() => {
    setJobStatus(id, "to_schedule", { completed_at: null, next_action: reason.trim() });
    recomputeJobStatus(id);
    logActivity(actor, "job.reopen", `Reopened: ${reason}`, refs(j));
  })();
  return getJobRow(id);
}

/** Closing = office has reviewed the completed job and it is ready to pass to accounts. */
export function closeJob(actor: Actor, id: number, note?: string | null) {
  require(actor, "job.close");
  const j = getJobRow(id);
  if (j.status !== "completed") throw conflict(`Only completed jobs can be closed (job is ${j.status.replace("_", " ")})`);
  const db = getDb();
  const warnings: string[] = [];
  const openRecs = db.prepare("SELECT COUNT(*) n FROM recommendations WHERE job_id = ? AND status = 'open'").get(id) as any;
  if (openRecs.n) warnings.push(`${openRecs.n} engineer recommendation(s) from this job are still open.`);
  db.transaction(() => {
    setJobStatus(id, "closed", { closed_at: now() });
    logActivity(actor, "job.close", `Closed${note ? `: ${note}` : ""}`, refs(j));
  })();
  return { ...getJobRow(id), warnings };
}

export { HOLD_LABEL };
