const pad = (n: number) => String(n).padStart(2, "0");

export function localNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function todayStr() {
  return localNow().slice(0, 10);
}
export function addDaysStr(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function parse(s: string) {
  const [d, t] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = (t ?? "00:00").split(":").map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0);
}
export function fmtDate(s?: string | null) {
  if (!s) return "—";
  return parse(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: s.slice(0, 4) === todayStr().slice(0, 4) ? undefined : "numeric" });
}
export function fmtDay(s: string) {
  const t = todayStr();
  const d = s.slice(0, 10);
  if (d === t) return "Today";
  if (d === addDaysStr(t, 1)) return "Tomorrow";
  if (d === addDaysStr(t, -1)) return "Yesterday";
  return parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
export function fmtDateTime(s?: string | null) {
  if (!s) return "—";
  return `${fmtDay(s)} ${s.slice(11, 16)}`;
}
export function fmtTime(s?: string | null) {
  return s ? s.slice(11, 16) : "—";
}
export function money(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}
export function relative(s?: string | null) {
  if (!s) return "";
  const mins = Math.round((parse(s).getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const txt = abs < 60 ? `${abs}m` : abs < 60 * 48 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return mins >= 0 ? `in ${txt}` : `${txt} ago`;
}
export const label = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");
export function minutesBetween(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 60000);
}
