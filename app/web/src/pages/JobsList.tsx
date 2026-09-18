import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, label } from "../format";
import { Empty, JobStatus, Loading, Priority, ResponseGauge } from "../components/ui";

export function JobsList() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const f = {
    status: params.get("status") ?? "open",
    job_type: params.get("job_type") ?? "",
    priority: params.get("priority") ?? "",
    q: params.get("q") ?? "",
    response: params.get("response") ?? "",
  };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const { data, isLoading } = useQuery({ queryKey: ["jobs", f], queryFn: () => api.get(`/jobs${qs({ ...f, status: f.status === "all" ? "" : f.status })}`) });

  return (
    <>
      <div className="page-head">
        <div><h1>Jobs</h1><div className="sub">Reactive, planned, quoted and installation work</div></div>
        {can("job.create") && <Link className="btn primary" to="/jobs/new">Log a job</Link>}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search reference, title, customer, site or postcode" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Search jobs" />
        <select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="open">All open</option>
          <option value="to_schedule">To schedule</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In progress</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed (to close)</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">Everything</option>
        </select>
        <select value={f.job_type} onChange={(e) => set("job_type", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {["reactive", "planned_maintenance", "quoted_works", "installation", "survey", "warranty"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <select value={f.priority} onChange={(e) => set("priority", e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {["emergency", "urgent", "routine", "planned"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={f.response === "at_risk"} onChange={(e) => set("response", e.target.checked ? "at_risk" : "")} /> Response at risk</label>
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : !data?.length ? <Empty>No jobs match these filters.</Empty> : (
          <table className="data">
            <thead>
              <tr><th>Job</th><th>Customer / site</th><th>Type</th><th>Status</th><th>Next visit</th><th>Response</th></tr>
            </thead>
            <tbody>
              {data.map((j: any) => (
                <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                  <td><span className="ref">{j.reference}</span><div>{j.title}</div></td>
                  <td><div>{j.customer_name}</div><div className="muted small">{j.site_name} {j.site_postcode}</div></td>
                  <td className="nowrap"><Priority p={j.priority} /><div className="small muted">{label(j.job_type)}</div></td>
                  <td><JobStatus status={j.status} hold={j.hold_reason} />{j.next_action && <div className="small muted" style={{ maxWidth: 260 }}>{j.next_action}</div>}</td>
                  <td className="nowrap small">{j.next_visit ? <>{fmtDateTime(j.next_visit)}<div className="muted">{j.engineers}</div></> : j.due_date ? <span className="muted">Target {fmtDate(j.due_date)}</span> : <span className="muted">—</span>}</td>
                  <td style={{ width: 150 }}><ResponseGauge job={j} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
