import { getDb } from "../db.js";
import { Actor, can, require } from "../permissions.js";
import { addDays, now, today } from "../time.js";
import { listJobs } from "./jobs.js";

export function officeDashboard(actor: Actor) {
  require(actor, "job.read");
  const db = getDb();
  const t = today();
  const open = listJobs(actor, { status: "open", limit: 500 });
  const responseRisk = open.filter((j) => ["at_risk", "overdue"].includes(j.response_state));
  const toSchedule = open.filter((j) => j.status === "to_schedule");
  const onHold = open.filter((j) => j.status === "on_hold");
  const plannedDue = open.filter((j) => j.job_type === "planned_maintenance" && j.status === "to_schedule" && j.due_date && j.due_date <= addDays(t, 14));
  const todayVisits = db
    .prepare(
      `SELECT v.*, u.name AS engineer_name, j.reference AS job_reference, j.title AS job_title, s.name AS site_name, j.priority
       FROM visits v JOIN users u ON u.id = v.engineer_id JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
       WHERE substr(v.scheduled_start,1,10) = ? AND v.status != 'cancelled' ORDER BY v.scheduled_start`,
    )
    .all(t);
  const completedToReview = db
    .prepare(`SELECT j.id, j.reference, j.title, j.completed_at, c.name AS customer_name FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.status = 'completed' ORDER BY j.completed_at LIMIT 50`)
    .all();
  const quotes = can(actor, "quote.read")
    ? {
        drafts: (db.prepare("SELECT COUNT(*) n FROM quotes WHERE status = 'draft'").get() as any).n,
        awaiting_customer: (db.prepare("SELECT COUNT(*) n FROM quotes WHERE status = 'sent' AND valid_until >= ?").get(t) as any).n,
        expired: (db.prepare("SELECT COUNT(*) n FROM quotes WHERE status = 'sent' AND valid_until < ?").get(t) as any).n,
        awaiting_conversion: (db.prepare("SELECT COUNT(*) n FROM quotes WHERE status = 'accepted' AND converted_job_id IS NULL").get() as any).n,
      }
    : null;
  const recommendations = (db.prepare("SELECT COUNT(*) n FROM recommendations WHERE status = 'open'").get() as any).n;
  const lowStock = (db.prepare("SELECT COUNT(*) n FROM stock_levels WHERE quantity < min_quantity").get() as any).n;
  const negativeStock = (db.prepare("SELECT COUNT(*) n FROM stock_levels WHERE quantity < 0").get() as any).n;
  const partsNeeded = (db.prepare("SELECT COUNT(*) n FROM job_parts jp JOIN jobs j ON j.id = jp.job_id WHERE jp.status = 'needed' AND j.status NOT IN ('cancelled','closed')").get() as any).n;
  const absentToday = db
    .prepare(`SELECT a.*, u.name FROM engineer_absences a JOIN users u ON u.id = a.user_id WHERE a.start_at < ? AND a.end_at > ?`)
    .all(`${addDays(t, 1)}T00:00`, `${t}T00:00`);
  // Booked visits that now clash with a recorded absence (e.g. training booked after the visit).
  const visitClashes = db
    .prepare(
      `SELECT v.id, v.job_id, v.scheduled_start, u.name AS engineer_name, a.kind, j.reference AS job_reference
       FROM visits v JOIN engineer_absences a ON a.user_id = v.engineer_id AND a.start_at < v.scheduled_end AND a.end_at > v.scheduled_start
       JOIN users u ON u.id = v.engineer_id JOIN jobs j ON j.id = v.job_id
       WHERE v.status = 'scheduled' AND v.scheduled_start >= ? ORDER BY v.scheduled_start`,
    )
    .all(`${t}T00:00`);
  const contractsExpiring = can(actor, "contract.read")
    ? db.prepare(`SELECT k.id, k.reference, k.name, k.end_date, c.name AS customer_name FROM contracts k JOIN customers c ON c.id = k.customer_id WHERE k.status = 'active' AND k.end_date BETWEEN ? AND ? ORDER BY k.end_date`).all(t, addDays(t, 60))
    : [];
  return {
    now: now(),
    counts: {
      open: open.length,
      to_schedule: toSchedule.length,
      on_hold: onHold.length,
      response_risk: responseRisk.length,
      today_visits: todayVisits.length,
      completed_to_review: completedToReview.length,
      recommendations,
      low_stock: lowStock,
      negative_stock: negativeStock,
      parts_needed: partsNeeded,
    },
    response_risk: responseRisk.slice(0, 20),
    to_schedule: toSchedule.slice(0, 20),
    on_hold: onHold.slice(0, 20),
    planned_due: plannedDue.slice(0, 20),
    today_visits: todayVisits,
    completed_to_review: completedToReview,
    quotes,
    absent_today: absentToday,
    visit_clashes: visitClashes,
    contracts_expiring: contractsExpiring,
  };
}
