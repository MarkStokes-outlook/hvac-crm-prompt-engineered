import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDateTime, label } from "../format";
import { Loading, useAction } from "../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Settings() {
  const { can } = useAuth();
  const [tab, setTab] = useState("policy");
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Business rules that vary by company are configured here rather than built in.</div></div></div>
      <div className="tabs">
        <button className={tab === "policy" ? "on" : ""} onClick={() => setTab("policy")}>Business settings</button>
        {can("users.read") && <button className={tab === "users" ? "on" : ""} onClick={() => setTab("users")}>Users & roles</button>}
        {can("audit.read") && <button className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>Audit log</button>}
      </div>
      {tab === "policy" && <Policy />}
      {tab === "users" && <Users />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function Policy() {
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings") });
  const [edits, setEdits] = useState<Record<string, any>>({});
  const { run, busy } = useAction();
  if (isLoading) return <Loading />;
  const editable = can("settings.manage");
  const groups = [...new Set(data.map((s: any) => s.group))] as string[];
  const val = (s: any) => (s.key in edits ? edits[s.key] : s.value);
  return (
    <>
      {!editable && <div className="notice blue" style={{ marginBottom: 12 }}>Only managers can change these.</div>}
      {groups.map((g) => (
        <section key={g} className="panel">
          <div className="panel-head"><h2>{g}</h2></div>
          <table className="data"><tbody>
            {data.filter((s: any) => s.group === g).map((s: any) => (
              <tr key={s.key}>
                <td style={{ width: "40%" }}><b>{s.label}</b><div className="assumption">{s.basis}</div>{!s.isDefault && <div className="small muted">Changed by {s.updatedBy} {fmtDateTime(s.updatedAt)}</div>}</td>
                <td>
                  {s.type === "boolean" ? <label className="check"><input type="checkbox" disabled={!editable} checked={!!val(s)} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.checked })} /> {val(s) ? "Yes" : "No"}</label>
                  : s.type === "weekdays" ? <div className="row">{DAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" disabled={!editable} checked={val(s).includes(i)} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.checked ? [...val(s), i].sort() : val(s).filter((x: number) => x !== i) })} />{d}</label>)}</div>
                  : s.type === "time" ? <input type="time" disabled={!editable} value={val(s)} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} style={{ width: 140 }} />
                  : s.type === "text" ? <input disabled={!editable} value={val(s)} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })} />
                  : <input type="number" step="any" disabled={!editable} value={val(s) ?? ""} placeholder={s.type === "number_or_null" ? "Not set" : ""} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value === "" ? null : Number(e.target.value) })} style={{ width: 160 }} />}
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      ))}
      {editable && <div className="row" style={{ marginTop: 14 }}><button className="primary" disabled={busy || !Object.keys(edits).length} onClick={async () => { if (await run(() => api.put("/settings", edits), "Settings saved")) setEdits({}); }}>Save settings</button>{Object.keys(edits).length > 0 && <button onClick={() => setEdits({})}>Discard changes</button>}</div>}
    </>
  );
}

function Users() {
  const { data, isLoading } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users") });
  if (isLoading) return <Loading />;
  return (
    <>
      <div className="notice blue" style={{ marginBottom: 12 }}>
        Roles: <b>Manager</b> — everything, including settings, account holds and the audit log. <b>Coordinator</b> — jobs, scheduling, stock and orders; can draft quotes but not issue or accept them. <b>Sales / estimator</b> — customers, contracts and quotes; read-only jobs and schedule. <b>Engineer</b> — the mobile app: own visits, sites they are working at, own van stock.
        <div className="assumption" style={{ marginTop: 4 }}>This split is an implementation choice, not established FrostLine policy. User management is by database/seed for now.</div>
      </div>
      <div className="panel table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Role</th><th>Title</th><th>Email</th><th>Skills</th><th>Base</th></tr></thead>
          <tbody>{data.map((u: any) => <tr key={u.id}><td><b>{u.name}</b>{!u.active && <span className="pill">Inactive</span>}</td><td>{label(u.role)}</td><td className="small">{u.job_title}</td><td className="small">{u.email}</td><td className="small">{u.skills.join(", ")}{u.is_subcontractor ? <span className="pill" style={{ marginLeft: 4 }}>Subcontract</span> : null}</td><td className="small">{u.base_region}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function Audit() {
  const [via, setVia] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["audit", via], queryFn: () => api.get(`/activity${qs({ via, limit: 300 })}`) });
  return (
    <>
      <div className="filters"><select value={via} onChange={(e) => setVia(e.target.value)} aria-label="Source"><option value="">All actions</option><option value="ai">Assistant-initiated (confirmed by a user)</option><option value="ui">Made directly by users</option></select></div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : (
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>Via</th><th>What</th><th>Record</th></tr></thead>
            <tbody>{data.map((a: any) => (
              <tr key={a.id}>
                <td className="small nowrap">{fmtDateTime(a.at)}</td><td className="small">{a.user_name ?? "System"}</td><td>{a.via === "ai" ? <span className="pill violet">Assistant</span> : <span className="small muted">{label(a.via)}</span>}</td><td className="small">{a.summary}</td>
                <td className="small nowrap">{a.job_id ? <Link to={`/jobs/${a.job_id}`}>Job</Link> : a.quote_id ? <Link to={`/quotes/${a.quote_id}`}>Quote</Link> : a.po_id ? <Link to={`/purchase-orders/${a.po_id}`}>PO</Link> : a.customer_id ? <Link to={`/customers/${a.customer_id}`}>Customer</Link> : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
