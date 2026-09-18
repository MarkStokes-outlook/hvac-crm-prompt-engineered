import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { addDaysStr, fmtDate, fmtDay, label, localNow, todayStr } from "../format";
import { Empty, Loading, Priority, ResponseGauge } from "../components/ui";
import { ScheduleDialog } from "../components/ScheduleDialog";

const START_H = 7;
const END_H = 19;
const SPAN = (END_H - START_H) * 60;

function pos(dateTime: string, day: string) {
  const d = dateTime.slice(0, 10);
  if (d < day) return 0;
  if (d > day) return 100;
  const [h, m] = dateTime.slice(11, 16).split(":").map(Number);
  return Math.min(100, Math.max(0, ((h * 60 + m - START_H * 60) / SPAN) * 100));
}

export function Schedule() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [day, setDay] = useState(todayStr());
  const [view, setView] = useState<"day" | "week">("day");
  const [booking, setBooking] = useState<{ job: any; initial?: any } | null>(null);
  const [dragJob, setDragJob] = useState<any>(null);
  const [dropLane, setDropLane] = useState<number | null>(null);
  const weekStart = useMemo(() => {
    const d = new Date(day + "T12:00");
    const offset = (d.getDay() + 6) % 7;
    return addDaysStr(day, -offset);
  }, [day]);
  const board = useQuery({ queryKey: ["board", view === "day" ? day : weekStart, view], queryFn: () => api.get(`/schedule${qs({ from: view === "day" ? day : weekStart, days: view === "day" ? 1 : 7 })}`) });
  const queue = useQuery({ queryKey: ["jobs", "queue"], queryFn: () => api.get(`/jobs${qs({ status: "to_schedule" })}`) });
  const held = useQuery({ queryKey: ["jobs", "held"], queryFn: () => api.get(`/jobs${qs({ status: "on_hold" })}`) });
  const manage = can("schedule.manage");

  async function openBooking(jobId: number, initial?: any) {
    const job = await api.get(`/jobs/${jobId}`);
    setBooking({ job, initial });
  }

  function onDrop(e: React.DragEvent, engineerId: number) {
    e.preventDefault();
    setDropLane(null);
    if (!dragJob || !manage) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const mins = Math.round((START_H * 60 + frac * SPAN) / 15) * 15;
    const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    openBooking(dragJob.id, { date: day, engineer_id: engineerId, time });
    setDragJob(null);
  }

  const b = board.data;
  const nowStr = localNow();
  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
  const workStart = b ? pos(`${day}T${b.working_day_start}`, day) : 0;
  const workEnd = b ? pos(`${day}T${b.working_day_end}`, day) : 100;

  return (
    <>
      <div className="page-head">
        <div><h1>Schedule</h1><div className="sub">{view === "day" ? fmtDay(day) + (day !== todayStr() ? ` — ${fmtDate(day)}` : "") : `Week of ${fmtDate(weekStart)}`}</div></div>
        <div className="row">
          <div className="seg" role="group" aria-label="View">
            <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>Day</button>
            <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</button>
          </div>
          <button onClick={() => setDay(addDaysStr(day, view === "day" ? -1 : -7))} aria-label="Previous">‹</button>
          <button onClick={() => setDay(todayStr())}>Today</button>
          <button onClick={() => setDay(addDaysStr(day, view === "day" ? 1 : 7))} aria-label="Next">›</button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: "auto" }} aria-label="Go to date" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }} className="schedule-layout">
        <div>
          {!b ? <Loading /> : view === "day" ? (
            <div className="board">
              <div className="board-grid">
                <div className="board-head">
                  <div style={{ padding: "5px 10px" }}>Engineer</div>
                  <div className="hours">{hours.map((h) => <span key={h} style={{ left: `${((h - START_H) * 60 / SPAN) * 100}%` }}>{String(h).padStart(2, "0")}:00</span>)}</div>
                </div>
                {b.engineers.map((e: any) => (
                  <div className="board-row" key={e.id}>
                    <div className="board-name">{e.name}<small>{e.base_region}{e.is_subcontractor ? " · subcontract" : ""}</small><small>{e.skills.join(", ")}</small></div>
                    <div
                      className={`board-lane ${dropLane === e.id ? "drop-target" : ""}`}
                      onDragOver={(ev) => { if (dragJob) { ev.preventDefault(); setDropLane(e.id); } }}
                      onDragLeave={() => setDropLane(null)}
                      onDrop={(ev) => onDrop(ev, e.id)}
                    >
                      <div className="offhours" style={{ left: 0, width: `${workStart}%` }} />
                      <div className="offhours" style={{ left: `${workEnd}%`, right: 0 }} />
                      {hours.map((h) => <div key={h} className="hourline" style={{ left: `${((h - START_H) * 60 / SPAN) * 100}%` }} />)}
                      {b.absences.filter((a: any) => a.user_id === e.id).map((a: any) => {
                        const l = pos(a.start_at, day), r = pos(a.end_at, day);
                        return <div key={a.id} className="absence-block" style={{ left: `${l}%`, width: `${Math.max(r - l, 1)}%` }} title={a.note ?? ""}>{label(a.kind)}{a.note ? ` — ${a.note}` : ""}</div>;
                      })}
                      {b.visits.filter((v: any) => v.engineer_id === e.id).map((v: any) => {
                        const l = pos(v.scheduled_start, day), r = pos(v.scheduled_end, day);
                        return (
                          <div
                            key={v.id}
                            className={`visit-block ${v.priority} st-${v.status}`}
                            style={{ left: `${l}%`, width: `${Math.max(r - l, 2)}%` }}
                            onClick={() => nav(`/jobs/${v.job_id}`)}
                            title={`${v.job_reference} ${v.job_title}\n${v.customer_name} — ${v.site_name}\n${v.scheduled_start.slice(11)}–${v.scheduled_end.slice(11)} · ${label(v.status)}`}
                          >
                            <b>{v.job_reference}</b> {v.site_name}
                            <div>{v.scheduled_start.slice(11)}–{v.scheduled_end.slice(11)} {v.status !== "scheduled" ? `· ${label(v.status)}` : ""}</div>
                          </div>
                        );
                      })}
                      {nowStr.slice(0, 10) === day && pos(nowStr, day) > 0 && pos(nowStr, day) < 100 && <div className="nowline" style={{ left: `${pos(nowStr, day)}%` }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <WeekView board={b} weekStart={weekStart} onDay={(d) => { setDay(d); setView("day"); }} />
          )}
          <p className="muted small" style={{ marginTop: 8 }}>
            Hatched areas are outside working hours ({b?.working_day_start}–{b?.working_day_end}, configurable in settings). Purple blocks are absences. {manage ? "Drag a job from the queue onto an engineer's row, or select it to see suggestions." : ""}
          </p>
        </div>

        <aside className="panel" style={{ position: "sticky", top: 12 }}>
          <div className="panel-head"><h2>To schedule</h2><span className="muted small">{queue.data?.length ?? 0}</span></div>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {queue.isLoading ? <Loading /> : queue.data?.length === 0 ? <Empty>Nothing waiting.</Empty> : queue.data?.map((j: any) => (
              <div
                key={j.id}
                className="queue-item"
                draggable={manage}
                onDragStart={() => setDragJob(j)}
                onDragEnd={() => setDragJob(null)}
                onClick={() => manage ? openBooking(j.id, { date: day }) : nav(`/jobs/${j.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openBooking(j.id, { date: day })}
              >
                <div className="row spread"><span className="ref">{j.reference}</span><Priority p={j.priority} /></div>
                <div className="small">{j.title}</div>
                <div className="small muted">{j.site_name} {j.site_postcode}</div>
                {j.next_action && <div className="small" style={{ color: "var(--primary-ink)" }}>{j.next_action}</div>}
                {j.response_due_at ? <ResponseGauge job={j} /> : j.due_date ? <div className="small muted">Target {fmtDate(j.due_date)}</div> : null}
              </div>
            ))}
            {held.data?.length > 0 && (
              <>
                <div className="panel-head" style={{ borderTop: "1px solid var(--rule)" }}><h3>On hold</h3><span className="muted small">{held.data.length}</span></div>
                {held.data.map((j: any) => (
                  <div key={j.id} className="queue-item" style={{ cursor: "pointer" }} onClick={() => nav(`/jobs/${j.id}`)}>
                    <div className="row spread"><span className="ref">{j.reference}</span><span className="pill violet">{label(j.hold_reason)}</span></div>
                    <div className="small">{j.title}</div>
                    <div className="small muted">{j.next_action}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
      </div>
      {booking && <ScheduleDialog job={booking.job} initial={booking.initial} onClose={() => setBooking(null)} />}
    </>
  );
}

function WeekView({ board, weekStart, onDay }: { board: any; weekStart: string; onDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  return (
    <div className="panel table-wrap">
      <table className="data">
        <thead>
          <tr><th>Engineer</th>{days.map((d) => <th key={d}><button className="ghost small" onClick={() => onDay(d)}>{fmtDay(d)}</button></th>)}</tr>
        </thead>
        <tbody>
          {board.engineers.map((e: any) => (
            <tr key={e.id}>
              <td><b>{e.name}</b></td>
              {days.map((d) => {
                const vs = board.visits.filter((v: any) => v.engineer_id === e.id && v.scheduled_start.slice(0, 10) === d);
                const abs = board.absences.filter((a: any) => a.user_id === e.id && a.start_at.slice(0, 10) <= d && a.end_at.slice(0, 10) >= d);
                return (
                  <td key={d} className="small" style={{ minWidth: 110 }}>
                    {abs.map((a: any) => <div key={a.id} className="pill violet">{label(a.kind)}</div>)}
                    {vs.map((v: any) => <div key={v.id}><Link to={`/jobs/${v.job_id}`}>{v.scheduled_start.slice(11)} {v.job_reference}</Link></div>)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
