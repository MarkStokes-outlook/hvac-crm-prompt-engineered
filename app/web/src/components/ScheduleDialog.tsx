import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { addDaysStr, fmtDay, todayStr } from "../format";
import { Field, Loading, Modal, useAction } from "./ui";

/** Book (or move) a visit, with transparent engineer suggestions for the chosen day. */
export function ScheduleDialog({ job, visit, initial, onClose }: { job: any; visit?: any; initial?: { date?: string; engineer_id?: number; time?: string }; onClose: () => void }) {
  const [date, setDate] = useState(initial?.date ?? visit?.scheduled_start?.slice(0, 10) ?? (job.due_date && job.due_date > todayStr() ? job.due_date : todayStr()));
  const defaultHours = visit ? null : job.estimated_hours ?? 2;
  const [hours, setHours] = useState<number>(visit ? Math.round(((new Date(visit.scheduled_end).getTime() - new Date(visit.scheduled_start).getTime()) / 36e5) * 4) / 4 : Math.min(defaultHours, 10));
  const [engineerId, setEngineerId] = useState<number | null>(initial?.engineer_id ?? visit?.engineer_id ?? null);
  const [time, setTime] = useState(initial?.time ?? visit?.scheduled_start?.slice(11, 16) ?? "");
  const [instructions, setInstructions] = useState("");
  const { run, busy } = useAction();
  const sugg = useQuery({ queryKey: ["suggest", job.id, date, hours], queryFn: () => api.get(`/jobs/${job.id}/suggest-engineers${qs({ date, hours })}`) });

  useEffect(() => {
    if (!sugg.data || engineerId || visit) return;
    const best = sugg.data.find((s: any) => s.earliest_start);
    if (best) {
      setEngineerId(best.engineer_id);
      setTime(best.earliest_start.slice(11, 16));
    }
  }, [sugg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = time ? `${date}T${time}` : "";
  const end = start ? (() => {
    const d = new Date(`${start}:00`);
    d.setMinutes(d.getMinutes() + Math.round(hours * 60));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  })() : "";

  async function book() {
    if (!engineerId || !start) return;
    const r = await run(
      (ack) =>
        visit
          ? api.patch(`/visits/${visit.id}`, { engineer_id: engineerId, start, end, acknowledge: ack })
          : api.post("/visits", { job_id: job.id, engineer_id: engineerId, start, end, instructions: instructions || null, acknowledge: ack }),
      (v: any) => `${visit ? "Moved" : "Booked"} ${v.engineer_name} for ${fmtDay(v.scheduled_start)} ${v.scheduled_start.slice(11)}`,
    );
    if (r) onClose();
  }

  return (
    <Modal
      wide
      title={`${visit ? "Move visit" : "Book a visit"} — ${job.reference}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!engineerId || !start || busy} onClick={book}>{visit ? "Move visit" : "Book visit"}</button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}><b>{job.title}</b><br /><span className="muted small">{job.site_name}{job.site_region ? ` · ${job.site_region}` : ""}</span></p>
      {job.status === "on_hold" && <div className="notice" style={{ marginBottom: 12 }}>This job is on hold ({job.hold_reason?.replace(/_/g, " ")}). Booking a visit will take it off hold.</div>}
      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Field label="Date">
          <div className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
            <button type="button" className="small" onClick={() => setDate(addDaysStr(date, -1))} aria-label="Previous day">‹</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="small" onClick={() => setDate(addDaysStr(date, 1))} aria-label="Next day">›</button>
          </div>
        </Field>
        <Field label="Start time"><input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Duration (hours)"><input type="number" min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(Number(e.target.value) || 1)} /></Field>
      </div>
      {!visit && <div style={{ marginTop: 12 }}><Field label="Instructions for the engineer (optional)"><input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Bring R32 and a condensate pump" /></Field></div>}
      <h3 style={{ margin: "16px 0 8px" }}>Engineers for {fmtDay(date)}</h3>
      <p className="muted small" style={{ marginTop: -4 }}>Ranked on free time, recorded skills for the equipment, previous visits to this site, base region and workload. It's a guide — you decide.</p>
      {sugg.isLoading ? <Loading /> : (
        <div>
          {sugg.data?.map((s: any) => (
            <div
              key={s.engineer_id}
              className={`suggest ${engineerId === s.engineer_id ? "chosen" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setEngineerId(s.engineer_id);
                if (s.earliest_start) setTime(s.earliest_start.slice(11, 16));
              }}
              onKeyDown={(e) => e.key === "Enter" && setEngineerId(s.engineer_id)}
            >
              <div><b>{s.name}</b> <span className="muted small">{s.visits_that_day} visit{s.visits_that_day === 1 ? "" : "s"} that day</span></div>
              <div className="small">{s.earliest_start ? `Free from ${s.earliest_start.slice(11)}` : <span style={{ color: "var(--heat)" }}>No suitable gap</span>}</div>
              <div className="why">
                {s.reasons.map((r: string) => <span key={r} className="good">✓ {r}   </span>)}
                {s.concerns.map((r: string) => <span key={r} className="bad">✗ {r}   </span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
