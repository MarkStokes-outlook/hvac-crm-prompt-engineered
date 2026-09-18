import { z } from "zod";
import { getDb } from "../db.js";
import { forbidden, invalid, notFound } from "../errors.js";
import { Actor, can, require } from "../permissions.js";
import { addDays, now, today } from "../time.js";
import { logActivity } from "./activity.js";
import { co2eTonnes, optStr, parse, parsePartial, reqStr } from "./util.js";

// ---------- access helpers ----------

/** Engineers may see a site (and its equipment/history) only while they have work there. */
export function engineerHasSiteAccess(engineerId: number, siteId: number): boolean {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM visits v JOIN jobs j ON j.id = v.job_id
       WHERE v.engineer_id = ? AND j.site_id = ? AND v.status != 'cancelled'
         AND (j.status NOT IN ('closed','cancelled') OR v.scheduled_start >= ?)`,
    )
    .get(engineerId, siteId, addDays(today(), -30));
}

export function assertSiteRead(actor: Actor, siteId: number) {
  if (can(actor, "customer.read")) return;
  if (actor.role === "engineer" && engineerHasSiteAccess(actor.id, siteId)) return;
  throw forbidden("You can only view sites where you have assigned work");
}

// ---------- customers ----------

export function searchCustomers(actor: Actor, q: { query?: string; status?: string; limit?: number }) {
  require(actor, "customer.read");
  const where: string[] = [];
  const p: Record<string, unknown> = { limit: Math.min(q.limit ?? 50, 200), today: today() };
  if (q.query?.trim()) {
    // Match customer name/ref, site name/address/postcode, or contact name/email/phone.
    where.push(`(c.name LIKE @q OR c.account_ref LIKE @q OR c.email LIKE @q OR c.phone LIKE @q
      OR EXISTS (SELECT 1 FROM sites s WHERE s.customer_id = c.id AND (s.name LIKE @q OR s.address LIKE @q OR s.postcode LIKE @q))
      OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id AND (ct.name LIKE @q OR ct.email LIKE @q OR ct.phone LIKE @q)))`);
    p.q = `%${q.query.trim()}%`;
  }
  if (q.status) {
    where.push("c.status = @status");
    p.status = q.status;
  }
  return getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM sites s WHERE s.customer_id = c.id AND s.active = 1) AS site_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.status NOT IN ('completed','closed','cancelled')) AS open_jobs,
        (SELECT COUNT(*) FROM contracts k WHERE k.customer_id = c.id AND k.status = 'active' AND k.start_date <= @today AND k.end_date >= @today) AS active_contracts
       FROM customers c ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.name LIMIT @limit`,
    )
    .all(p);
}

export function getCustomer(actor: Actor, id: number) {
  require(actor, "customer.read");
  const db = getDb();
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
  if (!customer) throw notFound("Customer");
  const sites = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM equipment e WHERE e.site_id = s.id AND e.status != 'decommissioned') AS equipment_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.site_id = s.id AND j.status NOT IN ('completed','closed','cancelled')) AS open_jobs
       FROM sites s WHERE s.customer_id = ? ORDER BY s.active DESC, s.name`,
    )
    .all(id);
  const contacts = db.prepare("SELECT ct.*, s.name AS site_name FROM contacts ct LEFT JOIN sites s ON s.id = ct.site_id WHERE ct.customer_id = ? ORDER BY ct.is_primary DESC, ct.name").all(id);
  const contracts = db.prepare("SELECT * FROM contracts WHERE customer_id = ? ORDER BY end_date DESC").all(id);
  return { ...customer, sites, contacts, contracts };
}

const CustomerInput = z.object({
  name: reqStr(200),
  sector: optStr,
  status: z.enum(["prospect", "active", "inactive"]).default("active"),
  phone: optStr,
  email: optStr,
  billing_address: optStr,
  notes: optStr,
});

function nextAccountRef(name: string) {
  const stem = name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const db = getDb();
  for (let i = 1; ; i++) {
    const ref = `${stem}${String(i).padStart(3, "0")}`;
    if (!db.prepare("SELECT 1 FROM customers WHERE account_ref = ?").get(ref)) return ref;
  }
}

export function createCustomer(actor: Actor, input: unknown) {
  require(actor, "customer.write");
  const d = parse(CustomerInput, input);
  const db = getDb();
  const dup = db.prepare("SELECT id, name FROM customers WHERE lower(name) = lower(?)").get(d.name) as any;
  if (dup) throw invalid(`A customer called "${dup.name}" already exists (id ${dup.id})`);
  const ref = nextAccountRef(d.name);
  const r = db
    .prepare(`INSERT INTO customers (account_ref, name, sector, status, phone, email, billing_address, notes, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ref, d.name, d.sector, d.status, d.phone, d.email, d.billing_address, d.notes, now());
  const id = Number(r.lastInsertRowid);
  logActivity(actor, "customer.create", `Created customer ${d.name} (${ref})`, { customer_id: id });
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
}

export function updateCustomer(actor: Actor, id: number, input: unknown) {
  require(actor, "customer.write");
  const d = parsePartial(CustomerInput, input);
  const db = getDb();
  const before = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
  if (!before) throw notFound("Customer");
  const fields = Object.keys(d).filter((k) => (d as any)[k] !== undefined);
  if (!fields.length) return before;
  db.prepare(`UPDATE customers SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...d, id });
  logActivity(actor, "customer.update", `Updated customer details (${fields.join(", ")})`, { customer_id: id });
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
}

export function setAccountHold(actor: Actor, id: number, hold: boolean, note?: string | null) {
  require(actor, "customer.account_hold");
  const db = getDb();
  const c = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as any;
  if (!c) throw notFound("Customer");
  if (hold && !note?.trim()) throw invalid("Give a reason when placing an account on hold");
  db.prepare("UPDATE customers SET account_hold = ?, account_hold_note = ? WHERE id = ?").run(hold ? 1 : 0, hold ? note!.trim() : null, id);
  logActivity(actor, hold ? "customer.hold" : "customer.release", hold ? `Account placed on hold: ${note}` : "Account hold released", { customer_id: id });
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
}

// ---------- contacts ----------

const ContactInput = z.object({
  customer_id: z.number().int().positive(),
  site_id: z.number().int().positive().nullable().optional(),
  name: reqStr(200),
  role: optStr,
  phone: optStr,
  email: optStr,
  is_primary: z.boolean().optional(),
});

export function createContact(actor: Actor, input: unknown) {
  require(actor, "customer.write");
  const d = parse(ContactInput, input);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM customers WHERE id = ?").get(d.customer_id)) throw notFound("Customer");
  if (d.site_id) {
    const s = db.prepare("SELECT customer_id FROM sites WHERE id = ?").get(d.site_id) as any;
    if (!s || s.customer_id !== d.customer_id) throw invalid("Site does not belong to this customer");
  }
  return db.transaction(() => {
    if (d.is_primary) db.prepare("UPDATE contacts SET is_primary = 0 WHERE customer_id = ?").run(d.customer_id);
    const r = db
      .prepare("INSERT INTO contacts (customer_id, site_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(d.customer_id, d.site_id ?? null, d.name, d.role, d.phone, d.email, d.is_primary ? 1 : 0);
    logActivity(actor, "contact.create", `Added contact ${d.name}`, { customer_id: d.customer_id, site_id: d.site_id });
    return db.prepare("SELECT * FROM contacts WHERE id = ?").get(r.lastInsertRowid);
  })();
}

export function updateContact(actor: Actor, id: number, input: unknown) {
  require(actor, "customer.write");
  const d = parse(ContactInput.omit({ customer_id: true }).partial(), input);
  const db = getDb();
  const c = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as any;
  if (!c) throw notFound("Contact");
  return db.transaction(() => {
    if (d.is_primary) db.prepare("UPDATE contacts SET is_primary = 0 WHERE customer_id = ?").run(c.customer_id);
    const vals: any = { ...d };
    if (vals.is_primary !== undefined) vals.is_primary = vals.is_primary ? 1 : 0;
    const fields = Object.keys(vals).filter((k) => vals[k] !== undefined);
    if (fields.length) db.prepare(`UPDATE contacts SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...vals, id });
    logActivity(actor, "contact.update", `Updated contact ${c.name}`, { customer_id: c.customer_id });
    return db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  })();
}

// ---------- sites ----------

const SiteInput = z.object({
  customer_id: z.number().int().positive(),
  name: reqStr(200),
  address: reqStr(1000),
  postcode: optStr,
  region: optStr,
  access_notes: optStr,
  active: z.boolean().optional(),
});

export function createSite(actor: Actor, input: unknown) {
  require(actor, "customer.write");
  const d = parse(SiteInput, input);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM customers WHERE id = ?").get(d.customer_id)) throw notFound("Customer");
  const r = db
    .prepare("INSERT INTO sites (customer_id, name, address, postcode, region, access_notes, active) VALUES (?, ?, ?, ?, ?, ?, 1)")
    .run(d.customer_id, d.name, d.address, d.postcode, d.region, d.access_notes);
  const id = Number(r.lastInsertRowid);
  logActivity(actor, "site.create", `Added site ${d.name}`, { customer_id: d.customer_id, site_id: id });
  return db.prepare("SELECT * FROM sites WHERE id = ?").get(id);
}

export function updateSite(actor: Actor, id: number, input: unknown) {
  require(actor, "customer.write");
  const d = parse(SiteInput.omit({ customer_id: true }).partial(), input);
  const db = getDb();
  const s = db.prepare("SELECT * FROM sites WHERE id = ?").get(id) as any;
  if (!s) throw notFound("Site");
  const vals: any = { ...d };
  if (vals.active !== undefined) vals.active = vals.active ? 1 : 0;
  const fields = Object.keys(vals).filter((k) => vals[k] !== undefined);
  if (fields.length) db.prepare(`UPDATE sites SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...vals, id });
  logActivity(actor, "site.update", `Updated site ${s.name} (${fields.join(", ")})`, { customer_id: s.customer_id, site_id: id });
  return db.prepare("SELECT * FROM sites WHERE id = ?").get(id);
}

export function activeContractsForSite(siteId: number, onDate = today()) {
  return getDb()
    .prepare(
      `SELECT k.* FROM contracts k JOIN contract_sites cs ON cs.contract_id = k.id
       WHERE cs.site_id = ? AND k.status = 'active' AND k.start_date <= ? AND k.end_date >= ?
       ORDER BY k.start_date`,
    )
    .all(siteId, onDate, onDate) as any[];
}

export function getSite(actor: Actor, id: number) {
  assertSiteRead(actor, id);
  const db = getDb();
  const site = db
    .prepare("SELECT s.*, c.name AS customer_name, c.account_hold, c.account_hold_note FROM sites s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?")
    .get(id) as any;
  if (!site) throw notFound("Site");
  const equipment = listEquipment(id);
  const contacts = db.prepare("SELECT * FROM contacts WHERE customer_id = ? AND (site_id = ? OR site_id IS NULL) ORDER BY site_id IS NULL, is_primary DESC").all(site.customer_id, id);
  const contracts = db
    .prepare("SELECT k.* FROM contracts k JOIN contract_sites cs ON cs.contract_id = k.id WHERE cs.site_id = ? ORDER BY k.end_date DESC")
    .all(id);
  const jobs = db
    .prepare(
      `SELECT j.id, j.reference, j.title, j.job_type, j.priority, j.status, j.created_at, j.completed_at
       FROM jobs j WHERE j.site_id = ? ORDER BY j.created_at DESC LIMIT 100`,
    )
    .all(id);
  const recommendations = db
    .prepare("SELECT r.*, e.asset_tag, e.category FROM recommendations r LEFT JOIN equipment e ON e.id = r.equipment_id WHERE r.site_id = ? ORDER BY r.created_at DESC")
    .all(id);
  const showCommercial = can(actor, "contract.read");
  return {
    ...site,
    equipment,
    contacts,
    contracts: showCommercial ? contracts : contracts.map((k: any) => ({ id: k.id, reference: k.reference, name: k.name, status: k.status, start_date: k.start_date, end_date: k.end_date })),
    active_contracts: activeContractsForSite(id).map((k) => ({ id: k.id, reference: k.reference, name: k.name })),
    jobs,
    recommendations,
  };
}

// ---------- equipment ----------

export function listEquipment(siteId: number) {
  const rows = getDb()
    .prepare(
      `SELECT e.*, ec.label AS category_label,
        (SELECT MAX(v.scheduled_start) FROM visit_equipment ve JOIN visits v ON v.id = ve.visit_id WHERE ve.equipment_id = e.id AND v.status = 'completed') AS last_serviced
       FROM equipment e JOIN equipment_categories ec ON ec.code = e.category WHERE e.site_id = ? ORDER BY e.status = 'decommissioned', e.location, e.asset_tag`,
    )
    .all(siteId) as any[];
  return rows.map(decorateEquipment);
}

function decorateEquipment(e: any) {
  const co2e = co2eTonnes(e.refrigerant, e.refrigerant_kg);
  return {
    ...e,
    co2e_tonnes: co2e,
    // UK F-gas: leak checks are legally required at >= 5 tCO2e (frequency depends on charge and leak detection).
    fgas_leak_check_required: co2e != null ? co2e >= 5 : null,
    under_warranty: e.warranty_expiry ? e.warranty_expiry >= today() : false,
  };
}

const EquipmentInput = z.object({
  site_id: z.number().int().positive(),
  category: reqStr(50),
  asset_tag: optStr,
  manufacturer: optStr,
  model: optStr,
  serial_number: optStr,
  location: optStr,
  refrigerant: optStr,
  refrigerant_kg: z.number().nonnegative().nullable().optional(),
  install_date: optStr,
  warranty_expiry: optStr,
  status: z.enum(["active", "out_of_service", "decommissioned"]).optional(),
  notes: optStr,
});

function assertEquipmentWrite(actor: Actor, siteId: number) {
  if (can(actor, "customer.write")) return;
  // Engineers often discover or correct asset details on site.
  if (actor.role === "engineer" && engineerHasSiteAccess(actor.id, siteId)) return;
  throw forbidden("You cannot edit equipment at this site");
}

export function createEquipment(actor: Actor, input: unknown) {
  const d = parse(EquipmentInput, input);
  assertEquipmentWrite(actor, d.site_id);
  const db = getDb();
  const site = db.prepare("SELECT * FROM sites WHERE id = ?").get(d.site_id) as any;
  if (!site) throw notFound("Site");
  if (!db.prepare("SELECT 1 FROM equipment_categories WHERE code = ?").get(d.category)) throw invalid(`Unknown equipment category ${d.category}`);
  const r = db
    .prepare(
      `INSERT INTO equipment (site_id, category, asset_tag, manufacturer, model, serial_number, location, refrigerant, refrigerant_kg, install_date, warranty_expiry, status, notes)
       VALUES (@site_id, @category, @asset_tag, @manufacturer, @model, @serial_number, @location, @refrigerant, @refrigerant_kg, @install_date, @warranty_expiry, @status, @notes)`,
    )
    .run({ ...d, refrigerant_kg: d.refrigerant_kg ?? null, status: d.status ?? "active" });
  const id = Number(r.lastInsertRowid);
  logActivity(actor, "equipment.create", `Added equipment ${d.asset_tag ?? ""} ${d.manufacturer ?? ""} ${d.model ?? ""}`.replace(/\s+/g, " ").trim(), {
    customer_id: site.customer_id, site_id: d.site_id, equipment_id: id,
  });
  return getEquipment(actor, id);
}

export function updateEquipment(actor: Actor, id: number, input: unknown) {
  const db = getDb();
  const e = db.prepare("SELECT e.*, s.customer_id FROM equipment e JOIN sites s ON s.id = e.site_id WHERE e.id = ?").get(id) as any;
  if (!e) throw notFound("Equipment");
  assertEquipmentWrite(actor, e.site_id);
  const d = parse(EquipmentInput.omit({ site_id: true }).partial(), input);
  const fields = Object.keys(d).filter((k) => (d as any)[k] !== undefined);
  if (fields.length) db.prepare(`UPDATE equipment SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...d, id });
  logActivity(actor, "equipment.update", `Updated equipment ${e.asset_tag ?? id} (${fields.join(", ")})`, { customer_id: e.customer_id, site_id: e.site_id, equipment_id: id });
  return getEquipment(actor, id);
}

export function getEquipment(actor: Actor, id: number) {
  const db = getDb();
  const e = db
    .prepare(
      `SELECT e.*, ec.label AS category_label, s.name AS site_name, s.customer_id, c.name AS customer_name
       FROM equipment e JOIN equipment_categories ec ON ec.code = e.category JOIN sites s ON s.id = e.site_id JOIN customers c ON c.id = s.customer_id WHERE e.id = ?`,
    )
    .get(id) as any;
  if (!e) throw notFound("Equipment");
  assertSiteRead(actor, e.site_id);
  const history = db
    .prepare(
      `SELECT v.id AS visit_id, v.scheduled_start, v.status AS visit_status, v.outcome, v.work_notes, u.name AS engineer_name,
              j.id AS job_id, j.reference AS job_reference, j.title AS job_title, j.job_type,
              ve.condition, ve.readings, ve.notes AS equipment_notes
       FROM visit_equipment ve JOIN visits v ON v.id = ve.visit_id JOIN jobs j ON j.id = v.job_id JOIN users u ON u.id = v.engineer_id
       WHERE ve.equipment_id = ? ORDER BY v.scheduled_start DESC`,
    )
    .all(id);
  const jobs = db
    .prepare(
      `SELECT j.id, j.reference, j.title, j.job_type, j.status, j.created_at FROM job_equipment je JOIN jobs j ON j.id = je.job_id
       WHERE je.equipment_id = ? ORDER BY j.created_at DESC`,
    )
    .all(id);
  const parts = db
    .prepare(
      `SELECT vp.quantity, COALESCE(p.name, vp.description) AS part_name, v.scheduled_start, j.reference AS job_reference
       FROM visit_parts vp JOIN visits v ON v.id = vp.visit_id JOIN jobs j ON j.id = v.job_id LEFT JOIN parts p ON p.id = vp.part_id
       JOIN job_equipment je ON je.job_id = j.id AND je.equipment_id = ?
       ORDER BY v.scheduled_start DESC LIMIT 50`,
    )
    .all(id);
  const recommendations = db.prepare("SELECT * FROM recommendations WHERE equipment_id = ? ORDER BY created_at DESC").all(id);
  const photos = db.prepare("SELECT * FROM visit_photos WHERE equipment_id = ? ORDER BY uploaded_at DESC").all(id);
  return { ...decorateEquipment(e), history, jobs, parts, recommendations, photos };
}

export function listEquipmentCategories() {
  return getDb().prepare("SELECT * FROM equipment_categories ORDER BY label").all();
}

export function customerHistory(actor: Actor, customerId: number) {
  require(actor, "customer.read");
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT j.id, j.reference, j.title, j.job_type, j.priority, j.status, j.created_at, j.completed_at, s.name AS site_name
       FROM jobs j JOIN sites s ON s.id = j.site_id WHERE j.customer_id = ? ORDER BY j.created_at DESC`,
    )
    .all(customerId);
  const quotes = db
    .prepare(
      `SELECT q.id, q.reference, q.revision, q.title, q.status, q.quote_type, q.created_at, q.valid_until, s.name AS site_name,
        (SELECT COALESCE(SUM(quantity*unit_price),0) FROM quote_lines WHERE quote_id = q.id) AS net_total
       FROM quotes q LEFT JOIN sites s ON s.id = q.site_id WHERE q.customer_id = ? ORDER BY q.created_at DESC`,
    )
    .all(customerId);
  return { jobs, quotes };
}
