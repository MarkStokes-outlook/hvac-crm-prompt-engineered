import { z } from "zod";
import { getDb } from "../db.js";
import { Actor, can } from "../permissions.js";
import { addDays, today } from "../time.js";
import { officeDashboard } from "../services/dashboard.js";
import { createContact, createCustomer, createSite, getCustomer, getEquipment, getSite, searchCustomers } from "../services/customers.js";
import { addJobNote, createJob, getJob, holdJob, listJobs, CreateJobInput } from "../services/jobs.js";
import { createQuote, getQuote, listQuotes, listRecommendations } from "../services/quotes.js";
import { searchParts } from "../services/stock.js";
import { checkSlot, engineers, rescheduleVisit, scheduleBoard, scheduleVisit, suggestEngineers } from "../services/visits.js";

/**
 * Assistant tools. Every tool calls the same service functions as the UI, with the
 * signed-in user's identity, so permissions and business rules are identical.
 * "read" tools run immediately. "write" tools are validated with a rolled-back dry run and
 * then held as a proposed action until the user confirms it in the UI.
 */
export interface AiTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  kind: "read" | "write";
  /** Permission the user needs for this tool to be offered at all. */
  permission: string;
  run: (actor: Actor, input: z.infer<S>) => unknown;
  /** Human-readable description of what a write will do (shown on the confirmation card). */
  describe?: (input: z.infer<S>) => string;
}

const tool = <S extends z.ZodTypeAny>(t: AiTool<S>) => t;

// Keep tool results compact: the model needs facts, not every column.
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));

function nameOf(table: string, id?: number | null, col = "name") {
  if (!id) return null;
  return (getDb().prepare(`SELECT ${col} AS n FROM ${table} WHERE id = ?`).get(id) as any)?.n ?? `#${id}`;
}

export const TOOLS: AiTool[] = [
  tool({
    name: "search_customers",
    kind: "read",
    permission: "customer.read",
    description: "Find customers by name, account ref, site name/address/postcode, or contact name/email/phone. Returns ids to use with other tools.",
    schema: z.object({ query: z.string().describe("Free text to search for") }),
    run: (a, i) =>
      searchCustomers(a, { query: i.query, limit: 15 }).map((c: any) =>
        pick(c, ["id", "name", "account_ref", "sector", "status", "account_hold", "account_hold_note", "site_count", "open_jobs", "active_contracts"]),
      ),
  }),
  tool({
    name: "get_customer",
    kind: "read",
    permission: "customer.read",
    description: "Customer details with their sites, contacts and contracts.",
    schema: z.object({ customer_id: z.number().int() }),
    run: (a, i) => {
      const c: any = getCustomer(a, i.customer_id);
      return {
        ...pick(c, ["id", "name", "account_ref", "sector", "status", "phone", "email", "account_hold", "account_hold_note", "notes"]),
        sites: c.sites.map((s: any) => pick(s, ["id", "name", "address", "postcode", "region", "active", "equipment_count", "open_jobs"])),
        contacts: c.contacts.map((x: any) => pick(x, ["id", "name", "role", "phone", "email", "site_name", "is_primary"])),
        contracts: c.contracts.map((k: any) =>
          pick(k, ["id", "reference", "name", "status", "start_date", "end_date", "response_emergency_hours", "response_urgent_hours", "response_routine_hours", "out_of_hours_cover", "ppm_visits_per_year"]),
        ),
      };
    },
  }),
  tool({
    name: "get_site",
    kind: "read",
    permission: "customer.read",
    description: "Site details: equipment (with ids), active contract cover, access notes, recent jobs and open engineer recommendations.",
    schema: z.object({ site_id: z.number().int() }),
    run: (a, i) => {
      const s: any = getSite(a, i.site_id);
      return {
        ...pick(s, ["id", "name", "customer_id", "customer_name", "address", "postcode", "region", "access_notes", "account_hold"]),
        active_contracts: s.active_contracts,
        equipment: s.equipment.map((e: any) => pick(e, ["id", "asset_tag", "category_label", "manufacturer", "model", "location", "refrigerant", "status", "last_serviced", "under_warranty"])),
        recent_jobs: s.jobs.slice(0, 10),
        open_recommendations: s.recommendations.filter((r: any) => r.status === "open").map((r: any) => pick(r, ["id", "description", "urgency", "equipment_id", "created_at"])),
      };
    },
  }),
  tool({
    name: "get_equipment",
    kind: "read",
    permission: "customer.read",
    description: "One asset's details and full service history (visits, condition, notes, parts, recommendations).",
    schema: z.object({ equipment_id: z.number().int() }),
    run: (a, i) => {
      const e: any = getEquipment(a, i.equipment_id);
      return {
        ...pick(e, ["id", "asset_tag", "category_label", "manufacturer", "model", "serial_number", "location", "refrigerant", "refrigerant_kg", "co2e_tonnes", "install_date", "warranty_expiry", "under_warranty", "status", "notes", "site_name", "customer_name"]),
        history: e.history.slice(0, 15),
        recommendations: e.recommendations,
      };
    },
  }),
  tool({
    name: "search_jobs",
    kind: "read",
    permission: "job.read",
    description: "List jobs. status can be 'open' (all unfinished), to_schedule, scheduled, in_progress, on_hold, completed, closed, cancelled. response='at_risk' returns jobs at risk of missing or past their response target.",
    schema: z.object({
      query: z.string().optional(),
      status: z.string().optional(),
      customer_id: z.number().int().optional(),
      site_id: z.number().int().optional(),
      engineer_id: z.number().int().optional(),
      job_type: z.string().optional(),
      response: z.enum(["at_risk", "overdue"]).optional(),
    }),
    run: (a, i) =>
      listJobs(a, { ...i, limit: 40 }).map((j: any) =>
        pick(j, ["id", "reference", "title", "customer_name", "site_name", "job_type", "priority", "status", "hold_reason", "next_action", "response_due_at", "response_state", "due_date", "next_visit", "engineers"]),
      ),
  }),
  tool({
    name: "get_job",
    kind: "read",
    permission: "job.read",
    description: "Full job details: customer/site, contract and response target, equipment, visits with engineer notes and outcomes, parts, recommendations, quotes and activity.",
    schema: z.object({ job_id: z.number().int() }),
    run: (a, i) => {
      const j: any = getJob(a, i.job_id);
      return {
        ...pick(j, ["id", "reference", "title", "description", "customer_id", "customer_name", "site_id", "site_name", "site_region", "access_notes", "contract_reference", "job_type", "priority", "status", "hold_reason", "next_action", "response_due_at", "response_target_source", "response_state", "first_attended_at", "due_date", "estimated_hours", "customer_order_ref", "account_hold"]),
        equipment: j.equipment.map((e: any) => pick(e, ["id", "asset_tag", "category_label", "manufacturer", "model", "location"])),
        visits: j.visits.map((v: any) => ({
          ...pick(v, ["id", "engineer_id", "engineer_name", "scheduled_start", "scheduled_end", "status", "outcome", "outcome_notes", "work_notes"]),
          parts: v.parts.map((p: any) => `${p.quantity} × ${p.part_name}`),
        })),
        parts_required: j.parts.map((p: any) => pick(p, ["description", "quantity", "status", "po_reference"])),
        recommendations: j.recommendations.map((r: any) => pick(r, ["id", "description", "urgency", "status", "quote_reference"])),
        quotes: j.quotes,
        recent_activity: j.activity.slice(0, 10).map((x: any) => `${x.at} ${x.user_name ?? "System"}: ${x.summary}`),
      };
    },
  }),
  tool({
    name: "list_engineers",
    kind: "read",
    permission: "schedule.read",
    description: "Active engineers with ids, skills and base region.",
    schema: z.object({}),
    run: () => engineers().map((e: any) => pick(e, ["id", "name", "skills", "base_region", "is_subcontractor"])),
  }),
  tool({
    name: "get_schedule",
    kind: "read",
    permission: "schedule.read",
    description: "Booked visits and absences for all engineers from a date (YYYY-MM-DD) for 1-7 days, plus working hours.",
    schema: z.object({ date: z.string(), days: z.number().int().min(1).max(7).optional() }),
    run: (a, i) => {
      const b: any = scheduleBoard(a, i.date, i.days ?? 1);
      return {
        working_hours: `${b.working_day_start}-${b.working_day_end}`,
        engineers: b.engineers.map((e: any) => ({
          id: e.id,
          name: e.name,
          visits: b.visits.filter((v: any) => v.engineer_id === e.id).map((v: any) => `${v.scheduled_start}–${v.scheduled_end.slice(11)} ${v.job_reference} ${v.site_name} [${v.status}] (visit ${v.id}, job ${v.job_id})`),
          absences: b.absences.filter((x: any) => x.user_id === e.id).map((x: any) => `${x.kind} ${x.start_at}–${x.end_at}`),
        })),
      };
    },
  }),
  tool({
    name: "suggest_engineers",
    kind: "read",
    permission: "schedule.read",
    description: "Rank engineers for a job on a date, with the earliest free slot, skills match, site familiarity, region and concerns. Use before proposing a booking.",
    schema: z.object({ job_id: z.number().int(), date: z.string(), duration_hours: z.number().positive().optional() }),
    run: (a, i) => suggestEngineers(a, i.job_id, i.date, i.duration_hours).slice(0, 6),
  }),
  tool({
    name: "check_slot",
    kind: "read",
    permission: "schedule.read",
    description: "Check a specific engineer/time for a job and list any issues (double booking, absence, outside hours, skills, after response target).",
    schema: z.object({ job_id: z.number().int(), engineer_id: z.number().int(), start: z.string(), end: z.string() }),
    run: (_a, i) => ({ issues: checkSlot(i.job_id, i.engineer_id, i.start, i.end) }),
  }),
  tool({
    name: "search_parts",
    kind: "read",
    permission: "stock.read",
    description: "Search the parts catalogue with stock by location, quantity on order and sell price.",
    schema: z.object({ query: z.string() }),
    run: (a, i) =>
      searchParts(a, { query: i.query, limit: 15 }).map((p: any) => ({
        ...pick(p, ["id", "sku", "name", "category", "unit", "sell_price", "total_quantity", "on_order", "supplier_name"]),
        stock: p.levels.map((l: any) => `${l.location_name}: ${l.quantity}`),
      })),
  }),
  tool({
    name: "search_quotes",
    kind: "read",
    permission: "quote.read",
    description: "List quotes. status: open (draft+sent), draft, sent, accepted, rejected, withdrawn, awaiting_conversion.",
    schema: z.object({ status: z.string().optional(), customer_id: z.number().int().optional(), query: z.string().optional() }),
    run: (a, i) => listQuotes(a, i).slice(0, 30).map((q: any) => pick(q, ["id", "reference", "revision", "title", "customer_name", "site_name", "status", "valid_until", "expired", "net_total", "converted_job_id"])),
  }),
  tool({
    name: "get_quote",
    kind: "read",
    permission: "quote.read",
    description: "Quote with lines and totals.",
    schema: z.object({ quote_id: z.number().int() }),
    run: (a, i) => {
      const q: any = getQuote(a, i.quote_id);
      return {
        ...pick(q, ["id", "reference", "revision", "title", "scope", "status", "customer_name", "site_name", "quote_type", "valid_until", "expired", "net", "vat", "gross", "origin_job_reference", "converted_job_reference", "rejection_reason"]),
        lines: q.lines.map((l: any) => pick(l, ["line_type", "description", "quantity", "unit_price", "sku"])),
      };
    },
  }),
  tool({
    name: "list_recommendations",
    kind: "read",
    permission: "recommendation.read",
    description: "Open engineer recommendations (remedial work identified on site) that may need quoting.",
    schema: z.object({}),
    run: (a) => listRecommendations(a, "open").map((r: any) => pick(r, ["id", "description", "urgency", "customer_id", "customer_name", "site_id", "site_name", "equipment_id", "asset_tag", "job_reference", "raised_by_name", "created_at"])),
  }),
  tool({
    name: "operations_summary",
    kind: "read",
    permission: "job.read",
    description: "Today's operational picture: counts, jobs at risk of missing response targets, unscheduled work, holds, today's visits, absences.",
    schema: z.object({}),
    run: (a) => {
      const d: any = officeDashboard(a);
      const brief = (j: any) => pick(j, ["id", "reference", "title", "customer_name", "site_name", "priority", "status", "hold_reason", "response_due_at", "response_state", "due_date"]);
      return {
        now: d.now,
        counts: d.counts,
        response_risk: d.response_risk.map(brief),
        to_schedule: d.to_schedule.map(brief),
        on_hold: d.on_hold.map(brief),
        today_visits: d.today_visits.map((v: any) => `${v.scheduled_start.slice(11)} ${v.engineer_name} ${v.job_reference} ${v.site_name} [${v.status}]`),
        absent_today: d.absent_today.map((x: any) => `${x.name} (${x.kind})`),
        quotes: d.quotes,
      };
    },
  }),

  // ---------------- write tools (proposals) ----------------
  tool({
    name: "create_job",
    kind: "write",
    permission: "job.create",
    description:
      "Propose logging a new job. Resolve site_id (and equipment_ids/contact) with the read tools first. Contract cover and response target are applied automatically from the site's contract — do not invent them. The user must confirm before it is created.",
    schema: CreateJobInput.omit({ quote_id: true, parent_job_id: true, ppm_key: true, contract_id: true }),
    run: (a, i) => createJob(a, i),
    describe: (i) =>
      `Log ${i.priority} ${String(i.job_type).replace("_", " ")} job at ${nameOf("sites", i.site_id)}: "${i.title}"${i.equipment_ids?.length ? ` (${i.equipment_ids.length} asset(s))` : ""}`,
  }),
  tool({
    name: "schedule_visit",
    kind: "write",
    permission: "schedule.manage",
    description:
      "Propose booking an engineer visit for a job. Times are local UK time YYYY-MM-DDTHH:MM. If the slot has issues you will receive them; only set acknowledge_issues=true after telling the user about them. The user must confirm the booking.",
    schema: z.object({
      job_id: z.number().int(),
      engineer_id: z.number().int(),
      start: z.string(),
      end: z.string().optional(),
      duration_hours: z.number().positive().optional(),
      instructions: z.string().optional(),
      acknowledge_issues: z.boolean().optional(),
    }),
    run: (a, i) => scheduleVisit(a, { ...i, acknowledge: i.acknowledge_issues }),
    describe: (i) => `Book ${nameOf("users", i.engineer_id)} on ${nameOf("jobs", i.job_id, "reference")} at ${i.start.replace("T", " ")}${i.end ? `–${i.end.slice(11)}` : i.duration_hours ? ` for ${i.duration_hours}h` : ""}`,
  }),
  tool({
    name: "reschedule_visit",
    kind: "write",
    permission: "schedule.manage",
    description: "Propose moving a booked visit to another time and/or engineer. The user must confirm.",
    schema: z.object({ visit_id: z.number().int(), engineer_id: z.number().int().optional(), start: z.string().optional(), end: z.string().optional(), acknowledge_issues: z.boolean().optional() }),
    run: (a, i) => rescheduleVisit(a, i.visit_id, { engineer_id: i.engineer_id, start: i.start, end: i.end, acknowledge: i.acknowledge_issues }),
    describe: (i) => `Move visit #${i.visit_id}${i.engineer_id ? ` to ${nameOf("users", i.engineer_id)}` : ""}${i.start ? ` at ${i.start.replace("T", " ")}` : ""}`,
  }),
  tool({
    name: "create_quote_draft",
    kind: "write",
    permission: "quote.write",
    description:
      "Propose a DRAFT quote. Use catalogue sell prices from search_parts for parts. For labour, use the configured labour rate given in your instructions, or leave unit_price 0 and say it needs pricing — never invent FrostLine prices. Drafts are reviewed and sent by a person.",
    schema: z.object({
      customer_id: z.number().int(),
      site_id: z.number().int().optional(),
      contact_id: z.number().int().optional(),
      origin_job_id: z.number().int().optional(),
      recommendation_ids: z.array(z.number().int()).optional(),
      quote_type: z.enum(["repair", "installation", "replacement", "other"]),
      title: z.string(),
      scope: z.string().optional(),
      lines: z.array(
        z.object({
          line_type: z.enum(["labour", "part", "material", "subcontract", "other"]),
          description: z.string(),
          part_id: z.number().int().optional(),
          equipment_id: z.number().int().optional(),
          quantity: z.number().positive(),
          unit_price: z.number().nonnegative(),
        }),
      ),
    }),
    run: (a, i) => createQuote(a, i),
    describe: (i) => {
      const net = i.lines.reduce((s: number, l: any) => s + l.quantity * l.unit_price, 0);
      return `Draft ${i.quote_type} quote for ${nameOf("customers", i.customer_id)}: "${i.title}" — ${i.lines.length} line(s), £${net.toFixed(2)} + VAT`;
    },
  }),
  tool({
    name: "add_job_note",
    kind: "write",
    permission: "job.manage",
    description: "Propose adding a note to a job's activity log.",
    schema: z.object({ job_id: z.number().int(), note: z.string() }),
    run: (a, i) => addJobNote(a, i.job_id, i.note),
    describe: (i) => `Add note to ${nameOf("jobs", i.job_id, "reference")}: "${i.note}"`,
  }),
  tool({
    name: "put_job_on_hold",
    kind: "write",
    permission: "job.manage",
    description: "Propose putting a job on hold with a reason (awaiting_parts, awaiting_quote, awaiting_access, awaiting_customer, review, other).",
    schema: z.object({ job_id: z.number().int(), reason: z.enum(["awaiting_parts", "awaiting_quote", "awaiting_access", "awaiting_customer", "review", "other"]), note: z.string().optional() }),
    run: (a, i) => holdJob(a, i.job_id, i.reason, i.note),
    describe: (i) => `Put ${nameOf("jobs", i.job_id, "reference")} on hold (${i.reason.replace("_", " ")})${i.note ? `: ${i.note}` : ""}`,
  }),
  tool({
    name: "create_customer",
    kind: "write",
    permission: "customer.write",
    description: "Propose creating a new customer with their first site and (optionally) a contact. Search first to avoid duplicates.",
    schema: z.object({
      name: z.string(),
      sector: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      billing_address: z.string().optional(),
      site: z.object({ name: z.string(), address: z.string(), postcode: z.string().optional(), region: z.string().optional(), access_notes: z.string().optional() }),
      contact: z.object({ name: z.string(), role: z.string().optional(), phone: z.string().optional(), email: z.string().optional() }).optional(),
    }),
    run: (a, i) =>
      getDb().transaction(() => {
        const c: any = createCustomer(a, { name: i.name, sector: i.sector, phone: i.phone, email: i.email, billing_address: i.billing_address });
        const s: any = createSite(a, { customer_id: c.id, ...i.site });
        const ct: any = i.contact ? createContact(a, { customer_id: c.id, site_id: s.id, is_primary: true, ...i.contact }) : null;
        return { customer_id: c.id, account_ref: c.account_ref, site_id: s.id, contact_id: ct?.id ?? null };
      })(),
    describe: (i) => `Create customer "${i.name}" with site "${i.site.name}"${i.contact ? ` and contact ${i.contact.name}` : ""}`,
  }),
];

export function toolsFor(actor: Actor) {
  return TOOLS.filter((t) => can(actor, t.permission));
}

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}

export function dateContext() {
  const t = today();
  const days = Array.from({ length: 8 }, (_, i) => {
    const d = addDays(t, i);
    return `${d} (${new Date(d + "T12:00").toLocaleDateString("en-GB", { weekday: "long" })})`;
  });
  return days.join(", ");
}
