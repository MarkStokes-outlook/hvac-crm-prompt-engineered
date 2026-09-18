import { NavLink, Route, Routes, Navigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { addDaysStr, fmtDay, fmtTime, label, todayStr } from "../format";
import { Loading, Priority, VisitStatus } from "../components/ui";
import { VisitScreen } from "./VisitScreen";

export function EngineerApp() {
  return (
    <div className="eng">
      <Routes>
        <Route path="/" element={<MyWork />} />
        <Route path="/visit/:id" element={<VisitScreen />} />
        <Route path="/van" element={<Van />} />
        <Route path="/me" element={<Me />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <nav className="eng-tabs" aria-label="Engineer">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>My work</NavLink>
        <NavLink to="/van" className={({ isActive }) => (isActive ? "active" : "")}>Van stock</NavLink>
        <NavLink to="/me" className={({ isActive }) => (isActive ? "active" : "")}>Me</NavLink>
      </nav>
    </div>
  );
}

function MyWork() {
  const { me } = useAuth();
  const from = addDaysStr(todayStr(), -1);
  const { data, isLoading } = useQuery({ queryKey: ["my-visits", from], queryFn: () => api.get(`/my/visits${qs({ from, to: addDaysStr(todayStr(), 7) })}`), refetchInterval: 60_000 });
  const live = data?.filter((v: any) => ["travelling", "on_site"].includes(v.status)) ?? [];
  const upcoming = data?.filter((v: any) => !["travelling", "on_site"].includes(v.status) && (v.scheduled_start.slice(0, 10) >= todayStr() || v.status === "scheduled")) ?? [];
  const byDay = upcoming.reduce((acc: Record<string, any[]>, v: any) => {
    (acc[v.scheduled_start.slice(0, 10)] ??= []).push(v);
    return acc;
  }, {});
  const todays = byDay[todayStr()] ?? [];

  return (
    <>
      <header className="eng-top">
        <div className="sub">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1>{me?.name.split(" ")[0]}'s work</h1>
        <div className="sub">{todays.length ? `${todays.length} visit${todays.length > 1 ? "s" : ""} today` : "Nothing booked today"}</div>
      </header>
      <div className="eng-body">
        {isLoading && <Loading />}
        {live.length > 0 && (
          <>
            <div className="eng-day">In progress</div>
            {live.map((v: any) => <VisitCard key={v.id} v={v} live />)}
          </>
        )}
        {Object.keys(byDay).sort().map((d) => (
          <div key={d}>
            <div className="eng-day">{fmtDay(d)}</div>
            {byDay[d].map((v: any) => <VisitCard key={v.id} v={v} />)}
          </div>
        ))}
        {!isLoading && !live.length && !upcoming.length && <div className="eng-card muted">No visits booked for the next week. The office will assign work here.</div>}
      </div>
    </>
  );
}

function VisitCard({ v, live }: { v: any; live?: boolean }) {
  return (
    <Link to={`/visit/${v.id}`} className={`eng-card ${live ? "live" : ""}`}>
      <div className="row spread">
        <span className="time">{fmtTime(v.scheduled_start)}–{fmtTime(v.scheduled_end)}</span>
        <VisitStatus status={v.status} />
      </div>
      <div style={{ fontWeight: 600, marginTop: 4 }}>{v.site_name}</div>
      <div className="small muted">{v.site_address} {v.postcode}</div>
      <div style={{ marginTop: 6 }}>{v.job_title}</div>
      <div className="row small" style={{ marginTop: 4 }}><span className="ref">{v.job_reference}</span><Priority p={v.priority} /><span className="muted">{label(v.job_type)}</span></div>
    </Link>
  );
}

function Van() {
  const { data, isLoading, error } = useQuery({ queryKey: ["my-van"], queryFn: () => api.get("/my/van") });
  return (
    <>
      <header className="eng-top"><h1>Van stock</h1><div className="sub">{data?.name}</div></header>
      <div className="eng-body">
        {isLoading ? <Loading /> : error ? <div className="eng-card">No van stock location is set up for you.</div> : (
          <>
            {data.items.some((i: any) => i.quantity < i.min_quantity) && <div className="notice" style={{ marginBottom: 10 }}>Some items are below your usual van level — ask the office to top up.</div>}
            <div className="eng-section">
              {data.items.map((i: any) => (
                <div key={i.part_id} className="row spread" style={{ padding: "10px 14px", borderBottom: "1px solid var(--rule)" }}>
                  <div><div>{i.name}</div><div className="small muted">{i.sku}</div></div>
                  <div style={{ textAlign: "right" }}><b style={{ color: i.quantity < 0 ? "var(--heat)" : i.quantity < i.min_quantity ? "#8a5a12" : undefined, fontSize: 18 }}>{i.quantity}</b><div className="small muted">{i.unit}</div></div>
                </div>
              ))}
            </div>
            <div className="eng-day">Recent movements</div>
            <div className="eng-section">
              {data.movements.slice(0, 15).map((m: any) => (
                <div key={m.id} style={{ padding: "8px 14px", borderBottom: "1px solid var(--rule)" }} className="small">
                  <b>{m.to_location_id === data.id ? "+" : "−"}{m.quantity}</b> {m.part_name} <span className="muted">· {label(m.reason)}{m.job_reference ? ` · ${m.job_reference}` : ""} · {fmtDay(m.created_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Me() {
  const { me, setMe } = useAuth();
  return (
    <>
      <header className="eng-top"><h1>{me?.name}</h1><div className="sub">{me?.job_title}</div></header>
      <div className="eng-body stack">
        <div className="eng-card small">Signed in as {me?.email}. You can see your own visits, the sites you're working at and your van stock.</div>
        <div className="eng-card small muted">Offline working isn't supported yet — if you lose signal, notes stay on screen until you save them with a connection.</div>
        <button className="bigaction" onClick={async () => { await api.post("/auth/logout").catch(() => {}); setMe(null); }}>Sign out</button>
      </div>
    </>
  );
}
