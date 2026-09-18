import { z } from "zod";
import { getDb } from "../db.js";
import { conflict, invalid, notFound } from "../errors.js";
import { Actor, require } from "../permissions.js";
import { addDays, now, today } from "../time.js";
import { logActivity } from "./activity.js";
import { getJobRow, insertJob, recomputeJobStatus, setJobStatus } from "./jobs.js";
import { getSetting } from "./settings.js";
import { money, nextRef, optStr, parse, parsePartial, reqStr } from "./util.js";

const LineInput = z.object({
  line_type: z.enum(["labour", "part", "material", "subcontract", "other"]),
  description: reqStr(1000),
  part_id: z.number().int().positive().nullable().optional(),
  equipment_id: z.number().int().positive().nullable().optional(),
  quantity: z.number().positive().max(100000),
  unit_price: z.number().nonnegative().max(10_000_000),
});

const QuoteInput = z.object({
  customer_id: z.number().int().positive(),
  site_id: z.number().int().positive().nullable().optional(),
  contact_id: z.number().int().positive().nullable().optional(),
  origin_job_id: z.number().int().positive().nullable().optional(),
  recommendation_ids: z.array(z.number().int().positive()).optional(),
  quote_type: z.enum(["repair", "installation", "replacement", "other"]),
  title: reqStr(200),
  scope: optStr,
  valid_until: optStr,
  lines: z.array(LineInput).default([]),
});

export function totals(lines: { quantity: number; unit_price: number }[], vatRate: number) {
  const net = money(lines.reduce((a, l) => a + l.quantity * l.unit_price, 0));
  const vat = money(net * vatRate);
  return { net, vat, gross: money(net + vat) };
}

function validateRefs(d: { customer_id: number; site_id?: number | null; contact_id?: number | null; origin_job_id?: number | null; lines: any[] }) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM customers WHERE id = ?").get(d.customer_id)) throw notFound("Customer");
  if (d.site_id) {
    const s = db.prepare("SELECT customer_id FROM sites WHERE id = ?").get(d.site_id) as any;
    if (!s || s.customer_id !== d.customer_id) throw invalid("Site does not belong to this customer");
  }
  if (d.contact_id) {
    const c = db.prepare("SELECT customer_id FROM contacts WHERE id = ?").get(d.contact_id) as any;
    if (!c || c.customer_id !== d.customer_id) throw invalid("Contact does not belong to this customer");
  }
  if (d.origin_job_id) {
    const j = getJobRow(d.origin_job_id);
    if (j.customer_id !== d.customer_id) throw invalid("Originating job is for a different customer");
  }
  for (const l of d.lines) {
    if (l.part_id && !db.prepare("SELECT 1 FROM parts WHERE id = ?").get(l.part_id)) throw notFound(`Part ${l.part_id}`);
    if (l.equipment_id) {
      const e = db.prepare("SELECT site_id FROM equipment WHERE id = ?").get(l.equipment_id) as any;
      if (!e || (d.site_id && e.site_id !== d.site_id)) throw invalid("Quoted equipment is not at the quote's site");
    }
  }
}

function writeLines(quoteId: number, lines: z.infer<typeof LineInput>[]) {
  const db = getDb();
  db.prepare("DELETE FROM quote_lines WHERE quote_id = ?").run(quoteId);
  const ins = db.prepare("INSERT INTO quote_lines (quote_id, sort, line_type, description, part_id, equipment_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  lines.forEach((l, i) => ins.run(quoteId, i, l.line_type, l.description, l.part_id ?? null, l.equipment_id ?? null, l.quantity, l.unit_price));
}

export function createQuote(actor: Actor, input: unknown) {
  require(actor, "quote.write");
  const d = parse(QuoteInput, input);
  validateRefs(d);
  const db = getDb();
  return db.transaction(() => {
    const ref = nextRef("quotes", "Q", 20001);
    const t = now();
    const validUntil = d.valid_until ?? addDays(today(), getSetting<number>("quote_validity_days"));
    const r = db
      .prepare(
        `INSERT INTO quotes (reference, revision, customer_id, site_id, contact_id, origin_job_id, quote_type, title, scope, status, valid_until, vat_rate, prepared_by, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(ref, d.customer_id, d.site_id ?? null, d.contact_id ?? null, d.origin_job_id ?? null, d.quote_type, d.title, d.scope, validUntil, getSetting<number>("vat_rate"), actor.id, t, t);
    const id = Number(r.lastInsertRowid);
    writeLines(id, d.lines);
    for (const rid of d.recommendation_ids ?? []) {
      const rec = db.prepare("SELECT * FROM recommendations WHERE id = ?").get(rid) as any;
      if (!rec) throw notFound(`Recommendation ${rid}`);
      if (rec.status !== "open") throw conflict(`Recommendation ${rid} is already ${rec.status}`);
      db.prepare("UPDATE recommendations SET status = 'quoted', quote_id = ? WHERE id = ?").run(id, rid);
    }
    logActivity(actor, "quote.create", `Drafted quote ${ref}: ${d.title}`, { customer_id: d.customer_id, site_id: d.site_id, quote_id: id, job_id: d.origin_job_id });
    return getQuote(actor, id);
  })();
}

export function updateQuote(actor: Actor, id: number, input: unknown) {
  require(actor, "quote.write");
  const q = quoteRow(id);
  if (q.status !== "draft") throw conflict(`Quote ${q.reference} rev ${q.revision} has been ${q.status}; create a revision to change it`);
  const d = parsePartial(QuoteInput.omit({ customer_id: true, recommendation_ids: true }), input);
  validateRefs({ customer_id: q.customer_id, site_id: d.site_id ?? q.site_id, contact_id: d.contact_id, origin_job_id: d.origin_job_id, lines: d.lines ?? [] });
  const db = getDb();
  return db.transaction(() => {
    const set: Record<string, unknown> = {};
    for (const k of ["site_id", "contact_id", "quote_type", "title", "scope", "valid_until"] as const) if (d[k] !== undefined) set[k] = d[k];
    set.updated_at = now();
    db.prepare(`UPDATE quotes SET ${Object.keys(set).map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id });
    if (d.lines) writeLines(id, d.lines);
    logActivity(actor, "quote.update", `Edited draft ${q.reference}`, { customer_id: q.customer_id, quote_id: id });
    return getQuote(actor, id);
  })();
}

function quoteRow(id: number) {
  const q = getDb().prepare("SELECT * FROM quotes WHERE id = ?").get(id) as any;
  if (!q) throw notFound("Quote");
  return q;
}

export function isExpired(q: any) {
  return q.status === "sent" && q.valid_until && q.valid_until < today();
}

export function getQuote(actor: Actor, id: number) {
  require(actor, "quote.read");
  const db = getDb();
  const q = db
    .prepare(
      `SELECT q.*, c.name AS customer_name, c.billing_address, c.account_hold, s.name AS site_name, s.address AS site_address, ct.name AS contact_name, ct.email AS contact_email,
              u.name AS prepared_by_name, oj.reference AS origin_job_reference, cj.reference AS converted_job_reference, sq.reference AS superseded_by_reference, sq.revision AS superseded_by_revision
       FROM quotes q JOIN customers c ON c.id = q.customer_id LEFT JOIN sites s ON s.id = q.site_id LEFT JOIN contacts ct ON ct.id = q.contact_id
       LEFT JOIN users u ON u.id = q.prepared_by LEFT JOIN jobs oj ON oj.id = q.origin_job_id LEFT JOIN jobs cj ON cj.id = q.converted_job_id LEFT JOIN quotes sq ON sq.id = q.superseded_by_id
       WHERE q.id = ?`,
    )
    .get(id) as any;
  if (!q) throw notFound("Quote");
  const lines = db.prepare("SELECT ql.*, p.sku, e.asset_tag FROM quote_lines ql LEFT JOIN parts p ON p.id = ql.part_id LEFT JOIN equipment e ON e.id = ql.equipment_id WHERE quote_id = ? ORDER BY sort, id").all(id) as any[];
  const revisions = db.prepare("SELECT id, revision, status, created_at FROM quotes WHERE reference = ? ORDER BY revision").all(q.reference);
  const recommendations = db.prepare("SELECT * FROM recommendations WHERE quote_id = ?").all(id);
  const activity = db.prepare("SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.quote_id IN (SELECT id FROM quotes WHERE reference = ?) ORDER BY a.id DESC").all(q.reference);
  return { ...q, lines, ...totals(lines, q.vat_rate), expired: isExpired(q), revisions, recommendations, activity };
}

export function listQuotes(actor: Actor, f: { status?: string; customer_id?: number; query?: string }) {
  require(actor, "quote.read");
  const where: string[] = ["q.status != 'superseded'"];
  const p: Record<string, unknown> = {};
  if (f.status === "open") where.push("q.status IN ('draft','sent')");
  else if (f.status === "awaiting_conversion") where.push("q.status = 'accepted' AND q.converted_job_id IS NULL");
  else if (f.status) {
    where.push("q.status = @status");
    p.status = f.status;
  }
  if (f.customer_id) {
    where.push("q.customer_id = @customer_id");
    p.customer_id = f.customer_id;
  }
  if (f.query?.trim()) {
    where.push("(q.reference LIKE @q OR q.title LIKE @q OR c.name LIKE @q)");
    p.q = `%${f.query.trim()}%`;
  }
  const rows = getDb()
    .prepare(
      `SELECT q.*, c.name AS customer_name, s.name AS site_name, u.name AS prepared_by_name,
        (SELECT COALESCE(SUM(quantity*unit_price),0) FROM quote_lines WHERE quote_id = q.id) AS net_total
       FROM quotes q JOIN customers c ON c.id = q.customer_id LEFT JOIN sites s ON s.id = q.site_id LEFT JOIN users u ON u.id = q.prepared_by
       WHERE ${where.join(" AND ")} ORDER BY q.updated_at DESC LIMIT 300`,
    )
    .all(p) as any[];
  return rows.map((q) => ({ ...q, net_total: money(q.net_total), expired: isExpired(q) }));
}

function qrefs(q: any) {
  return { customer_id: q.customer_id, site_id: q.site_id, quote_id: q.id, job_id: q.origin_job_id };
}

export function sendQuote(actor: Actor, id: number) {
  require(actor, "quote.send");
  const q = getQuote(actor, id);
  if (q.status !== "draft") throw conflict(`Quote is already ${q.status}`);
  if (!q.lines.length) throw invalid("Add at least one line before sending");
  if (q.net <= 0) throw invalid("Quote total must be greater than zero");
  if (!q.valid_until || q.valid_until < today()) throw invalid("Set a validity date in the future before sending");
  getDb().prepare("UPDATE quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  // Sending is recorded here; delivery (email/print) happens outside the system.
  logActivity(actor, "quote.send", `Issued ${q.reference} rev ${q.revision} to customer (£${q.gross.toFixed(2)} inc VAT)`, qrefs(q));
  return getQuote(actor, id);
}

const AcceptInput = z.object({
  decision_by_name: reqStr(200),
  customer_po: optStr,
  create_job: z.boolean().default(true),
});

export function acceptQuote(actor: Actor, id: number, input: unknown) {
  require(actor, "quote.decide");
  const d = parse(AcceptInput, input);
  const q = getQuote(actor, id);
  if (q.status !== "sent") throw conflict(`Only sent quotes can be accepted (this one is ${q.status})`);
  const warnings: string[] = [];
  if (q.expired) warnings.push(`Quote validity expired on ${q.valid_until}; accepted anyway — check prices are still valid.`);
  if (q.account_hold) warnings.push("Customer is on account hold.");
  const db = getDb();
  const out = db.transaction(() => {
    db.prepare("UPDATE quotes SET status = 'accepted', decided_at = ?, decision_by_name = ?, customer_po = ?, updated_at = ? WHERE id = ?").run(now(), d.decision_by_name, d.customer_po, now(), id);
    logActivity(actor, "quote.accept", `Customer accepted ${q.reference} rev ${q.revision} (${d.decision_by_name}${d.customer_po ? `, PO ${d.customer_po}` : ""})`, qrefs(q));
    let job = null;
    if (d.create_job) job = convertQuote(actor, id, { skipPermission: true });
    return { job };
  })();
  return { ...getQuote(actor, id), warnings, created_job: out.job };
}

export function rejectQuote(actor: Actor, id: number, reason: string, byName?: string | null) {
  require(actor, "quote.decide");
  if (!reason?.trim()) throw invalid("Record why the quote was rejected");
  const q = getQuote(actor, id);
  if (q.status !== "sent") throw conflict(`Only sent quotes can be rejected (this one is ${q.status})`);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE quotes SET status = 'rejected', decided_at = ?, decision_by_name = ?, rejection_reason = ?, updated_at = ? WHERE id = ?").run(now(), byName ?? null, reason.trim(), now(), id);
    logActivity(actor, "quote.reject", `Customer rejected ${q.reference}: ${reason}`, qrefs(q));
    // A job waiting on this quote must not sit on hold forever — flag it for office review.
    if (q.origin_job_id) {
      const j = getJobRow(q.origin_job_id);
      if (j.status === "on_hold" && j.hold_reason === "awaiting_quote") {
        setJobStatus(j.id, "on_hold", { hold_reason: "review", next_action: `Quote ${q.reference} rejected (${reason}) — decide whether to complete or close this job` });
        logActivity(actor, "job.review", `Quote ${q.reference} was rejected; job needs office review`, { job_id: j.id, customer_id: j.customer_id, site_id: j.site_id });
      }
    }
  })();
  return getQuote(actor, id);
}

export function withdrawQuote(actor: Actor, id: number, reason: string) {
  require(actor, "quote.write");
  const q = getQuote(actor, id);
  if (!["draft", "sent"].includes(q.status)) throw conflict(`A ${q.status} quote cannot be withdrawn`);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE quotes SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(now(), id);
    db.prepare("UPDATE recommendations SET status = 'open', quote_id = NULL WHERE quote_id = ?").run(id);
    logActivity(actor, "quote.withdraw", `Withdrew ${q.reference}: ${reason}`, qrefs(q));
  })();
  return getQuote(actor, id);
}

/** Create a new revision of a sent/rejected quote; the old one becomes superseded. */
export function reviseQuote(actor: Actor, id: number) {
  require(actor, "quote.write");
  const q = getQuote(actor, id);
  if (!["sent", "rejected"].includes(q.status)) throw conflict(`Only sent or rejected quotes can be revised (this one is ${q.status})`);
  const db = getDb();
  return db.transaction(() => {
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO quotes (reference, revision, customer_id, site_id, contact_id, origin_job_id, quote_type, title, scope, status, valid_until, vat_rate, prepared_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(q.reference, q.revision + 1, q.customer_id, q.site_id, q.contact_id, q.origin_job_id, q.quote_type, q.title, q.scope, addDays(today(), getSetting<number>("quote_validity_days")), getSetting<number>("vat_rate"), actor.id, t, t);
    const newId = Number(r.lastInsertRowid);
    writeLines(newId, q.lines);
    db.prepare("UPDATE quotes SET status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ?").run(newId, t, id);
    db.prepare("UPDATE recommendations SET quote_id = ? WHERE quote_id = ?").run(newId, id);
    logActivity(actor, "quote.revise", `Created revision ${q.revision + 1} of ${q.reference}`, { ...qrefs(q), quote_id: newId });
    return getQuote(actor, newId);
  })();
}

/**
 * Turn an accepted quote into operational work. If the quote came from a job that is on hold
 * awaiting this quote, that job resumes; otherwise a new job is created. Parts on the quote
 * become the job's parts requirements. Idempotent: a quote converts at most once.
 */
export function convertQuote(actor: Actor, id: number, opts: { skipPermission?: boolean } = {}) {
  if (!opts.skipPermission) require(actor, "quote.convert");
  const db = getDb();
  const q = getQuote(actor, id);
  if (q.status !== "accepted") throw conflict("Only accepted quotes can become work");
  if (q.converted_job_id) throw conflict(`Already converted to job ${q.converted_job_reference}`);
  if (!q.site_id) throw invalid("Set a site on the quote before converting it to a job");
  return db.transaction(() => {
    let jobId: number;
    const origin = q.origin_job_id ? getJobRow(q.origin_job_id) : null;
    if (origin && origin.status === "on_hold" && ["awaiting_quote", "review"].includes(origin.hold_reason)) {
      jobId = origin.id;
      setJobStatus(jobId, "to_schedule", { hold_reason: null, quote_id: id, next_action: `Quote ${q.reference} accepted — book the quoted work`, customer_order_ref: q.customer_po ?? origin.customer_order_ref });
      recomputeJobStatus(jobId);
      logActivity(actor, "job.quote_accepted", `Quote ${q.reference} accepted — job resumed for the quoted work`, { job_id: jobId, customer_id: q.customer_id, site_id: q.site_id, quote_id: id });
    } else {
      const equipmentIds = [...new Set(q.lines.map((l: any) => l.equipment_id).filter(Boolean))] as number[];
      const labourHours = q.lines.filter((l: any) => l.line_type === "labour").reduce((a: number, l: any) => a + l.quantity, 0);
      const job = insertJob(actor, {
        site_id: q.site_id,
        job_type: q.quote_type === "repair" ? "quoted_works" : q.quote_type === "other" ? "quoted_works" : "installation",
        priority: "routine",
        title: q.title,
        description: `From accepted quote ${q.reference} rev ${q.revision}.${q.scope ? `\n\n${q.scope}` : ""}`,
        equipment_ids: equipmentIds,
        reported_via: "quote",
        customer_order_ref: q.customer_po,
        estimated_hours: labourHours || null,
        quote_id: id,
        parent_job_id: origin?.id ?? null,
      } as any);
      jobId = job.id;
    }
    const ins = db.prepare("INSERT INTO job_parts (job_id, part_id, description, quantity, status, created_at) VALUES (?, ?, ?, ?, 'needed', ?)");
    for (const l of q.lines.filter((l: any) => l.line_type === "part" || (l.line_type === "material" && l.part_id))) ins.run(jobId, l.part_id ?? null, l.description, l.quantity, now());
    db.prepare("UPDATE quotes SET converted_job_id = ?, updated_at = ? WHERE id = ?").run(jobId, now(), id);
    const job = getJobRow(jobId);
    logActivity(actor, "quote.convert", `Converted ${q.reference} into job ${job.reference}`, { ...qrefs(q), job_id: jobId });
    return job;
  })();
}

// ---------- recommendations ----------

export function listRecommendations(actor: Actor, status = "open") {
  require(actor, "recommendation.read");
  return getDb()
    .prepare(
      `SELECT r.*, s.name AS site_name, s.customer_id, c.name AS customer_name, e.asset_tag, e.manufacturer, e.model, j.reference AS job_reference, u.name AS raised_by_name, q.reference AS quote_reference
       FROM recommendations r JOIN sites s ON s.id = r.site_id JOIN customers c ON c.id = s.customer_id LEFT JOIN equipment e ON e.id = r.equipment_id
       LEFT JOIN jobs j ON j.id = r.job_id LEFT JOIN users u ON u.id = r.raised_by LEFT JOIN quotes q ON q.id = r.quote_id
       ${status === "all" ? "" : "WHERE r.status = @status"}
       ORDER BY CASE r.urgency WHEN 'safety' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.created_at DESC`,
    )
    .all(status === "all" ? {} : { status });
}

export function dismissRecommendation(actor: Actor, id: number, reason: string) {
  require(actor, "recommendation.manage");
  if (!reason?.trim()) throw invalid("Give a reason");
  const db = getDb();
  const r = db.prepare("SELECT r.*, s.customer_id FROM recommendations r JOIN sites s ON s.id = r.site_id WHERE r.id = ?").get(id) as any;
  if (!r) throw notFound("Recommendation");
  if (r.status !== "open") throw conflict(`Recommendation is already ${r.status}`);
  db.prepare("UPDATE recommendations SET status = 'dismissed', dismissed_reason = ? WHERE id = ?").run(reason.trim(), id);
  logActivity(actor, "recommendation.dismiss", `Dismissed recommendation: ${r.description} (${reason})`, { customer_id: r.customer_id, site_id: r.site_id, job_id: r.job_id, equipment_id: r.equipment_id });
  return { ok: true };
}
