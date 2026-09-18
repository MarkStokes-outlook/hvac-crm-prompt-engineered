import { forbidden } from "./errors.js";

export type Role = "manager" | "coordinator" | "sales" | "engineer";

export interface Actor {
  id: number;
  name: string;
  role: Role;
  /** How the action was initiated; recorded in the activity log. */
  via?: "ui" | "ai" | "system";
}

// Implementation decision (not FrostLine policy): a conservative role matrix.
// Managers can do everything; each other role gets what its day-to-day work needs.
const MATRIX: Record<string, Role[]> = {
  "customer.read": ["manager", "coordinator", "sales"],
  "customer.write": ["manager", "coordinator", "sales"],
  "customer.account_hold": ["manager"],
  "contract.read": ["manager", "coordinator", "sales"],
  "contract.write": ["manager", "sales"],
  "contract.generate_ppm": ["manager", "coordinator"],
  "job.read": ["manager", "coordinator", "sales"],
  "job.create": ["manager", "coordinator"],
  "job.manage": ["manager", "coordinator"],
  "job.close": ["manager", "coordinator"],
  "schedule.read": ["manager", "coordinator", "sales"],
  "schedule.manage": ["manager", "coordinator"],
  "absence.manage": ["manager", "coordinator"],
  "visit.edit_any": ["manager", "coordinator"],
  "visit.work_own": ["engineer"],
  "recommendation.read": ["manager", "coordinator", "sales"],
  "recommendation.manage": ["manager", "coordinator", "sales"],
  "quote.read": ["manager", "coordinator", "sales"],
  "quote.write": ["manager", "coordinator", "sales"],
  "quote.send": ["manager", "sales"],
  "quote.decide": ["manager", "sales"],
  "quote.convert": ["manager", "coordinator", "sales"],
  "stock.read": ["manager", "coordinator", "sales", "engineer"],
  "stock.manage": ["manager", "coordinator"],
  "po.manage": ["manager", "coordinator"],
  "settings.manage": ["manager"],
  "users.read": ["manager", "coordinator", "sales"],
  "audit.read": ["manager"],
  "ai.use": ["manager", "coordinator", "sales"],
};

export type Permission = keyof typeof MATRIX;

export function can(actor: Pick<Actor, "role">, perm: string): boolean {
  const roles = MATRIX[perm];
  if (!roles) throw new Error(`Unknown permission ${perm}`);
  return roles.includes(actor.role);
}

export function require(actor: Pick<Actor, "role">, perm: string, msg?: string) {
  if (!can(actor, perm)) throw forbidden(msg ?? `Your role (${actor.role}) cannot perform ${perm}`);
}

export function permissionsFor(role: Role): string[] {
  return Object.entries(MATRIX)
    .filter(([, roles]) => roles.includes(role))
    .map(([p]) => p);
}

export const SYSTEM_ACTOR: Actor = { id: 0, name: "System", role: "manager", via: "system" };
