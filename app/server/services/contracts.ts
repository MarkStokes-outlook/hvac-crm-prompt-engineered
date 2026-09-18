import { z } from "zod";
import { getDb } from "../db.js";
import { conflict, invalid, notFound } from "../errors.js";
import { Actor, require } from "../permissions.js";
import { addDays, addMonths, isValidDate, now, today } from "../time.js";
import { logActivity } from "./activity.js";
import { insertJob } from "./jobs.js";
import { optStr, parse, parsePartial, reqStr } from "./util.js";

const ContractInput = z.object({
  customer_id: z.number().int().positive(),
  reference: reqStr(50),
  name: reqStr(200),
  start_date: z.string().refine(isValidDate, "start_date must be YYYY-MM-DD"),
  end_date: z.string().refine(isValidDate, "end_date must be YYYY-MM-DD"),
  status: z.enum(["draft", "active", "suspended", "ended"]).default("active"),
  response_emergency_hours: z.number().positive().nullable().optional(),
  response_urgent_hours: z.number().positive().nullable().optional(),
  response_routine_hours: z.number().positive().nullable().optional(),
  out_of_hours_cover: z.boolean().default(false),
  ppm_visits_per_year: z.number().int().min(0).max(52).nullable().optional(),
  ppm_visit_hours: z.number().positive().max(100).nullable().optional(),
  labour_included: z.boolean().default(false),
  parts_included: z.boolean().default(false),
  annual_value: z.number().nonnegative().nullable().optional(),
  terms_notes: optStr,
  site_ids: z.array(z.number().int().positive()).default([]),
});

function contractStatusLabel(k: any) {
  const t = today();
  if (k.status !== "active") return k.status;
  if (k.end_date < t) return "expired";
  if (k.start_date > t) return "future";
  if (k.end_date <= addDays(t, 60)) return "expiring";
  return "active";
}

export function listContracts(actor: Actor, f: { customer_id?: number } = {}) {
  require(actor, "contract.read");
  const rows = getDb()
    .prepare(
      `SELECT k.*, c.name AS customer_name, (SELECT COUNT(*) FROM contract_sites cs WHERE cs.contract_id = k.id) AS site_count
       FROM contracts k JOIN customers c ON c.id = k.customer_id ${f.customer_id ? "WHERE k.customer_id = @customer_id" : ""} ORDER BY k.end_date`,
    )
    .all(f.customer_id ? { customer_id: f.customer_id } : {}) as any[];
  return rows.map((k) => ({ ...k, effective_status: contractStatusLabel(k) }));
}

export function getContract(actor: Actor, id: number) {
  require(actor, "contract.read");
  const db = getDb();
  const k = db.prepare("SELECT k.*, c.name AS customer_name FROM contracts k JOIN customers c ON c.id = k.customer_id WHERE k.id = ?").get(id) as any;
  if (!k) throw notFound("Contract");
  const sites = db
    .prepare(`SELECT s.*, (SELECT COUNT(*) FROM equipment e WHERE e.site_id = s.id AND e.status != 'decommissioned') AS equipment_count FROM contract_sites cs JOIN sites s ON s.id = cs.site_id WHERE cs.contract_id = ? ORDER BY s.name`)
    .all(id);
  const jobs = db
    .prepare(`SELECT j.id, j.reference, j.title, j.job_type, j.priority, j.status, j.due_date, j.created_at, j.response_due_at, j.first_attended_at, s.name AS site_name FROM jobs j JOIN sites s ON s.id = j.site_id WHERE j.contract_id = ? ORDER BY COALESCE(j.due_date, j.created_at) DESC LIMIT 200`)
    .all(id) as any[];
  const reactive = jobs.filter((j) => j.response_due_at);
  const met = reactive.filter((j) => j.first_attended_at && j.first_attended_at <= j.response_due_at).length;
  const missed = reactive.filter((j) => (j.first_attended_at && j.first_attended_at > j.response_due_at) || (!j.first_attended_at && j.response_due_at < now())).length;
  return { ...k, effective_status: contractStatusLabel(k), sites, jobs, response_summary: { with_target: reactive.length, met, missed } };
}

function validateSites(customerId: number, siteIds: number[]) {
  for (const sid of siteIds) {
    const s = getDb().prepare("SELECT customer_id FROM sites WHERE id = ?").get(sid) as any;
    if (!s || s.customer_id !== customerId) throw invalid(`Site ${sid} does not belong to this customer`);
  }
}

function toRow(d: any) {
  const b = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
  return { ...d, out_of_hours_cover: b(d.out_of_hours_cover), labour_included: b(d.labour_included), parts_included: b(d.parts_included) };
}

export function createContract(actor: Actor, input: unknown) {
  require(actor, "contract.write");
  const d = parse(ContractInput, input);
  if (d.end_date < d.start_date) throw invalid("End date is before start date");
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM customers WHERE id = ?").get(d.customer_id)) throw notFound("Customer");
  if (db.prepare("SELECT 1 FROM contracts WHERE reference = ?").get(d.reference)) throw invalid(`Contract reference ${d.reference} already exists`);
  validateSites(d.customer_id, d.site_ids);
  return db.transaction(() => {
    const { site_ids, ...rest } = toRow(d);
    const cols = Object.keys(rest);
    const r = db.prepare(`INSERT INTO contracts (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`).run(
      Object.fromEntries(cols.map((c) => [c, rest[c] ?? null])),
    );
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare("INSERT INTO contract_sites (contract_id, site_id) VALUES (?, ?)");
    for (const s of new Set(site_ids as number[])) ins.run(id, s);
    logActivity(actor, "contract.create", `Created contract ${d.reference} (${d.start_date} to ${d.end_date})`, { customer_id: d.customer_id, contract_id: id });
    return getContract(actor, id);
  })();
}

export function updateContract(actor: Actor, id: number, input: unknown) {
  require(actor, "contract.write");
  const k = getContract(actor, id);
  const d = parsePartial(ContractInput.omit({ customer_id: true }), input);
  const start = d.start_date ?? k.start_date;
  const end = d.end_date ?? k.end_date;
  if (end < start) throw invalid("End date is before start date");
  if (d.site_ids) validateSites(k.customer_id, d.site_ids);
  const db = getDb();
  return db.transaction(() => {
    const { site_ids, ...rest } = toRow(d);
    const fields = Object.keys(rest).filter((f) => rest[f] !== undefined);
    if (fields.length) db.prepare(`UPDATE contracts SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...Object.fromEntries(fields.map((f) => [f, rest[f]])), id });
    if (site_ids) {
      db.prepare("DELETE FROM contract_sites WHERE contract_id = ?").run(id);
      const ins = db.prepare("INSERT INTO contract_sites (contract_id, site_id) VALUES (?, ?)");
      for (const s of new Set(site_ids as number[])) ins.run(id, s);
    }
    logActivity(actor, "contract.update", `Updated contract ${k.reference} (${[...fields, ...(site_ids ? ["sites"] : [])].join(", ")}) — existing jobs keep the response targets set when they were logged`, {
      customer_id: k.customer_id, contract_id: id,
    });
    return getContract(actor, id);
  })();
}

/**
 * Generate planned-maintenance jobs for visits falling due in [from, to]. Visits are spaced
 * evenly across each contract year from the start date. Idempotent via ppm_key.
 */
export function generatePlannedMaintenance(actor: Actor, contractId: number, from: string, to: string) {
  require(actor, "contract.generate_ppm");
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw invalid("Give a valid date range");
  const db = getDb();
  const k = db.prepare("SELECT * FROM contracts WHERE id = ?").get(contractId) as any;
  if (!k) throw notFound("Contract");
  if (k.status !== "active") throw conflict(`Contract ${k.reference} is ${k.status}`);
  if (!k.ppm_visits_per_year) throw invalid(`Contract ${k.reference} has no planned maintenance frequency set`);
  const sites = db.prepare("SELECT s.* FROM contract_sites cs JOIN sites s ON s.id = cs.site_id WHERE cs.contract_id = ? AND s.active = 1").all(contractId) as any[];
  if (!sites.length) throw invalid("Contract covers no active sites");
  const created: any[] = [];
  const skipped: string[] = [];
  const intervalMonths = 12 / k.ppm_visits_per_year;
  return db.transaction(() => {
    for (let i = 0; ; i++) {
      const monthsOffset = i * intervalMonths;
      const due = addDays(addMonths(k.start_date, Math.floor(monthsOffset)), Math.round((monthsOffset % 1) * 30));
      if (due > k.end_date || due > to) break;
      if (due < from) continue;
      for (const s of sites) {
        const key = `${k.id}:${s.id}:${due}`;
        if (db.prepare("SELECT 1 FROM jobs WHERE ppm_key = ?").get(key)) {
          skipped.push(`${s.name} ${due}`);
          continue;
        }
        const equipment = (db.prepare("SELECT id FROM equipment WHERE site_id = ? AND status = 'active'").all(s.id) as any[]).map((e) => e.id);
        const visitNo = (i % k.ppm_visits_per_year) + 1;
        const job = insertJob(actor, {
          site_id: s.id,
          job_type: "planned_maintenance",
          priority: "planned",
          title: `Planned maintenance ${visitNo}/${k.ppm_visits_per_year} — ${s.name}`,
          description: `Scheduled service under contract ${k.reference}. ${equipment.length} active asset(s) on site.`,
          equipment_ids: equipment,
          reported_via: "planned",
          estimated_hours: k.ppm_visit_hours ?? null,
          due_date: due,
          contract_id: k.id,
          ppm_key: key,
        } as any);
        created.push({ id: job.id, reference: job.reference, site: s.name, due_date: due });
      }
    }
    logActivity(actor, "contract.generate_ppm", `Generated ${created.length} planned maintenance job(s) for ${from} to ${to}${skipped.length ? `; ${skipped.length} already existed` : ""}`, {
      customer_id: k.customer_id, contract_id: k.id,
    });
    return { created, skipped };
  })();
}
