import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { UPLOAD_DIR, getDb } from "../db.js";
import { AppError, conflict, forbidden, invalid, notFound } from "../errors.js";
import { Actor, can, require } from "../permissions.js";
import { addDays, addHours, isValidDate, isValidDateTime, minutesBetween, now, parseLocal, today, weekdayIndex } from "../time.js";
import { logActivity } from "./activity.js";
import { getJobRow, HOLD_LABEL, recomputeJobStatus, setJobStatus } from "./jobs.js";
import { getSetting } from "./settings.js";
import { recordMovement, vanForEngineer } from "./stock.js";
import { optStr, parse } from "./util.js";

const OPEN_VISIT = ["scheduled", "travelling", "on_site"];

export interface ScheduleIssue {
  code: "overlap" | "absence" | "outside_hours" | "non_working_day" | "job_on_hold" | "in_past" | "skill_gap" | "after_due" | "response_due";
  message: string;
}

function engineerRow(id: number) {
  const e = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!e || e.role !== "engineer") throw invalid("Selected user is not an engineer");
  if (!e.active) throw invalid(`${e.name} is not active`);
  return { ...e, skills: JSON.parse(e.skills) as string[] };
}

function jobSkillHints(jobId: number): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT ec.suggested_skill s FROM job_equipment je JOIN equipment e ON e.id = je.equipment_id JOIN equipment_categories ec ON ec.code = e.category WHERE je.job_id = ? AND ec.suggested_skill IS NOT NULL`)
    .all(jobId) as any[];
  return rows.map((r) => r.s);
}

/** Checks that a user can override after seeing them (none of these are hard rules). */
export function checkSlot(jobId: number, engineerId: number, start: string, end: string, ignoreVisitId?: number): ScheduleIssue[] {
  const db = getDb();
  const issues: ScheduleIssue[] = [];
  const job = getJobRow(jobId);
  const eng = engineerRow(engineerId);
  const overlaps = db
    .prepare(
      `SELECT v.id, v.scheduled_start, v.scheduled_end, j.reference FROM visits v JOIN jobs j ON j.id = v.job_id
       WHERE v.engineer_id = ? AND v.status IN ('scheduled','travelling','on_site') AND v.id != ?
         AND v.scheduled_start < ? AND v.scheduled_end > ?`,
    )
    .all(engineerId, ignoreVisitId ?? 0, end, start) as any[];
  for (const o of overlaps) {
    issues.push({ code: "overlap", message: `${eng.name} is already booked on ${o.reference} ${o.scheduled_start.slice(11)}–${o.scheduled_end.slice(11)}` });
  }
  const absences = db.prepare("SELECT * FROM engineer_absences WHERE user_id = ? AND start_at < ? AND end_at > ?").all(engineerId, end, start) as any[];
  for (const a of absences) issues.push({ code: "absence", message: `${eng.name} is unavailable (${a.kind}${a.note ? `: ${a.note}` : ""}) ${a.start_at.replace("T", " ")} – ${a.end_at.replace("T", " ")}` });
  const days = getSetting<number[]>("working_days");
  const ds = getSetting<string>("working_day_start");
  const de = getSetting<string>("working_day_end");
  if (!days.includes(weekdayIndex(start.slice(0, 10)))) issues.push({ code: "non_working_day", message: "Visit falls on a non-working day" });
  else if (start.slice(11, 16) < ds || end.slice(0, 10) !== start.slice(0, 10) || end.slice(11, 16) > de) {
    issues.push({ code: "outside_hours", message: `Visit is outside normal working hours (${ds}–${de})` });
  }
  if (job.status === "on_hold") issues.push({ code: "job_on_hold", message: `Job is on hold (${HOLD_LABEL[job.hold_reason] ?? job.hold_reason}); booking a visit will take it off hold` });
  if (start < now()) issues.push({ code: "in_past", message: "Start time is in the past" });
  const hints = jobSkillHints(jobId);
  const missing = hints.filter((h) => !eng.skills.includes(h));
  if (missing.length) issues.push({ code: "skill_gap", message: `${eng.name} is not recorded as having: ${missing.join(", ")}` });
  if (job.due_date && start.slice(0, 10) > job.due_date) issues.push({ code: "after_due", message: `Visit is after the job's target date (${job.due_date})` });
  if (job.response_due_at && !job.first_attended_at && start > job.response_due_at) {
    issues.push({ code: "response_due", message: `Visit starts after the response target (${job.response_due_at.replace("T", " ")})` });
  }
  return issues;
}

const ScheduleInput = z.object({
  job_id: z.number().int().positive(),
  engineer_id: z.number().int().positive(),
  start: z.string().refine(isValidDateTime, "start must be YYYY-MM-DDTHH:MM"),
  end: z.string().refine(isValidDateTime, "end must be YYYY-MM-DDTHH:MM").optional(),
  duration_hours: z.number().positive().max(24).optional(),
  instructions: optStr,
  /** The user has seen the listed issues and wants to proceed anyway. */
  acknowledge: z.boolean().optional(),
});

function needsConfirmation(issues: ScheduleIssue[]) {
  return new AppError(409, "needs_confirmation", `Please confirm: ${issues.map((i) => i.message).join("; ")}`, { issues });
}

export function scheduleVisit(actor: Actor, input: unknown) {
  require(actor, "schedule.manage");
  const d = parse(ScheduleInput, input);
  const end = d.end ?? addHours(d.start, d.duration_hours ?? getSetting<number>("default_visit_hours"));
  if (end <= d.start) throw invalid("Visit must end after it starts");
  if (minutesBetween(d.start, end) > 24 * 60) throw invalid("A single visit cannot exceed 24 hours — book multiple visits");
  const job = getJobRow(d.job_id);
  if (["completed", "closed", "cancelled"].includes(job.status)) throw conflict(`Job ${job.reference} is ${job.status}; reopen it before booking more visits`);
  const issues = checkSlot(d.job_id, d.engineer_id, d.start, end);
  if (issues.length && !d.acknowledge) throw needsConfirmation(issues);
  const db = getDb();
  const eng = engineerRow(d.engineer_id);
  return db.transaction(() => {
    const r = db
      .prepare(`INSERT INTO visits (job_id, engineer_id, scheduled_start, scheduled_end, status, instructions, created_by, created_at) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)`)
      .run(d.job_id, d.engineer_id, d.start, end, d.instructions ?? null, actor.id || null, now());
    const visitId = Number(r.lastInsertRowid);
    if (job.status === "on_hold") setJobStatus(d.job_id, "to_schedule", { hold_reason: null });
    recomputeJobStatus(d.job_id);
    logActivity(
      actor,
      "visit.schedule",
      `Booked ${eng.name} for ${d.start.replace("T", " ")}–${end.slice(11)}${issues.length ? ` (overrode: ${issues.map((i) => i.code).join(", ")})` : ""}`,
      { customer_id: job.customer_id, site_id: job.site_id, job_id: job.id, visit_id: visitId },
      { issues },
    );
    return { ...getVisitRow(visitId), overridden: issues };
  })();
}

const RescheduleInput = z.object({
  engineer_id: z.number().int().positive().optional(),
  start: z.string().refine(isValidDateTime).optional(),
  end: z.string().refine(isValidDateTime).optional(),
  acknowledge: z.boolean().optional(),
});

export function rescheduleVisit(actor: Actor, visitId: number, input: unknown) {
  require(actor, "schedule.manage");
  const d = parse(RescheduleInput, input);
  const v = getVisitRow(visitId);
  if (v.status !== "scheduled") throw conflict(`Only scheduled visits can be moved (this one is ${v.status.replace("_", " ")})`);
  const engineerId = d.engineer_id ?? v.engineer_id;
  const start = d.start ?? v.scheduled_start;
  const end = d.end ?? (d.start ? addHours(start, minutesBetween(v.scheduled_start, v.scheduled_end) / 60) : v.scheduled_end);
  if (end <= start) throw invalid("Visit must end after it starts");
  const issues = checkSlot(v.job_id, engineerId, start, end, visitId).filter((i) => i.code !== "job_on_hold");
  if (issues.length && !d.acknowledge) throw needsConfirmation(issues);
  const job = getJobRow(v.job_id);
  const eng = engineerRow(engineerId);
  getDb().prepare("UPDATE visits SET engineer_id = ?, scheduled_start = ?, scheduled_end = ? WHERE id = ?").run(engineerId, start, end, visitId);
  logActivity(actor, "visit.reschedule", `Moved visit from ${v.engineer_name} ${v.scheduled_start.replace("T", " ")} to ${eng.name} ${start.replace("T", " ")}–${end.slice(11)}`, {
    customer_id: job.customer_id, site_id: job.site_id, job_id: job.id, visit_id: visitId,
  }, { issues });
  return { ...getVisitRow(visitId), overridden: issues };
}

export function cancelVisit(actor: Actor, visitId: number, reason: string) {
  require(actor, "schedule.manage");
  if (!reason?.trim()) throw invalid("Give a reason for cancelling the visit");
  const v = getVisitRow(visitId);
  if (!["scheduled", "travelling"].includes(v.status)) throw conflict(`Visit is ${v.status.replace("_", " ")} and cannot be cancelled`);
  const job = getJobRow(v.job_id);
  getDb().transaction(() => {
    getDb().prepare("UPDATE visits SET status = 'cancelled', cancelled_reason = ? WHERE id = ?").run(reason.trim(), visitId);
    recomputeJobStatus(v.job_id);
    logActivity(actor, "visit.cancel", `Cancelled ${v.engineer_name}'s visit on ${v.scheduled_start.replace("T", " ")}: ${reason}`, {
      customer_id: job.customer_id, site_id: job.site_id, job_id: job.id, visit_id: visitId,
    });
  })();
  return getVisitRow(visitId);
}

export function getVisitRow(id: number) {
  const v = getDb().prepare("SELECT v.*, u.name AS engineer_name FROM visits v JOIN users u ON u.id = v.engineer_id WHERE v.id = ?").get(id) as any;
  if (!v) throw notFound("Visit");
  return v;
}

// ---------- board & availability ----------

export function engineers(opts: { includeInactive?: boolean } = {}) {
  return (getDb().prepare(`SELECT id, name, email, phone, job_title, skills, base_region, is_subcontractor, active FROM users WHERE role = 'engineer' ${opts.includeInactive ? "" : "AND active = 1"} ORDER BY name`).all() as any[]).map((e) => ({
    ...e,
    skills: JSON.parse(e.skills),
  }));
}

export function scheduleBoard(actor: Actor, from: string, days = 1) {
  require(actor, "schedule.read");
  if (!isValidDate(from)) throw invalid("from must be YYYY-MM-DD");
  const to = addDays(from, Math.min(Math.max(days, 1), 14));
  const db = getDb();
  const visits = db
    .prepare(
      `SELECT v.*, j.reference AS job_reference, j.title AS job_title, j.priority, j.job_type, j.status AS job_status, s.name AS site_name, s.postcode, c.name AS customer_name
       FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
       WHERE v.status != 'cancelled' AND v.scheduled_start < ? AND v.scheduled_end > ? ORDER BY v.scheduled_start`,
    )
    .all(`${to}T00:00`, `${from}T00:00`);
  const absences = db.prepare("SELECT * FROM engineer_absences WHERE start_at < ? AND end_at > ?").all(`${to}T00:00`, `${from}T00:00`);
  return {
    from,
    to,
    working_day_start: getSetting("working_day_start"),
    working_day_end: getSetting("working_day_end"),
    working_days: getSetting("working_days"),
    engineers: engineers(),
    visits,
    absences,
  };
}

/** Free intervals for an engineer on a date within working hours. */
export function freeSlots(engineerId: number, date: string, ignoreVisitId?: number): { start: string; end: string }[] {
  const db = getDb();
  const ds = getSetting<string>("working_day_start");
  const de = getSetting<string>("working_day_end");
  const dayStart = `${date}T${ds}`;
  const dayEnd = `${date}T${de}`;
  const busy = [
    ...(db
      .prepare(`SELECT scheduled_start s, scheduled_end e FROM visits WHERE engineer_id = ? AND status IN ('scheduled','travelling','on_site') AND id != ? AND scheduled_start < ? AND scheduled_end > ?`)
      .all(engineerId, ignoreVisitId ?? 0, dayEnd, dayStart) as any[]),
    ...(db.prepare("SELECT start_at s, end_at e FROM engineer_absences WHERE user_id = ? AND start_at < ? AND end_at > ?").all(engineerId, dayEnd, dayStart) as any[]),
  ].sort((a, b) => a.s.localeCompare(b.s));
  const slots: { start: string; end: string }[] = [];
  let cursor = dayStart;
  const n = now();
  if (date === today() && n > cursor) {
    // round up to next quarter hour
    const d = parseLocal(n);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    const pad = (x: number) => String(x).padStart(2, "0");
    cursor = `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  for (const b of busy) {
    if (b.s > cursor) slots.push({ start: cursor, end: b.s < dayEnd ? b.s : dayEnd });
    if (b.e > cursor) cursor = b.e;
  }
  if (cursor < dayEnd) slots.push({ start: cursor, end: dayEnd });
  return slots.filter((s) => s.end > s.start && minutesBetween(s.start, s.end) >= 30);
}

export interface EngineerSuggestion {
  engineer_id: number;
  name: string;
  score: number;
  earliest_start: string | null;
  free_minutes: number;
  visits_that_day: number;
  reasons: string[];
  concerns: string[];
}

/**
 * Rank engineers for a job on a given date. This is a transparent heuristic — it explains
 * every factor so a coordinator (or the assistant) can judge it; it never books anything.
 */
export function suggestEngineers(actor: Actor, jobId: number, date: string, durationHours?: number): EngineerSuggestion[] {
  require(actor, "schedule.read");
  if (!isValidDate(date)) throw invalid("date must be YYYY-MM-DD");
  const db = getDb();
  const job = getJobRow(jobId);
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(job.site_id) as any;
  const hours = durationHours ?? job.estimated_hours ?? getSetting<number>("default_visit_hours");
  const needMin = Math.round(Math.min(hours, 12) * 60);
  const hints = jobSkillHints(jobId);
  const out: EngineerSuggestion[] = [];
  for (const e of engineers()) {
    const reasons: string[] = [];
    const concerns: string[] = [];
    let score = 0;
    const slots = freeSlots(e.id, date);
    const fit = slots.find((s) => minutesBetween(s.start, s.end) >= needMin);
    const freeMinutes = slots.reduce((a, s) => a + minutesBetween(s.start, s.end), 0);
    const absent = db.prepare("SELECT kind FROM engineer_absences WHERE user_id = ? AND start_at < ? AND end_at > ?").get(e.id, `${date}T23:59`, `${date}T00:00`) as any;
    if (absent && !fit) {
      concerns.push(`Unavailable (${absent.kind})`);
      score -= 100;
    } else if (fit) {
      score += 30;
      reasons.push(`Free from ${fit.start.slice(11)} for ${Math.floor(minutesBetween(fit.start, fit.end) / 60)}h${minutesBetween(fit.start, fit.end) % 60 ? `${minutesBetween(fit.start, fit.end) % 60}m` : ""}`);
    } else {
      concerns.push(freeMinutes ? `No single ${hours}h gap (only ${Math.round(freeMinutes / 6) / 10}h free in total)` : "Fully booked");
      score -= 40;
    }
    const matched = hints.filter((h) => e.skills.includes(h));
    const missing = hints.filter((h) => !e.skills.includes(h));
    if (hints.length) {
      score += matched.length * 15;
      if (matched.length) reasons.push(`Skills: ${matched.join(", ")}`);
      if (missing.length) {
        concerns.push(`Not recorded as having: ${missing.join(", ")}`);
        score -= missing.length * 20;
      }
    }
    const prior = db
      .prepare(`SELECT COUNT(*) n, MAX(v.scheduled_start) last FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.engineer_id = ? AND j.site_id = ? AND v.status = 'completed'`)
      .get(e.id, job.site_id) as any;
    if (prior.n) {
      score += Math.min(prior.n, 4) * 5;
      reasons.push(`Knows the site (${prior.n} previous visit${prior.n > 1 ? "s" : ""}, last ${prior.last.slice(0, 10)})`);
    }
    if (site.region && e.base_region) {
      if (site.region === e.base_region) {
        score += 10;
        reasons.push(`Based in ${e.base_region}`);
      } else concerns.push(`Based in ${e.base_region}; site is in ${site.region}`);
    }
    const count = (db.prepare(`SELECT COUNT(*) n FROM visits WHERE engineer_id = ? AND status IN ('scheduled','travelling','on_site','completed') AND substr(scheduled_start,1,10) = ?`).get(e.id, date) as any).n;
    score -= count * 3;
    if (e.is_subcontractor) {
      concerns.push("Subcontract engineer");
      score -= 5;
    }
    out.push({ engineer_id: e.id, name: e.name, score, earliest_start: fit?.start ?? null, free_minutes: freeMinutes, visits_that_day: count, reasons, concerns });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- absences ----------

const AbsenceInput = z.object({
  user_id: z.number().int().positive(),
  start_at: z.string().refine(isValidDateTime),
  end_at: z.string().refine(isValidDateTime),
  kind: z.enum(["holiday", "sick", "training", "other"]),
  note: optStr,
});

export function createAbsence(actor: Actor, input: unknown) {
  require(actor, "absence.manage");
  const d = parse(AbsenceInput, input);
  if (d.end_at <= d.start_at) throw invalid("Absence must end after it starts");
  const eng = engineerRow(d.user_id);
  const db = getDb();
  const r = db.prepare("INSERT INTO engineer_absences (user_id, start_at, end_at, kind, note) VALUES (?, ?, ?, ?, ?)").run(d.user_id, d.start_at, d.end_at, d.kind, d.note);
  const clashes = db
    .prepare(`SELECT v.id, v.scheduled_start, j.reference FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.engineer_id = ? AND v.status = 'scheduled' AND v.scheduled_start < ? AND v.scheduled_end > ?`)
    .all(d.user_id, d.end_at, d.start_at) as any[];
  logActivity(actor, "absence.create", `Recorded ${d.kind} for ${eng.name}: ${d.start_at.replace("T", " ")} – ${d.end_at.replace("T", " ")}`, {});
  return {
    id: Number(r.lastInsertRowid),
    warnings: clashes.map((c) => `${eng.name} has a visit on ${c.reference} at ${c.scheduled_start.replace("T", " ")} that now needs rebooking`),
    clashing_visits: clashes,
  };
}

export function deleteAbsence(actor: Actor, id: number) {
  require(actor, "absence.manage");
  const a = getDb().prepare("SELECT a.*, u.name FROM engineer_absences a JOIN users u ON u.id = a.user_id WHERE a.id = ?").get(id) as any;
  if (!a) throw notFound("Absence");
  getDb().prepare("DELETE FROM engineer_absences WHERE id = ?").run(id);
  logActivity(actor, "absence.delete", `Removed ${a.kind} for ${a.name} (${a.start_at.replace("T", " ")})`, {});
  return { ok: true };
}

// ---------- engineer workflow ----------

/** An engineer may work only their own visits; office roles with visit.edit_any may correct any visit. */
function assertVisitWork(actor: Actor, v: any) {
  if (can(actor, "visit.edit_any")) return;
  if (can(actor, "visit.work_own") && v.engineer_id === actor.id) return;
  throw forbidden("This visit is not assigned to you");
}

function assertEditable(v: any, actor: Actor) {
  if (v.status === "cancelled") throw conflict("This visit was cancelled");
  if (["completed", "no_access"].includes(v.status) && !can(actor, "visit.edit_any")) throw conflict("This visit has been completed; ask the office to make corrections");
}

export function myVisits(actor: Actor, from: string, to: string) {
  const rows = getDb()
    .prepare(
      `SELECT v.*, j.reference AS job_reference, j.title AS job_title, j.priority, j.job_type, j.status AS job_status,
              s.name AS site_name, s.address AS site_address, s.postcode, c.name AS customer_name
       FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
       WHERE v.engineer_id = ? AND v.status != 'cancelled'
         AND ((v.scheduled_start >= ? AND v.scheduled_start < ?) OR v.status IN ('travelling','on_site'))
       ORDER BY v.scheduled_start`,
    )
    .all(actor.id, `${from}T00:00`, `${addDays(to, 1)}T00:00`);
  return rows;
}

export function getVisitDetail(actor: Actor, id: number) {
  const db = getDb();
  const v = getVisitRow(id);
  if (!can(actor, "job.read")) assertVisitWork(actor, v);
  const job = db
    .prepare(
      `SELECT j.*, c.name AS customer_name, s.name AS site_name, s.address AS site_address, s.postcode, s.access_notes, k.reference AS contract_reference,
              k.labour_included, k.parts_included, ct.name AS reported_by_contact_name, ct.phone AS reported_by_contact_phone
       FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN sites s ON s.id = j.site_id LEFT JOIN contracts k ON k.id = j.contract_id
       LEFT JOIN contacts ct ON ct.id = j.reported_by_contact_id WHERE j.id = ?`,
    )
    .get(v.job_id) as any;
  const siteContacts = db.prepare("SELECT name, role, phone, email FROM contacts WHERE customer_id = ? AND (site_id = ? OR site_id IS NULL) ORDER BY site_id IS NULL, is_primary DESC").all(job.customer_id, job.site_id);
  const jobEquipment = new Set((db.prepare("SELECT equipment_id FROM job_equipment WHERE job_id = ?").all(v.job_id) as any[]).map((r) => r.equipment_id));
  const equipment = (
    db.prepare(`SELECT e.*, ec.label AS category_label FROM equipment e JOIN equipment_categories ec ON ec.code = e.category WHERE e.site_id = ? AND e.status != 'decommissioned' ORDER BY e.location, e.asset_tag`).all(job.site_id) as any[]
  ).map((e) => {
    const last = db
      .prepare(
        `SELECT v.scheduled_start, ve.condition, ve.notes, u.name AS engineer_name, j.reference FROM visit_equipment ve JOIN visits v ON v.id = ve.visit_id JOIN users u ON u.id = v.engineer_id JOIN jobs j ON j.id = v.job_id
         WHERE ve.equipment_id = ? AND v.id != ? AND v.status = 'completed' ORDER BY v.scheduled_start DESC LIMIT 3`,
      )
      .all(e.id, id);
    return { ...e, on_job: jobEquipment.has(e.id), recent: last };
  });
  const checks = db.prepare("SELECT * FROM visit_equipment WHERE visit_id = ?").all(id);
  const parts = db.prepare(`SELECT vp.*, COALESCE(p.name, vp.description) AS part_name, p.sku, p.unit FROM visit_parts vp LEFT JOIN parts p ON p.id = vp.part_id WHERE vp.visit_id = ?`).all(id);
  const photos = db.prepare("SELECT * FROM visit_photos WHERE visit_id = ? ORDER BY id").all(id);
  const recommendations = db.prepare("SELECT * FROM recommendations WHERE visit_id = ? ORDER BY id").all(id);
  const otherVisits = db
    .prepare(`SELECT v.id, v.scheduled_start, v.status, v.outcome, v.work_notes, v.outcome_notes, u.name AS engineer_name FROM visits v JOIN users u ON u.id = v.engineer_id WHERE v.job_id = ? AND v.id != ? AND v.status != 'cancelled' ORDER BY v.scheduled_start`)
    .all(v.job_id, id);
  const siteHistory = db
    .prepare(
      `SELECT j.reference, j.title, j.job_type, j.status, j.created_at, (SELECT MAX(v2.scheduled_start) FROM visits v2 WHERE v2.job_id = j.id AND v2.status='completed') AS last_visit
       FROM jobs j WHERE j.site_id = ? AND j.id != ? ORDER BY j.created_at DESC LIMIT 8`,
    )
    .all(job.site_id, v.job_id);
  const jobParts = db.prepare("SELECT jp.*, p.sku FROM job_parts jp LEFT JOIN parts p ON p.id = jp.part_id WHERE jp.job_id = ? AND jp.status != 'cancelled'").all(v.job_id);
  return { ...v, job, site_contacts: siteContacts, equipment, checks, parts, photos, recommendations, other_visits: otherVisits, site_history: siteHistory, job_parts: jobParts };
}

function visitRefs(v: any) {
  const j = getJobRow(v.job_id);
  return { customer_id: j.customer_id, site_id: j.site_id, job_id: j.id, visit_id: v.id };
}

export function startTravel(actor: Actor, id: number) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  if (v.status !== "scheduled") throw conflict(`Visit is already ${v.status.replace("_", " ")}`);
  const db = getDb();
  const other = db.prepare("SELECT j.reference FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.engineer_id = ? AND v.status IN ('travelling','on_site') AND v.id != ?").get(v.engineer_id, id) as any;
  if (other) throw conflict(`Finish your visit on ${other.reference} first`);
  db.transaction(() => {
    db.prepare("UPDATE visits SET status = 'travelling', travel_started_at = ? WHERE id = ?").run(now(), id);
    recomputeJobStatus(v.job_id);
    logActivity(actor, "visit.travel", `${v.engineer_name} travelling to site`, visitRefs(v));
  })();
  return getVisitRow(id);
}

export function arrive(actor: Actor, id: number) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  if (!["scheduled", "travelling"].includes(v.status)) throw conflict(`Visit is already ${v.status.replace("_", " ")}`);
  const db = getDb();
  const other = db.prepare("SELECT j.reference FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.engineer_id = ? AND v.status IN ('travelling','on_site') AND v.id != ?").get(v.engineer_id, id) as any;
  if (other) throw conflict(`Finish your visit on ${other.reference} first`);
  const t = now();
  db.transaction(() => {
    db.prepare("UPDATE visits SET status = 'on_site', arrived_at = ? WHERE id = ?").run(t, id);
    const job = getJobRow(v.job_id);
    if (!job.first_attended_at) db.prepare("UPDATE jobs SET first_attended_at = ? WHERE id = ?").run(t, v.job_id);
    recomputeJobStatus(v.job_id);
    logActivity(actor, "visit.arrive", `${v.engineer_name} arrived on site`, visitRefs(v));
  })();
  return getVisitRow(id);
}

const NotesInput = z.object({ work_notes: z.string().max(20000).nullable().optional() });

export function saveNotes(actor: Actor, id: number, input: unknown) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  const d = parse(NotesInput, input);
  getDb().prepare("UPDATE visits SET work_notes = ? WHERE id = ?").run(d.work_notes ?? null, id);
  return getVisitRow(id);
}

const CheckInput = z.object({
  equipment_id: z.number().int().positive(),
  condition: z.enum(["good", "attention", "failed", "not_checked"]),
  readings: optStr,
  notes: optStr,
});

export function recordEquipmentCheck(actor: Actor, id: number, input: unknown) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  const d = parse(CheckInput, input);
  const db = getDb();
  const job = getJobRow(v.job_id);
  const e = db.prepare("SELECT site_id FROM equipment WHERE id = ?").get(d.equipment_id) as any;
  if (!e || e.site_id !== job.site_id) throw invalid("Equipment is not at this site");
  db.prepare(
    `INSERT INTO visit_equipment (visit_id, equipment_id, condition, readings, notes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(visit_id, equipment_id) DO UPDATE SET condition = excluded.condition, readings = excluded.readings, notes = excluded.notes`,
  ).run(id, d.equipment_id, d.condition, d.readings, d.notes);
  // Attach equipment to the job so its history is complete.
  db.prepare("INSERT OR IGNORE INTO job_equipment (job_id, equipment_id) VALUES (?, ?)").run(v.job_id, d.equipment_id);
  return db.prepare("SELECT * FROM visit_equipment WHERE visit_id = ?").all(id);
}

const PartInput = z.object({
  part_id: z.number().int().positive().nullable().optional(),
  description: optStr,
  quantity: z.number().positive().max(1000),
});

export function addVisitPart(actor: Actor, id: number, input: unknown) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  const d = parse(PartInput, input);
  if (!d.part_id && !d.description) throw invalid("Choose a catalogue part or describe the item");
  const db = getDb();
  const warnings: string[] = [];
  return db.transaction(() => {
    let movementId: number | null = null;
    let locationId: number | null = null;
    if (d.part_id) {
      const van = vanForEngineer(v.engineer_id);
      if (!van) throw invalid(`${v.engineer_name} has no van stock location`);
      locationId = van.id;
      // Van records are often imperfect; recording what was actually fitted matters more than blocking,
      // so stock may go negative and is flagged for reconciliation.
      const m = recordMovement({ part_id: d.part_id, from_location_id: van.id, quantity: d.quantity, reason: "used", visit_id: id, user_id: actor.id, allowNegative: true });
      movementId = m.id;
      if (m.resulting_from_quantity! < 0) warnings.push(`Van stock for this part is now ${m.resulting_from_quantity} — the office will need to reconcile it`);
    }
    const r = db
      .prepare("INSERT INTO visit_parts (visit_id, part_id, description, quantity, location_id, movement_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, d.part_id ?? null, d.description ?? null, d.quantity, locationId, movementId);
    const name = d.part_id ? (db.prepare("SELECT name FROM parts WHERE id = ?").get(d.part_id) as any)?.name : d.description;
    logActivity(actor, "visit.part_used", `Used ${d.quantity} × ${name}${d.part_id ? " from van stock" : " (non-stock item)"}`, visitRefs(v));
    return { id: Number(r.lastInsertRowid), warnings };
  })();
}

export function removeVisitPart(actor: Actor, visitId: number, partLineId: number) {
  const v = getVisitRow(visitId);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  const db = getDb();
  const line = db.prepare("SELECT * FROM visit_parts WHERE id = ? AND visit_id = ?").get(partLineId, visitId) as any;
  if (!line) throw notFound("Part line");
  db.transaction(() => {
    if (line.part_id && line.location_id) {
      recordMovement({ part_id: line.part_id, to_location_id: line.location_id, quantity: line.quantity, reason: "return", visit_id: visitId, user_id: actor.id, note: "Removed from visit record" });
    }
    db.prepare("DELETE FROM visit_parts WHERE id = ?").run(partLineId);
    logActivity(actor, "visit.part_removed", `Removed part line (${line.quantity} × ${line.description ?? "part " + line.part_id}) and returned it to van stock`, visitRefs(v));
  })();
  return { ok: true };
}

export function addPhoto(actor: Actor, visitId: number, file: { buffer: Buffer; mimetype: string; originalname: string }, caption?: string | null, equipmentId?: number | null) {
  const v = getVisitRow(visitId);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  if (!/^image\/(jpeg|png|webp|gif|heic)$/.test(file.mimetype)) throw invalid("Only image files can be attached");
  const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic" }[file.mimetype];
  const name = `${visitId}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  const r = getDb()
    .prepare("INSERT INTO visit_photos (visit_id, equipment_id, file_name, caption, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(visitId, equipmentId ?? null, name, caption ?? null, actor.id, now());
  logActivity(actor, "visit.photo", `Added photo${caption ? `: ${caption}` : ""}`, visitRefs(v));
  return getDb().prepare("SELECT * FROM visit_photos WHERE id = ?").get(r.lastInsertRowid);
}

const RecommendationInput = z.object({
  description: z.string().trim().min(3).max(4000),
  equipment_id: z.number().int().positive().nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "safety"]).default("normal"),
});

export function addRecommendation(actor: Actor, visitId: number, input: unknown) {
  const v = getVisitRow(visitId);
  assertVisitWork(actor, v);
  assertEditable(v, actor);
  const d = parse(RecommendationInput, input);
  const job = getJobRow(v.job_id);
  const db = getDb();
  if (d.equipment_id) {
    const e = db.prepare("SELECT site_id FROM equipment WHERE id = ?").get(d.equipment_id) as any;
    if (!e || e.site_id !== job.site_id) throw invalid("Equipment is not at this site");
  }
  const r = db
    .prepare("INSERT INTO recommendations (job_id, visit_id, site_id, equipment_id, description, urgency, raised_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(job.id, visitId, job.site_id, d.equipment_id ?? null, d.description, d.urgency, actor.id, now());
  logActivity(actor, "recommendation.create", `Recommendation (${d.urgency}): ${d.description}`, { ...visitRefs(v), equipment_id: d.equipment_id });
  return db.prepare("SELECT * FROM recommendations WHERE id = ?").get(r.lastInsertRowid);
}

const CompleteInput = z.object({
  outcome: z.enum(["resolved", "return_visit", "parts_required", "quote_required", "no_access"]),
  outcome_notes: optStr,
  work_notes: z.string().max(20000).nullable().optional(),
  signoff_name: optStr,
  signature_data_url: z.string().max(2_000_000).nullable().optional(),
  parts_needed: z
    .array(z.object({ part_id: z.number().int().positive().nullable().optional(), description: z.string().trim().min(1), quantity: z.number().positive() }))
    .optional(),
  quote_description: optStr,
});

/**
 * Engineer completes (or aborts) their visit. The outcome drives the job's next state:
 *  resolved       → job completed if no other visits are outstanding
 *  return_visit   → job back to "to schedule" with the reason as next action
 *  parts_required → job on hold awaiting parts, with parts requirements recorded
 *  quote_required → job on hold awaiting quote, with a recommendation for the office to quote
 *  no_access      → visit marked no access; job back to "to schedule"
 */
export function completeVisit(actor: Actor, id: number, input: unknown) {
  const v = getVisitRow(id);
  assertVisitWork(actor, v);
  const d = parse(CompleteInput, input);
  if (d.outcome === "no_access") {
    if (!["scheduled", "travelling", "on_site"].includes(v.status)) throw conflict(`Visit is ${v.status.replace("_", " ")}`);
  } else if (v.status !== "on_site") {
    throw conflict("Record your arrival on site before completing the visit");
  }
  if (d.outcome !== "resolved" && !d.outcome_notes?.trim() && !(d.outcome === "parts_required" && d.parts_needed?.length) && !(d.outcome === "quote_required" && d.quote_description)) {
    throw invalid("Explain what happens next");
  }
  if (d.outcome === "parts_required" && !d.parts_needed?.length) throw invalid("List the parts that are needed");
  if (d.outcome === "quote_required" && !(d.quote_description ?? d.outcome_notes)) throw invalid("Describe the work that needs quoting");
  const db = getDb();
  const job = getJobRow(v.job_id);
  const t = now();

  let signatureFile: string | null = null;
  if (d.signature_data_url) {
    const m = /^data:image\/png;base64,(.+)$/.exec(d.signature_data_url);
    if (!m) throw invalid("Signature must be a PNG data URL");
    signatureFile = `sig-${id}-${crypto.randomBytes(6).toString("hex")}.png`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, signatureFile), Buffer.from(m[1], "base64"));
  }

  return db.transaction(() => {
    db.prepare(
      `UPDATE visits SET status = ?, outcome = ?, outcome_notes = ?, work_notes = COALESCE(?, work_notes), signoff_name = ?, signature_file = COALESCE(?, signature_file),
         departed_at = ?, arrived_at = COALESCE(arrived_at, CASE WHEN ? = 'no_access' THEN NULL ELSE ? END) WHERE id = ?`,
    ).run(d.outcome === "no_access" ? "no_access" : "completed", d.outcome, d.outcome_notes, d.work_notes ?? null, d.signoff_name, signatureFile, t, d.outcome, t, id);

    const otherOpen = (db.prepare("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND id != ? AND status IN ('scheduled','travelling','on_site')").get(v.job_id, id) as any).n;
    const refs = visitRefs(v);
    let summary = "";
    switch (d.outcome) {
      case "resolved":
        if (otherOpen) {
          recomputeJobStatus(v.job_id);
          summary = "Visit completed — work resolved; other visits remain booked on this job";
        } else if (job.status !== "on_hold") {
          setJobStatus(v.job_id, "completed", { completed_at: t, hold_reason: null, next_action: null });
          summary = "Visit completed — work resolved; job marked complete";
        } else {
          summary = "Visit completed — work resolved (job remains on hold)";
        }
        break;
      case "return_visit":
        setJobStatus(v.job_id, "to_schedule", { hold_reason: null, next_action: `Return visit needed: ${d.outcome_notes}` });
        recomputeJobStatus(v.job_id);
        summary = `Visit completed — return visit needed: ${d.outcome_notes}`;
        break;
      case "no_access":
        setJobStatus(v.job_id, "to_schedule", { hold_reason: null, next_action: `No access on ${t.slice(0, 10)}: ${d.outcome_notes ?? ""} — rebook with customer` });
        recomputeJobStatus(v.job_id);
        summary = `No access: ${d.outcome_notes ?? ""}`;
        break;
      case "parts_required": {
        const ins = db.prepare("INSERT INTO job_parts (job_id, part_id, description, quantity, status, created_at) VALUES (?, ?, ?, ?, 'needed', ?)");
        for (const p of d.parts_needed!) ins.run(v.job_id, p.part_id ?? null, p.description, p.quantity, t);
        setJobStatus(v.job_id, "on_hold", { hold_reason: "awaiting_parts", next_action: `Order parts: ${d.parts_needed!.map((p) => `${p.quantity} × ${p.description}`).join(", ")}` });
        summary = `Visit completed — parts required: ${d.parts_needed!.map((p) => `${p.quantity} × ${p.description}`).join(", ")}`;
        break;
      }
      case "quote_required": {
        const desc = (d.quote_description ?? d.outcome_notes)!;
        const eq = (db.prepare("SELECT equipment_id FROM job_equipment WHERE job_id = ?").all(v.job_id) as any[]).map((r) => r.equipment_id);
        db.prepare("INSERT INTO recommendations (job_id, visit_id, site_id, equipment_id, description, urgency, raised_by, created_at) VALUES (?, ?, ?, ?, ?, 'high', ?, ?)")
          .run(v.job_id, id, job.site_id, eq.length === 1 ? eq[0] : null, desc, actor.id, t);
        setJobStatus(v.job_id, "on_hold", { hold_reason: "awaiting_quote", next_action: `Prepare quote: ${desc}` });
        summary = `Visit completed — quote required: ${desc}`;
        break;
      }
    }
    logActivity(actor, d.outcome === "no_access" ? "visit.no_access" : "visit.complete", summary, refs, { outcome: d.outcome });
    return { visit: getVisitRow(id), job: getJobRow(v.job_id) };
  })();
}
