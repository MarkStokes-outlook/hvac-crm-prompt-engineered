import { beforeEach, describe, expect, it } from "vitest";
import { actor, freshDb, q, qa } from "./helpers.js";
import { createJob, getJob, holdJob, cancelJob, closeJob, completeJob, updateJob } from "../server/services/jobs.js";
import { arrive, addVisitPart, completeVisit, scheduleVisit, startTravel, suggestEngineers, cancelVisit, rescheduleVisit, removeVisitPart } from "../server/services/visits.js";
import { createPurchaseOrder, markOrdered, receivePurchaseOrder, cancelPurchaseOrder } from "../server/services/stock.js";
import { acceptQuote, convertQuote, createQuote, rejectQuote, reviseQuote, sendQuote, updateQuote } from "../server/services/quotes.js";
import { generatePlannedMaintenance, updateContract } from "../server/services/contracts.js";
import { updateSettings, getSetting } from "../server/services/settings.js";
import { getSite, searchCustomers, updateCustomer } from "../server/services/customers.js";
import { AppError } from "../server/errors.js";
import { setNow } from "../server/time.js";

const site = (name: string) => q("SELECT * FROM sites WHERE name = ?", name);
const eqAt = (siteId: number) => qa("SELECT * FROM equipment WHERE site_id = ?", siteId);
const vanQty = (engineerEmail: string, sku: string) =>
  q<{ quantity: number }>(
    "SELECT sl.quantity FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id JOIN users u ON u.id = l.engineer_id JOIN parts p ON p.id = sl.part_id WHERE u.email = ? AND p.sku = ?",
    `${engineerEmail}@frostline.example`,
    sku,
  )?.quantity ?? 0;

function expectError(fn: () => unknown, status: number, code?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(status);
    if (code) expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error("Expected an error");
}

let priya: ReturnType<typeof actor>, rachel: ReturnType<typeof actor>, martin: ReturnType<typeof actor>;
beforeEach(() => {
  freshDb();
  priya = actor("priya.nair");
  rachel = actor("rachel.dunn");
  martin = actor("martin.hale");
});

describe("logging jobs", () => {
  it("applies the covering contract's response target", () => {
    const s = site("Northgate House");
    const job = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "emergency", title: "No cooling", equipment_ids: [eqAt(s.id)[0].id] });
    expect(job.contract_id).toBeTruthy();
    expect(job.response_due_at).toBe("2026-09-16T14:00");
    expect(job.response_target_source).toContain("CT-NPM-24");
    expect(job.status).toBe("to_schedule");
  });

  it("does not invent a response target for non-contract work, but uses one if configured", () => {
    const s = site("Stockport store");
    const j1 = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "urgent", title: "Leak" });
    expect(j1.contract_id).toBeNull();
    expect(j1.response_due_at).toBeNull();
    expect(j1.response_target_source).toMatch(/no committed response/i);
    updateSettings(martin, { noncontract_response_urgent_hours: 24 });
    const j2 = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "urgent", title: "Leak 2" });
    expect(j2.response_due_at).toBe("2026-09-17T10:00");
  });

  it("ignores a lapsed contract", () => {
    const s = site("Warrington distribution centre");
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "Office AC" });
    expect(j.contract_id).toBeNull();
  });

  it("warns (by default) or blocks (if configured) jobs for customers on account hold", () => {
    const s = site("Warrington distribution centre");
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "Office AC" });
    expect(j.warnings.join(" ")).toMatch(/account hold/);
    updateSettings(martin, { block_jobs_on_account_hold: true });
    expectError(() => createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "Office AC" }), 409);
  });

  it("rejects equipment from a different site", () => {
    const s = site("Northgate House");
    const other = eqAt(site("Stockport store").id)[0];
    expectError(() => createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "x", equipment_ids: [other.id] }), 400);
  });

  it("re-derives the response target when priority changes before attendance", () => {
    const s = site("Northgate House");
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "Warm office" });
    expect(j.response_due_at).toBe("2026-09-18T10:00");
    const u = updateJob(priya, j.id, { priority: "emergency" });
    expect(u.response_due_at).toBe("2026-09-16T14:00");
  });

  it("enforces role permissions", () => {
    const s = site("Northgate House");
    expectError(() => createJob(rachel, { site_id: s.id, job_type: "reactive", priority: "routine", title: "x" }), 403);
    expectError(() => createJob(actor("dave.kershaw"), { site_id: s.id, job_type: "reactive", priority: "routine", title: "x" }), 403);
    expectError(() => searchCustomers(actor("dave.kershaw"), {}), 403);
    expectError(() => updateSettings(priya, { vat_rate: 0.1 }), 403);
  });

  it("partial updates do not reset unspecified fields", () => {
    const c = q("SELECT * FROM customers WHERE name = 'Harbour Lane Studios'");
    expect(c.status).toBe("prospect");
    updateCustomer(priya, c.id, { phone: "0161 000 0000" });
    expect(q("SELECT status FROM customers WHERE id = ?", c.id).status).toBe("prospect");
    const k = q("SELECT * FROM contracts WHERE reference = 'CT-NPM-24'");
    updateContract(martin, k.id, { name: "Renamed" });
    expect(q("SELECT out_of_hours_cover, labour_included FROM contracts WHERE id = ?", k.id)).toEqual({ out_of_hours_cover: 1, labour_included: 1 });
  });
});

describe("scheduling and the engineer visit workflow", () => {
  it("runs a reactive job end to end: schedule → travel → arrive → parts → resolve → close", () => {
    const s = site("Deansgate Chambers");
    const eq = eqAt(s.id).find((e) => e.category === "split_ac")!;
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "urgent", title: "Comms room hot", equipment_ids: [eq.id] });
    const lewis = actor("lewis.tran");
    const v = scheduleVisit(priya, { job_id: j.id, engineer_id: lewis.id, start: "2026-09-16T15:30", duration_hours: 1.5 });
    expect(q("SELECT status FROM jobs WHERE id = ?", j.id).status).toBe("scheduled");

    // Another engineer cannot touch Lewis's visit
    expectError(() => startTravel(actor("dave.kershaw"), v.id), 403);

    setNow(new Date(2026, 8, 16, 15, 0));
    startTravel(lewis, v.id);
    expect(q("SELECT status FROM jobs WHERE id = ?", j.id).status).toBe("in_progress");
    setNow(new Date(2026, 8, 16, 15, 40));
    arrive(lewis, v.id);
    const after = q("SELECT * FROM jobs WHERE id = ?", j.id);
    expect(after.first_attended_at).toBe("2026-09-16T15:40");
    expect(getJob(priya, j.id).response_state).toBe("met");

    const before = vanQty("lewis.tran", "CAP-35-5");
    const pl = addVisitPart(lewis, v.id, { part_id: q("SELECT id FROM parts WHERE sku = 'CAP-35-5'").id, quantity: 1 });
    expect(vanQty("lewis.tran", "CAP-35-5")).toBe(before - 1);
    removeVisitPart(lewis, v.id, pl.id);
    expect(vanQty("lewis.tran", "CAP-35-5")).toBe(before);
    addVisitPart(lewis, v.id, { part_id: q("SELECT id FROM parts WHERE sku = 'CAP-35-5'").id, quantity: 1 });

    // Cannot complete as resolved without being on site (already on site here) — and can complete now
    const r = completeVisit(lewis, v.id, { outcome: "resolved", work_notes: "Replaced fan capacitor", signoff_name: "Carl" });
    expect(r.job.status).toBe("completed");
    expect(vanQty("lewis.tran", "CAP-35-5")).toBe(before - 1);
    // Completed visit is locked for the engineer
    expectError(() => addVisitPart(lewis, v.id, { description: "extra", quantity: 1 }), 409);
    const closed = closeJob(priya, j.id);
    expect(closed.status).toBe("closed");
    expectError(() => scheduleVisit(priya, { job_id: j.id, engineer_id: lewis.id, start: "2026-09-17T09:00" }), 409);
  });

  it("requires explicit acknowledgement for double bookings and absences", () => {
    const s = site("Stockport store");
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "routine", title: "Leak" });
    const lewis = actor("lewis.tran");
    // Lewis has a seeded visit today 13:00–15:00
    const e = expectError(() => scheduleVisit(priya, { job_id: j.id, engineer_id: lewis.id, start: "2026-09-16T14:00", duration_hours: 2 }), 409, "needs_confirmation");
    expect((e.details as any).issues.map((i: any) => i.code)).toContain("overlap");
    const v = scheduleVisit(priya, { job_id: j.id, engineer_id: lewis.id, start: "2026-09-16T14:00", duration_hours: 2, acknowledge: true });
    expect(v.overridden.length).toBeGreaterThan(0);
    const act = q("SELECT * FROM activity WHERE visit_id = ? AND action = 'visit.schedule'", v.id);
    expect(act.summary).toMatch(/overrode: .*overlap/);

    const kyle = actor("kyle.brennan"); // on holiday this week
    const e2 = expectError(() => rescheduleVisit(priya, v.id, { engineer_id: kyle.id, start: "2026-09-17T09:00" }), 409);
    expect((e2.details as any).issues.map((i: any) => i.code)).toContain("absence");
  });

  it("suggests engineers with transparent reasons, excluding people on leave", () => {
    const pending = q("SELECT * FROM jobs WHERE title LIKE 'No heating in east wing%'");
    const s = suggestEngineers(priya, pending.id, "2026-09-16");
    const kyle = s.find((x) => x.name === "Kyle Brennan")!;
    expect(kyle.concerns.join(" ")).toMatch(/holiday|Unavailable/);
    const gareth = s.find((x) => x.name === "Gareth Pike")!;
    expect(gareth.reasons.join(" ")).toMatch(/gas/);
    expect(s[0].score).toBeGreaterThanOrEqual(s[s.length - 1].score);
  });

  it("parts required → PO → receipt releases the job back to scheduling", () => {
    const s = site("Rossendale House");
    const j = createJob(priya, { site_id: s.id, job_type: "reactive", priority: "urgent", title: "Boiler 2 fault" });
    const gareth = actor("gareth.pike");
    const v = scheduleVisit(priya, { job_id: j.id, engineer_id: gareth.id, start: "2026-09-16T11:00", duration_hours: 2, acknowledge: true });
    arrive(gareth, v.id);
    const pump = q("SELECT * FROM parts WHERE sku = 'PUMP-CIRC-GR'");
    const r = completeVisit(gareth, v.id, { outcome: "parts_required", outcome_notes: "Pump seized", parts_needed: [{ part_id: pump.id, description: pump.name, quantity: 1 }] });
    expect(r.job.status).toBe("on_hold");
    expect(r.job.hold_reason).toBe("awaiting_parts");
    const jp = q("SELECT * FROM job_parts WHERE job_id = ?", j.id);
    expect(jp.status).toBe("needed");

    const store = q("SELECT id FROM stock_locations WHERE kind = 'store'");
    const storeBefore = q("SELECT quantity FROM stock_levels WHERE part_id = ? AND location_id = ?", pump.id, store.id).quantity;
    const po = createPurchaseOrder(priya, { supplier_id: pump.preferred_supplier_id, deliver_to_location_id: store.id, job_id: j.id, lines: [{ part_id: pump.id, quantity: 1, job_part_id: jp.id }] });
    expect(q("SELECT status FROM job_parts WHERE id = ?", jp.id).status).toBe("ordered");
    // Cannot receive before ordering
    expectError(() => receivePurchaseOrder(priya, po.id, { lines: [{ line_id: po.lines[0].id, quantity: 1 }] }), 409);
    markOrdered(priya, po.id, "SUP-1");
    expectError(() => receivePurchaseOrder(priya, po.id, { lines: [{ line_id: po.lines[0].id, quantity: 2 }] }), 400);
    const rec = receivePurchaseOrder(priya, po.id, { lines: [{ line_id: po.lines[0].id, quantity: 1 }] });
    expect(rec.status).toBe("received");
    expect(rec.released_jobs).toEqual([j.reference]);
    expect(q("SELECT quantity FROM stock_levels WHERE part_id = ? AND location_id = ?", pump.id, store.id).quantity).toBe(storeBefore + 1);
    const jobAfter = q("SELECT * FROM jobs WHERE id = ?", j.id);
    expect(jobAfter.status).toBe("to_schedule");
    expect(jobAfter.next_action).toMatch(/Parts arrived/);
  });

  it("seeded part-received PO: receiving the remaining line releases the Kestrel job", () => {
    const po = q("SELECT * FROM purchase_orders WHERE reference = 'PO-5001'");
    const line = q("SELECT * FROM po_lines WHERE po_id = ? AND received_quantity < quantity", po.id);
    const job = q("SELECT * FROM jobs WHERE id = ?", po.job_id);
    expect(job.status).toBe("on_hold");
    const r = receivePurchaseOrder(priya, po.id, { lines: [{ line_id: line.id, quantity: 1 }] });
    expect(r.released_jobs).toEqual([job.reference]);
  });

  it("cancelling a PO returns its parts requirements to 'needed'", () => {
    const po = q("SELECT * FROM purchase_orders WHERE reference = 'PO-5002'");
    cancelPurchaseOrder(priya, po.id, "Supplier cannot deliver");
    const jp = qa("SELECT status FROM job_parts WHERE job_id = ?", po.job_id).map((r) => r.status);
    expect(jp).toContain("needed");
    expect(jp).not.toContain("ordered");
  });

  it("no access puts the job back to be scheduled with a note", () => {
    const j = q("SELECT * FROM jobs WHERE title = 'Ground floor cassette not heating'");
    const v = q("SELECT * FROM visits WHERE job_id = ?", j.id);
    const r = completeVisit(actor("gareth.pike"), v.id, { outcome: "no_access", outcome_notes: "Store closed for stocktake" });
    expect(r.visit.status).toBe("no_access");
    expect(r.job.status).toBe("to_schedule");
    expect(r.job.first_attended_at).toBeNull();
  });

  it("holding, cancelling and completing jobs keep visits consistent", () => {
    const j = q("SELECT * FROM jobs WHERE title = 'Meeting room 4 AC not cooling'");
    const h = holdJob(priya, j.id, "awaiting_access", "Tenant rescheduling");
    expect(h.warnings[0]).toMatch(/still booked/);
    expectError(() => completeJob(priya, j.id), 409);
    const c = cancelJob(priya, j.id, "Tenant fixed it (remote reset)");
    expect(c.status).toBe("cancelled");
    expect(q("SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status = 'scheduled'", j.id).n).toBe(0);
    // Cannot cancel a job with an engineer on site
    const onSite = q("SELECT * FROM jobs WHERE status = 'in_progress'");
    expectError(() => cancelJob(priya, onSite.id, "x"), 409);
  });

  it("cancelling the only visit returns the job to the scheduling queue", () => {
    const j = q("SELECT * FROM jobs WHERE title = 'Function suite bar AC leaking'");
    const v = q("SELECT * FROM visits WHERE job_id = ? AND status = 'scheduled'", j.id);
    cancelVisit(priya, v.id, "Customer asked to rebook");
    expect(q("SELECT status FROM jobs WHERE id = ?", j.id).status).toBe("to_schedule");
  });
});

describe("quotes", () => {
  it("draft → send → accept creates operational work with parts requirements (once)", () => {
    const s = site("Stockport store");
    const cust = s.customer_id;
    const cap = q("SELECT * FROM parts WHERE sku = 'CAP-35-5'");
    const qt = createQuote(rachel, { customer_id: cust, site_id: s.id, quote_type: "repair", title: "Replace capacitors", lines: [] });
    expectError(() => sendQuote(rachel, qt.id), 400);
    updateQuote(rachel, qt.id, { lines: [{ line_type: "part", description: cap.name, part_id: cap.id, quantity: 2, unit_price: 24 }, { line_type: "labour", description: "Labour", quantity: 2, unit_price: 65 }] });
    const sent = sendQuote(rachel, qt.id);
    expect(sent.status).toBe("sent");
    expect(sent.net).toBe(178);
    expect(sent.gross).toBe(213.6);
    expectError(() => updateQuote(rachel, qt.id, { title: "changed" }), 409);
    // Coordinators cannot record customer decisions
    expectError(() => acceptQuote(priya, qt.id, { decision_by_name: "Ellie" }), 403);
    const acc = acceptQuote(rachel, qt.id, { decision_by_name: "Ellie Moran", customer_po: "PO-1" });
    expect(acc.status).toBe("accepted");
    expect(acc.created_job).toBeTruthy();
    const job = q("SELECT * FROM jobs WHERE id = ?", acc.created_job.id);
    expect(job.job_type).toBe("quoted_works");
    expect(job.customer_order_ref).toBe("PO-1");
    expect(job.estimated_hours).toBe(2);
    expect(qa("SELECT * FROM job_parts WHERE job_id = ?", job.id)).toHaveLength(1);
    expectError(() => convertQuote(rachel, qt.id), 409);
  });

  it("an accepted quote resumes the job that was waiting for it", () => {
    const qt = q("SELECT * FROM quotes WHERE title = 'Replace server cupboard air conditioning unit'");
    const origin = q("SELECT * FROM jobs WHERE id = ?", qt.origin_job_id);
    expect(origin.hold_reason).toBe("awaiting_quote");
    const acc = acceptQuote(rachel, qt.id, { decision_by_name: "Dr Fiona Grant" });
    expect(acc.created_job.id).toBe(origin.id);
    const after = q("SELECT * FROM jobs WHERE id = ?", origin.id);
    expect(after.status).toBe("to_schedule");
    expect(after.quote_id).toBe(qt.id);
  });

  it("a rejected quote flags the waiting job for review instead of leaving it on hold silently", () => {
    const qt = q("SELECT * FROM quotes WHERE title = 'Replace server cupboard air conditioning unit'");
    rejectQuote(rachel, qt.id, "Going with IT supplier's solution");
    const job = q("SELECT * FROM jobs WHERE id = ?", qt.origin_job_id);
    expect(job.status).toBe("on_hold");
    expect(job.hold_reason).toBe("review");
    expect(job.next_action).toMatch(/rejected/);
  });

  it("revising a sent quote supersedes it and copies lines", () => {
    const qt = q("SELECT * FROM quotes WHERE title LIKE 'VRF heating%'");
    const rev = reviseQuote(rachel, qt.id);
    expect(rev.revision).toBe(2);
    expect(rev.status).toBe("draft");
    expect(rev.lines.length).toBeGreaterThan(3);
    expect(q("SELECT status FROM quotes WHERE id = ?", qt.id).status).toBe("superseded");
  });

  it("warns when accepting an expired quote", () => {
    const qt = q("SELECT * FROM quotes WHERE title LIKE 'VRF heating%'");
    const acc = acceptQuote(rachel, qt.id, { decision_by_name: "Megan Lloyd" });
    expect(acc.warnings.join(" ")).toMatch(/expired/);
  });
});

describe("contracts and planned maintenance", () => {
  it("generates PPM jobs idempotently", () => {
    const k = q("SELECT * FROM contracts WHERE reference = 'CT-CVL-21'");
    const r1 = generatePlannedMaintenance(priya, k.id, "2026-09-16", "2027-06-30");
    expect(r1.created.length).toBeGreaterThan(0);
    const r2 = generatePlannedMaintenance(priya, k.id, "2026-09-16", "2027-06-30");
    expect(r2.created.length).toBe(0);
    expect(r2.skipped.length).toBe(r1.created.length);
    const j = q("SELECT * FROM jobs WHERE id = ?", r1.created[0].id);
    expect(j.job_type).toBe("planned_maintenance");
    expect(j.response_due_at).toBeNull();
    expect(j.contract_id).toBe(k.id);
  });
});

describe("engineer data scoping", () => {
  it("engineers can see sites where they have work, but not others", () => {
    const sam = actor("sam.oconnor");
    expect(getSite(sam, site("St Aidan's High School").id).name).toBe("St Aidan's High School");
    expectError(() => getSite(sam, site("Oakfield Medical Practice").id), 403);
  });

  it("settings validation", () => {
    expectError(() => updateSettings(martin, { working_day_start: "18:00" }), 400);
    expect(getSetting("working_day_start")).toBe("08:00");
  });
});
