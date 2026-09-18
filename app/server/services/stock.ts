import { z } from "zod";
import { getDb } from "../db.js";
import { conflict, forbidden, invalid, notFound } from "../errors.js";
import { Actor, can, require } from "../permissions.js";
import { now } from "../time.js";
import { logActivity } from "./activity.js";
import { getJobRow, recomputeJobStatus, setJobStatus } from "./jobs.js";
import { nextRef, optStr, parse, parsePartial, reqStr } from "./util.js";

export function vanForEngineer(engineerId: number) {
  return getDb().prepare("SELECT * FROM stock_locations WHERE kind = 'van' AND engineer_id = ?").get(engineerId) as any;
}

function level(partId: number, locationId: number): number {
  const r = getDb().prepare("SELECT quantity FROM stock_levels WHERE part_id = ? AND location_id = ?").get(partId, locationId) as any;
  return r?.quantity ?? 0;
}

function bump(partId: number, locationId: number, delta: number) {
  getDb()
    .prepare(
      `INSERT INTO stock_levels (part_id, location_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT(part_id, location_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
    )
    .run(partId, locationId, delta);
}

export interface MovementInput {
  part_id: number;
  from_location_id?: number | null;
  to_location_id?: number | null;
  quantity: number;
  reason: "receipt" | "transfer" | "used" | "return" | "adjustment";
  visit_id?: number | null;
  po_id?: number | null;
  note?: string | null;
  user_id?: number | null;
  allowNegative?: boolean;
}

/** The only place stock levels change. Every change leaves a movement record. */
export function recordMovement(m: MovementInput) {
  const db = getDb();
  if (!(m.quantity > 0)) throw invalid("Quantity must be positive");
  if (!db.prepare("SELECT 1 FROM parts WHERE id = ?").get(m.part_id)) throw notFound("Part");
  if (!m.from_location_id && !m.to_location_id) throw invalid("A movement needs a source or destination");
  if (m.from_location_id) {
    const available = level(m.part_id, m.from_location_id);
    if (!m.allowNegative && available < m.quantity) {
      const loc = db.prepare("SELECT name FROM stock_locations WHERE id = ?").get(m.from_location_id) as any;
      throw conflict(`Only ${available} in stock at ${loc?.name ?? "location"}`);
    }
    bump(m.part_id, m.from_location_id, -m.quantity);
  }
  if (m.to_location_id) bump(m.part_id, m.to_location_id, m.quantity);
  const r = db
    .prepare(
      `INSERT INTO stock_movements (part_id, from_location_id, to_location_id, quantity, reason, visit_id, po_id, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.part_id, m.from_location_id ?? null, m.to_location_id ?? null, m.quantity, m.reason, m.visit_id ?? null, m.po_id ?? null, m.note ?? null, m.user_id || null, now());
  return {
    id: Number(r.lastInsertRowid),
    resulting_from_quantity: m.from_location_id ? level(m.part_id, m.from_location_id) : null,
  };
}

// ---------- read ----------

export function listLocations(actor: Actor) {
  require(actor, "stock.read");
  const rows = getDb()
    .prepare(
      `SELECT l.*, u.name AS engineer_name,
        (SELECT COUNT(*) FROM stock_levels sl WHERE sl.location_id = l.id AND sl.quantity < sl.min_quantity) AS below_min,
        (SELECT COUNT(*) FROM stock_levels sl WHERE sl.location_id = l.id AND sl.quantity < 0) AS negative
       FROM stock_locations l LEFT JOIN users u ON u.id = l.engineer_id ORDER BY l.kind DESC, l.name`,
    )
    .all() as any[];
  if (actor.role === "engineer") return rows.filter((l) => l.kind === "store" || l.engineer_id === actor.id);
  return rows;
}

export function searchParts(actor: Actor, q: { query?: string; location_id?: number; limit?: number }) {
  require(actor, "stock.read");
  const p: Record<string, unknown> = { limit: Math.min(q.limit ?? 100, 500) };
  let where = "WHERE p.active = 1";
  if (q.query?.trim()) {
    where += " AND (p.name LIKE @q OR p.sku LIKE @q OR p.category LIKE @q)";
    p.q = `%${q.query.trim()}%`;
  }
  const parts = getDb()
    .prepare(
      `SELECT p.*, s.name AS supplier_name,
        (SELECT COALESCE(SUM(quantity),0) FROM stock_levels sl WHERE sl.part_id = p.id) AS total_quantity
       FROM parts p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id ${where} ORDER BY p.category, p.name LIMIT @limit`,
    )
    .all(p) as any[];
  const levels = getDb()
    .prepare("SELECT sl.*, l.name AS location_name, l.kind FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id")
    .all() as any[];
  const byPart = new Map<number, any[]>();
  for (const l of levels) {
    if (!byPart.has(l.part_id)) byPart.set(l.part_id, []);
    byPart.get(l.part_id)!.push(l);
  }
  const visibleLocations = new Set(listLocations(actor).map((l) => l.id));
  const onOrder = getDb()
    .prepare(`SELECT pl.part_id, SUM(pl.quantity - pl.received_quantity) q FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE po.status IN ('ordered','part_received') AND pl.part_id IS NOT NULL GROUP BY pl.part_id`)
    .all() as any[];
  const onOrderMap = new Map(onOrder.map((r) => [r.part_id, r.q]));
  const showCost = can(actor, "stock.manage") || can(actor, "quote.write");
  return parts.map((pt) => ({
    ...pt,
    unit_cost: showCost ? pt.unit_cost : undefined,
    levels: (byPart.get(pt.id) ?? []).filter((l) => visibleLocations.has(l.location_id)),
    on_order: onOrderMap.get(pt.id) ?? 0,
    location_quantity: q.location_id ? (byPart.get(pt.id) ?? []).find((l) => l.location_id === q.location_id)?.quantity ?? 0 : undefined,
  }));
}

export function locationStock(actor: Actor, locationId: number) {
  require(actor, "stock.read");
  const db = getDb();
  const loc = db.prepare("SELECT l.*, u.name AS engineer_name FROM stock_locations l LEFT JOIN users u ON u.id = l.engineer_id WHERE l.id = ?").get(locationId) as any;
  if (!loc) throw notFound("Stock location");
  if (actor.role === "engineer" && loc.kind === "van" && loc.engineer_id !== actor.id) throw forbidden("You can only view your own van");
  const items = db
    .prepare(
      `SELECT sl.*, p.sku, p.name, p.unit, p.category FROM stock_levels sl JOIN parts p ON p.id = sl.part_id
       WHERE sl.location_id = ? AND (sl.quantity != 0 OR sl.min_quantity > 0) ORDER BY p.category, p.name`,
    )
    .all(locationId);
  const movements = db
    .prepare(
      `SELECT m.*, p.name AS part_name, p.sku, fl.name AS from_name, tl.name AS to_name, u.name AS user_name, j.reference AS job_reference, po.reference AS po_reference
       FROM stock_movements m JOIN parts p ON p.id = m.part_id LEFT JOIN stock_locations fl ON fl.id = m.from_location_id LEFT JOIN stock_locations tl ON tl.id = m.to_location_id
       LEFT JOIN users u ON u.id = m.user_id LEFT JOIN visits v ON v.id = m.visit_id LEFT JOIN jobs j ON j.id = v.job_id LEFT JOIN purchase_orders po ON po.id = m.po_id
       WHERE m.from_location_id = ? OR m.to_location_id = ? ORDER BY m.id DESC LIMIT 100`,
    )
    .all(locationId, locationId);
  return { ...loc, items, movements };
}

export function reorderSuggestions(actor: Actor) {
  require(actor, "stock.read");
  return getDb()
    .prepare(
      `SELECT sl.*, p.sku, p.name, p.unit, l.name AS location_name, l.kind, s.name AS supplier_name, p.preferred_supplier_id,
        (SELECT COALESCE(SUM(pl.quantity - pl.received_quantity),0) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
          WHERE pl.part_id = p.id AND po.deliver_to_location_id = l.id AND po.status IN ('draft','ordered','part_received')) AS on_order
       FROM stock_levels sl JOIN parts p ON p.id = sl.part_id JOIN stock_locations l ON l.id = sl.location_id LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
       WHERE sl.quantity < sl.min_quantity ORDER BY l.kind DESC, l.name, p.name`,
    )
    .all();
}

// ---------- office stock operations ----------

const TransferInput = z.object({
  part_id: z.number().int().positive(),
  from_location_id: z.number().int().positive(),
  to_location_id: z.number().int().positive(),
  quantity: z.number().positive(),
  note: optStr,
});

export function transferStock(actor: Actor, input: unknown) {
  require(actor, "stock.manage");
  const d = parse(TransferInput, input);
  if (d.from_location_id === d.to_location_id) throw invalid("Choose two different locations");
  return getDb().transaction(() => {
    const m = recordMovement({ ...d, reason: "transfer", user_id: actor.id });
    const names = getDb().prepare("SELECT (SELECT name FROM parts WHERE id = ?) p, (SELECT name FROM stock_locations WHERE id = ?) f, (SELECT name FROM stock_locations WHERE id = ?) t").get(d.part_id, d.from_location_id, d.to_location_id) as any;
    logActivity(actor, "stock.transfer", `Transferred ${d.quantity} × ${names.p} from ${names.f} to ${names.t}`, {});
    return m;
  })();
}

const AdjustInput = z.object({
  part_id: z.number().int().positive(),
  location_id: z.number().int().positive(),
  counted_quantity: z.number(),
  note: reqStr(500),
});

/** Stock count / correction: sets the level to what was physically counted, with a reason. */
export function adjustStock(actor: Actor, input: unknown) {
  require(actor, "stock.manage");
  const d = parse(AdjustInput, input);
  if (d.counted_quantity < 0) throw invalid("Counted quantity cannot be negative");
  const current = level(d.part_id, d.location_id);
  const delta = d.counted_quantity - current;
  if (delta === 0) return { unchanged: true };
  return getDb().transaction(() => {
    const m = recordMovement({
      part_id: d.part_id,
      from_location_id: delta < 0 ? d.location_id : null,
      to_location_id: delta > 0 ? d.location_id : null,
      quantity: Math.abs(delta),
      reason: "adjustment",
      note: d.note,
      user_id: actor.id,
      allowNegative: true,
    });
    const names = getDb().prepare("SELECT (SELECT name FROM parts WHERE id = ?) p, (SELECT name FROM stock_locations WHERE id = ?) l").get(d.part_id, d.location_id) as any;
    logActivity(actor, "stock.adjust", `Stock count: ${names.p} at ${names.l} ${current} → ${d.counted_quantity} (${d.note})`, {});
    return m;
  })();
}

export function setMinQuantity(actor: Actor, partId: number, locationId: number, min: number) {
  require(actor, "stock.manage");
  if (!(min >= 0)) throw invalid("Minimum must be zero or more");
  getDb()
    .prepare(`INSERT INTO stock_levels (part_id, location_id, quantity, min_quantity) VALUES (?, ?, 0, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET min_quantity = excluded.min_quantity`)
    .run(partId, locationId, min);
  return { ok: true };
}

const PartInput = z.object({
  sku: reqStr(50),
  name: reqStr(200),
  category: optStr,
  unit: z.string().trim().min(1).max(20).default("each"),
  unit_cost: z.number().nonnegative().nullable().optional(),
  sell_price: z.number().nonnegative().nullable().optional(),
  preferred_supplier_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export function createPart(actor: Actor, input: unknown) {
  require(actor, "stock.manage");
  const d = parse(PartInput, input);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM parts WHERE sku = ?").get(d.sku)) throw invalid(`SKU ${d.sku} already exists`);
  const r = db
    .prepare("INSERT INTO parts (sku, name, category, unit, unit_cost, sell_price, preferred_supplier_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)")
    .run(d.sku, d.name, d.category, d.unit, d.unit_cost ?? null, d.sell_price ?? null, d.preferred_supplier_id ?? null);
  logActivity(actor, "part.create", `Added part ${d.sku} ${d.name}`, {});
  return db.prepare("SELECT * FROM parts WHERE id = ?").get(r.lastInsertRowid);
}

export function updatePart(actor: Actor, id: number, input: unknown) {
  require(actor, "stock.manage");
  const d = parsePartial(PartInput, input);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM parts WHERE id = ?").get(id)) throw notFound("Part");
  const vals: any = { ...d };
  if (vals.active !== undefined) vals.active = vals.active ? 1 : 0;
  const fields = Object.keys(vals).filter((k) => vals[k] !== undefined);
  if (fields.length) db.prepare(`UPDATE parts SET ${fields.map((f) => `${f} = @${f}`).join(", ")} WHERE id = @id`).run({ ...vals, id });
  logActivity(actor, "part.update", `Updated part ${id} (${fields.join(", ")})`, {});
  return db.prepare("SELECT * FROM parts WHERE id = ?").get(id);
}

export function listSuppliers(actor: Actor) {
  require(actor, "stock.read");
  return getDb().prepare("SELECT * FROM suppliers ORDER BY name").all();
}

// ---------- purchase orders ----------

const PoInput = z.object({
  supplier_id: z.number().int().positive(),
  deliver_to_location_id: z.number().int().positive(),
  job_id: z.number().int().positive().nullable().optional(),
  expected_date: optStr,
  notes: optStr,
  lines: z
    .array(
      z.object({
        part_id: z.number().int().positive().nullable().optional(),
        description: z.string().trim().optional(),
        quantity: z.number().positive(),
        unit_cost: z.number().nonnegative().nullable().optional(),
        job_part_id: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1),
});

export function createPurchaseOrder(actor: Actor, input: unknown) {
  require(actor, "po.manage");
  const d = parse(PoInput, input);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM suppliers WHERE id = ?").get(d.supplier_id)) throw notFound("Supplier");
  if (!db.prepare("SELECT 1 FROM stock_locations WHERE id = ?").get(d.deliver_to_location_id)) throw notFound("Delivery location");
  const job = d.job_id ? getJobRow(d.job_id) : null;
  if (job && ["closed", "cancelled"].includes(job.status)) throw conflict(`Job ${job.reference} is ${job.status}`);
  return db.transaction(() => {
    const ref = nextRef("purchase_orders", "PO", 5001);
    const r = db
      .prepare("INSERT INTO purchase_orders (reference, supplier_id, status, deliver_to_location_id, job_id, expected_date, notes, created_by, created_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)")
      .run(ref, d.supplier_id, d.deliver_to_location_id, d.job_id ?? null, d.expected_date, d.notes, actor.id, now());
    const poId = Number(r.lastInsertRowid);
    for (const l of d.lines) {
      let description = l.description;
      let unitCost = l.unit_cost ?? null;
      if (l.part_id) {
        const p = db.prepare("SELECT name, unit_cost FROM parts WHERE id = ?").get(l.part_id) as any;
        if (!p) throw notFound(`Part ${l.part_id}`);
        description ||= p.name;
        unitCost ??= p.unit_cost;
      }
      if (!description) throw invalid("Each PO line needs a part or description");
      const lr = db.prepare("INSERT INTO po_lines (po_id, part_id, description, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)").run(poId, l.part_id ?? null, description, l.quantity, unitCost);
      if (l.job_part_id) {
        const jp = db.prepare("SELECT * FROM job_parts WHERE id = ?").get(l.job_part_id) as any;
        if (!jp || (job && jp.job_id !== job.id)) throw invalid("Parts requirement does not belong to this job");
        if (jp.status !== "needed") throw conflict(`"${jp.description}" is already ${jp.status}`);
        db.prepare("UPDATE job_parts SET status = 'ordered', po_line_id = ? WHERE id = ?").run(lr.lastInsertRowid, l.job_part_id);
      }
    }
    logActivity(actor, "po.create", `Raised purchase order ${ref}${job ? ` for job ${job.reference}` : ""}`, { po_id: poId, job_id: job?.id, customer_id: job?.customer_id, site_id: job?.site_id });
    return getPurchaseOrder(actor, poId);
  })();
}

export function listPurchaseOrders(actor: Actor, status?: string) {
  require(actor, "stock.read");
  return getDb()
    .prepare(
      `SELECT po.*, s.name AS supplier_name, l.name AS location_name, j.reference AS job_reference,
        (SELECT COALESCE(SUM(quantity * COALESCE(unit_cost,0)),0) FROM po_lines WHERE po_id = po.id) AS total_cost,
        (SELECT COUNT(*) FROM po_lines WHERE po_id = po.id) AS line_count
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN stock_locations l ON l.id = po.deliver_to_location_id LEFT JOIN jobs j ON j.id = po.job_id
       ${status === "open" ? "WHERE po.status IN ('draft','ordered','part_received')" : status ? "WHERE po.status = @status" : ""} ORDER BY po.id DESC`,
    )
    .all(status && status !== "open" ? { status } : {});
}

export function getPurchaseOrder(actor: Actor, id: number) {
  require(actor, "stock.read");
  const db = getDb();
  const po = db
    .prepare(
      `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone, l.name AS location_name, j.reference AS job_reference, u.name AS created_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN stock_locations l ON l.id = po.deliver_to_location_id LEFT JOIN jobs j ON j.id = po.job_id LEFT JOIN users u ON u.id = po.created_by WHERE po.id = ?`,
    )
    .get(id) as any;
  if (!po) throw notFound("Purchase order");
  const lines = db
    .prepare(`SELECT pl.*, p.sku, (SELECT jp.id FROM job_parts jp WHERE jp.po_line_id = pl.id) AS job_part_id FROM po_lines pl LEFT JOIN parts p ON p.id = pl.part_id WHERE pl.po_id = ? ORDER BY pl.id`)
    .all(id);
  const activity = db.prepare("SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.po_id = ? ORDER BY a.id DESC").all(id);
  return { ...po, lines, activity };
}

export function markOrdered(actor: Actor, id: number, supplierRef?: string | null, expectedDate?: string | null) {
  require(actor, "po.manage");
  const po = getPurchaseOrder(actor, id);
  if (po.status !== "draft") throw conflict(`PO is already ${po.status}`);
  getDb().prepare("UPDATE purchase_orders SET status = 'ordered', ordered_at = ?, supplier_ref = COALESCE(?, supplier_ref), expected_date = COALESCE(?, expected_date) WHERE id = ?").run(now(), supplierRef ?? null, expectedDate ?? null, id);
  logActivity(actor, "po.ordered", `Placed order ${po.reference} with ${po.supplier_name}`, { po_id: id, job_id: po.job_id });
  return getPurchaseOrder(actor, id);
}

export function cancelPurchaseOrder(actor: Actor, id: number, reason: string) {
  require(actor, "po.manage");
  const po = getPurchaseOrder(actor, id);
  if (!["draft", "ordered"].includes(po.status)) throw conflict(`A ${po.status.replace("_", " ")} PO cannot be cancelled`);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(id);
    // Parts requirements go back to "needed" so they are not silently lost.
    db.prepare("UPDATE job_parts SET status = 'needed', po_line_id = NULL WHERE po_line_id IN (SELECT id FROM po_lines WHERE po_id = ?) AND status = 'ordered'").run(id);
    logActivity(actor, "po.cancel", `Cancelled ${po.reference}: ${reason}`, { po_id: id, job_id: po.job_id });
  })();
  return getPurchaseOrder(actor, id);
}

const ReceiveInput = z.object({
  lines: z.array(z.object({ line_id: z.number().int().positive(), quantity: z.number().positive() })).min(1),
  note: optStr,
});

/**
 * Receive goods against a PO. Catalogue items go into the delivery location's stock.
 * When every parts requirement on a job that is waiting for parts has arrived, the job
 * comes off hold and returns to the scheduling queue.
 */
export function receivePurchaseOrder(actor: Actor, id: number, input: unknown) {
  require(actor, "po.manage");
  const d = parse(ReceiveInput, input);
  const db = getDb();
  const po = getPurchaseOrder(actor, id);
  if (!["ordered", "part_received"].includes(po.status)) throw conflict(`Cannot receive against a ${po.status} PO — mark it as ordered first`);
  const result = db.transaction(() => {
    const received: string[] = [];
    const touchedJobs = new Set<number>();
    for (const r of d.lines) {
      const line = po.lines.find((l: any) => l.id === r.line_id);
      if (!line) throw invalid(`Line ${r.line_id} is not on this PO`);
      const outstanding = line.quantity - line.received_quantity;
      if (r.quantity > outstanding + 1e-9) throw invalid(`Only ${outstanding} outstanding for "${line.description}"`);
      db.prepare("UPDATE po_lines SET received_quantity = received_quantity + ? WHERE id = ?").run(r.quantity, line.id);
      if (line.part_id) recordMovement({ part_id: line.part_id, to_location_id: po.deliver_to_location_id, quantity: r.quantity, reason: "receipt", po_id: id, user_id: actor.id });
      received.push(`${r.quantity} × ${line.description}`);
      if (r.quantity >= outstanding - 1e-9 && line.job_part_id) {
        db.prepare("UPDATE job_parts SET status = 'available' WHERE id = ?").run(line.job_part_id);
        const jp = db.prepare("SELECT job_id FROM job_parts WHERE id = ?").get(line.job_part_id) as any;
        touchedJobs.add(jp.job_id);
      }
    }
    const remaining = (db.prepare("SELECT COUNT(*) n FROM po_lines WHERE po_id = ? AND received_quantity < quantity").get(id) as any).n;
    db.prepare("UPDATE purchase_orders SET status = ? WHERE id = ?").run(remaining ? "part_received" : "received", id);
    logActivity(actor, "po.receive", `Received ${received.join(", ")} into ${po.location_name}${remaining ? " (part delivery)" : ""}`, { po_id: id, job_id: po.job_id });

    const released: string[] = [];
    for (const jobId of touchedJobs) {
      const job = getJobRow(jobId);
      const outstanding = (db.prepare("SELECT COUNT(*) n FROM job_parts WHERE job_id = ? AND status IN ('needed','ordered')").get(jobId) as any).n;
      logActivity(actor, "job.parts_arrived", outstanding ? `Some parts arrived (${received.join(", ")}); ${outstanding} still outstanding` : `All required parts have arrived (${po.reference})`, {
        job_id: jobId, customer_id: job.customer_id, site_id: job.site_id, po_id: id,
      });
      if (!outstanding && job.status === "on_hold" && job.hold_reason === "awaiting_parts") {
        setJobStatus(jobId, "to_schedule", { hold_reason: null, next_action: `Parts arrived at ${po.location_name} — book return visit` });
        recomputeJobStatus(jobId);
        released.push(job.reference);
      }
    }
    return { released };
  })();
  return { ...getPurchaseOrder(actor, id), released_jobs: result.released };
}

/** Allocate needed job parts from existing stock (e.g. already in the store). */
export function markJobPartAvailable(actor: Actor, jobPartId: number, fromLocationId?: number | null) {
  require(actor, "stock.manage");
  const db = getDb();
  const jp = db.prepare("SELECT * FROM job_parts WHERE id = ?").get(jobPartId) as any;
  if (!jp) throw notFound("Parts requirement");
  if (jp.status !== "needed") throw conflict(`Already ${jp.status}`);
  const job = getJobRow(jp.job_id);
  return db.transaction(() => {
    if (fromLocationId && jp.part_id) {
      const available = level(jp.part_id, fromLocationId);
      if (available < jp.quantity) throw conflict(`Only ${available} available at that location`);
    }
    db.prepare("UPDATE job_parts SET status = 'available' WHERE id = ?").run(jobPartId);
    const outstanding = (db.prepare("SELECT COUNT(*) n FROM job_parts WHERE job_id = ? AND status IN ('needed','ordered')").get(jp.job_id) as any).n;
    logActivity(actor, "job.part_allocated", `Marked "${jp.description}" as available from stock`, { job_id: job.id, customer_id: job.customer_id, site_id: job.site_id });
    if (!outstanding && job.status === "on_hold" && job.hold_reason === "awaiting_parts") {
      setJobStatus(job.id, "to_schedule", { hold_reason: null, next_action: "Parts available — book return visit" });
      recomputeJobStatus(job.id);
    }
    return getJobRow(job.id);
  })();
}
