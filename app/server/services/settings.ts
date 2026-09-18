import { getDb } from "../db.js";
import { invalid } from "../errors.js";
import { Actor, require } from "../permissions.js";
import { now } from "../time.js";
import { logActivity } from "./activity.js";

/**
 * Configurable business policy. Every value here is something the brief and the
 * FrostLine website do NOT establish, so each carries a `basis` explaining where the
 * default came from. Nothing else in the code hard-codes these values.
 */
export interface SettingDef {
  key: string;
  label: string;
  type: "number" | "number_or_null" | "boolean" | "time" | "weekdays" | "text";
  default: unknown;
  basis: string;
  group: string;
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "working_day_start", label: "Engineer working day starts", type: "time", default: "08:00", group: "Scheduling",
    basis: "Assumption. The website says the service desk works 'normal working hours, Monday to Friday'; engineer hours are not stated.",
  },
  {
    key: "working_day_end", label: "Engineer working day ends", type: "time", default: "17:00", group: "Scheduling",
    basis: "Assumption (see above).",
  },
  {
    key: "working_days", label: "Normal working days", type: "weekdays", default: [0, 1, 2, 3, 4], group: "Scheduling",
    basis: "Website: service desk available Monday to Friday. Out-of-hours cover exists for contracted customers but its rota is unknown.",
  },
  {
    key: "default_visit_hours", label: "Default visit length (hours)", type: "number", default: 2, group: "Scheduling",
    basis: "Implementation default used to prefill the scheduling form; always editable per visit.",
  },
  {
    key: "noncontract_response_emergency_hours", label: "Non-contract response target — emergency (hours)", type: "number_or_null", default: null, group: "Response targets",
    basis: "Unknown. FrostLine's website makes no response-time commitment to non-contract customers, so no target is applied unless one is configured.",
  },
  {
    key: "noncontract_response_urgent_hours", label: "Non-contract response target — urgent (hours)", type: "number_or_null", default: null, group: "Response targets",
    basis: "Unknown (see above).",
  },
  {
    key: "noncontract_response_routine_hours", label: "Non-contract response target — routine (hours)", type: "number_or_null", default: null, group: "Response targets",
    basis: "Unknown (see above).",
  },
  {
    key: "response_at_risk_fraction", label: "Flag response as 'at risk' when this fraction of the target has elapsed", type: "number", default: 0.75, group: "Response targets",
    basis: "Implementation default for dashboard highlighting only; it does not change any commitment.",
  },
  {
    key: "block_jobs_on_account_hold", label: "Block new jobs for customers on account hold", type: "boolean", default: false, group: "Customers",
    basis: "Unknown policy. Default is to warn but allow, because blocking emergency work could be unsafe; a manager can change this.",
  },
  {
    key: "vat_rate", label: "VAT rate applied to new quotes", type: "number", default: 0.2, group: "Quotes",
    basis: "UK standard VAT rate. Confirm with finance whether any customers/works need different treatment.",
  },
  {
    key: "quote_validity_days", label: "Default quote validity (days)", type: "number", default: 30, group: "Quotes",
    basis: "Assumption / common industry practice, not stated by FrostLine. Editable per quote.",
  },
  {
    key: "labour_rate", label: "Default labour rate for quote lines (£/hour)", type: "number_or_null", default: 65, group: "Quotes",
    basis: "DEMO VALUE ONLY. FrostLine's real rates are not known; replace before use.",
  },
  {
    key: "company_name", label: "Company name on documents", type: "text", default: "Frostline Mechanical Services Ltd", group: "Company",
    basis: "From the FrostLine website footer.",
  },
];

const defs = new Map(SETTING_DEFS.map((d) => [d.key, d]));

export function getSetting<T = unknown>(key: string): T {
  const def = defs.get(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return (row ? JSON.parse(row.value) : def.default) as T;
}

export function listSettings() {
  const rows = getDb().prepare("SELECT s.key, s.value, s.updated_at, u.name AS updated_by FROM settings s LEFT JOIN users u ON u.id = s.updated_by").all() as any[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_DEFS.map((d) => {
    const r = byKey.get(d.key);
    return { ...d, value: r ? JSON.parse(r.value) : d.default, isDefault: !r, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

function validate(def: SettingDef, value: unknown) {
  switch (def.type) {
    case "number":
      if (typeof value !== "number" || !isFinite(value) || value < 0) throw invalid(`${def.label} must be a non-negative number`);
      break;
    case "number_or_null":
      if (value !== null && (typeof value !== "number" || !isFinite(value) || value < 0)) throw invalid(`${def.label} must be a number or empty`);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw invalid(`${def.label} must be true or false`);
      break;
    case "time":
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw invalid(`${def.label} must be HH:MM`);
      break;
    case "weekdays":
      if (!Array.isArray(value) || value.some((v) => !Number.isInteger(v) || v < 0 || v > 6)) throw invalid(`${def.label} must be weekday numbers 0-6`);
      break;
    case "text":
      if (typeof value !== "string" || !value.trim()) throw invalid(`${def.label} is required`);
  }
}

export function updateSettings(actor: Actor, values: Record<string, unknown>) {
  require(actor, "settings.manage");
  const db = getDb();
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      const def = defs.get(key);
      if (!def) throw invalid(`Unknown setting ${key}`);
      validate(def, value);
      const before = getSetting(key);
      db.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .run(key, JSON.stringify(value), actor.id || null, now());
      if (JSON.stringify(before) !== JSON.stringify(value)) {
        logActivity(actor, "settings.update", `Changed "${def.label}" from ${JSON.stringify(before)} to ${JSON.stringify(value)}`, {});
      }
    }
    const start = getSetting<string>("working_day_start");
    const end = getSetting<string>("working_day_end");
    if (start >= end) throw invalid("Working day must end after it starts");
  })();
  return listSettings();
}
