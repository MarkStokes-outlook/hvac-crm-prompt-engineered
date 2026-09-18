// All business times are Europe/London wall-clock, stored as naive ISO strings.
process.env.TZ = process.env.TZ || "Europe/London";

let frozenNow: Date | null = null;
/** Tests can freeze the clock. */
export function setNow(d: Date | null) {
  frozenNow = d;
}
export function nowDate(): Date {
  return frozenNow ? new Date(frozenNow) : new Date();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function now(): string {
  return fmtDateTime(nowDate());
}
export function today(): string {
  return fmtDate(nowDate());
}
export function parseLocal(s: string): Date {
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]" interpreted as local time
  const [d, t] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm, ss] = (t ?? "00:00").split(":").map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0, ss || 0);
}
export function addHours(s: string, hours: number): string {
  return fmtDateTime(new Date(parseLocal(s).getTime() + hours * 3600_000));
}
export function addDays(date: string, days: number): string {
  const d = parseLocal(date);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}
export function addMonths(date: string, months: number): string {
  const d = parseLocal(date);
  d.setMonth(d.getMonth() + months);
  return fmtDate(d);
}
export function minutesBetween(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60000);
}
export function isValidDateTime(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) && !isNaN(parseLocal(s).getTime());
}
export function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(date: string): number {
  return (parseLocal(date).getDay() + 6) % 7;
}
