import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { addDaysStr, fmtDate, fmtDateTime, label, money, todayStr } from "../format";
import { ErrorBox, Field, JobStatus, Loading, Modal, useAction } from "../components/ui";

const STATUS_PILL: Record<string, string> = { active: "green", expiring: "amber", expired: "red", future: "blue", ended: "", suspended: "red", draft: "" };

export function ContractsList() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["contracts"], queryFn: () => api.get("/contracts") });
  return (
    <>
      <div className="page-head">
        <div><h1>Contracts</h1><div className="sub">Service and maintenance agreements. Their terms drive response targets and planned maintenance.</div></div>
        {can("contract.write") && <button className="primary" onClick={() => setCreating(true)}>New contract</button>}
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : (
          <table className="data">
            <thead><tr><th>Contract</th><th>Customer</th><th>Term</th><th>Sites</th><th>Response (E / U / R)</th><th>PPM</th><th className="right">Annual value</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((k: any) => (
                <tr key={k.id} className="clickable" onClick={() => nav(`/contracts/${k.id}`)}>
                  <td><span className="ref">{k.reference}</span><div className="small">{k.name}</div></td>
                  <td>{k.customer_name}</td>
                  <td className="small nowrap">{fmtDate(k.start_date)} – {fmtDate(k.end_date)}</td>
                  <td>{k.site_count}</td>
                  <td className="small nowrap">{[k.response_emergency_hours, k.response_urgent_hours, k.response_routine_hours].map((h: any) => (h ? `${h}h` : "—")).join(" / ")}</td>
                  <td className="small">{k.ppm_visits_per_year ? `${k.ppm_visits_per_year}/yr` : "—"}</td>
                  <td className="right">{money(k.annual_value)}</td>
                  <td><span className={`pill ${STATUS_PILL[k.effective_status] ?? ""}`}>{label(k.effective_status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <ContractForm onClose={() => setCreating(false)} onSaved={(k) => nav(`/contracts/${k.id}`)} />}
    </>
  );
}

export function ContractDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [gen, setGen] = useState(false);
  const { data: k, isLoading, error } = useQuery({ queryKey: ["contract", id], queryFn: () => api.get(`/contracts/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !k) return <ErrorBox error={error} />;
  return (
    <>
      <div className="crumbs"><Link to="/contracts">Contracts</Link> / <Link to={`/customers/${k.customer_id}`}>{k.customer_name}</Link></div>
      <div className="page-head">
        <div>
          <h1><span className="ref">{k.reference}</span> {k.name}</h1>
          <div className="row" style={{ marginTop: 4 }}><span className={`pill ${STATUS_PILL[k.effective_status] ?? ""}`}>{label(k.effective_status)}</span><span className="muted">{fmtDate(k.start_date)} – {fmtDate(k.end_date)}</span></div>
        </div>
        <div className="row">
          {can("contract.generate_ppm") && k.ppm_visits_per_year && k.status === "active" && <button className="primary" onClick={() => setGen(true)}>Generate planned maintenance</button>}
          {can("contract.write") && <button onClick={() => setEditing(true)}>Edit terms</button>}
        </div>
      </div>
      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Jobs under this contract</h2><span className="small muted">Response targets met {k.response_summary.met} · missed {k.response_summary.missed} of {k.response_summary.with_target}</span></div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Job</th><th>Site</th><th>Type</th><th>Status</th><th>Due / logged</th></tr></thead>
                <tbody>
                  {k.jobs.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span> {j.title}</td><td className="small">{j.site_name}</td><td className="small">{label(j.job_type)}</td><td><JobStatus status={j.status} /></td><td className="small nowrap">{j.due_date ? `Due ${fmtDate(j.due_date)}` : fmtDateTime(j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Terms</h2></div>
            <div className="panel-body">
              <dl className="facts">
                <dt>Emergency response</dt><dd>{k.response_emergency_hours ? `${k.response_emergency_hours} hours` : "No target"}</dd>
                <dt>Urgent response</dt><dd>{k.response_urgent_hours ? `${k.response_urgent_hours} hours` : "No target"}</dd>
                <dt>Routine response</dt><dd>{k.response_routine_hours ? `${k.response_routine_hours} hours` : "No target"}</dd>
                <dt>Out of hours</dt><dd>{k.out_of_hours_cover ? "Covered" : "Not covered"}</dd>
                <dt>Planned visits</dt><dd>{k.ppm_visits_per_year ? `${k.ppm_visits_per_year} per year${k.ppm_visit_hours ? `, ~${k.ppm_visit_hours}h each` : ""}` : "None"}</dd>
                <dt>Labour</dt><dd>{k.labour_included ? "Included" : "Chargeable"}</dd>
                <dt>Parts</dt><dd>{k.parts_included ? "Included" : "Chargeable"}</dd>
                <dt>Annual value</dt><dd>{money(k.annual_value)}</dd>
              </dl>
              {k.terms_notes && <p className="pre small" style={{ marginTop: 10 }}>{k.terms_notes}</p>}
              <div className="assumption" style={{ marginTop: 8 }}>Response targets are measured in clock hours from when the job is logged to the engineer's arrival. Confirm this matches the contract wording.</div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Covered sites</h2></div>
            <div className="panel-body stack">{k.sites.map((s: any) => <div key={s.id}><Link to={`/sites/${s.id}`}>{s.name}</Link> <span className="small muted">{s.postcode} · {s.equipment_count} assets</span></div>)}</div>
          </section>
        </div>
      </div>
      {editing && <ContractForm contract={k} onClose={() => setEditing(false)} />}
      {gen && <GeneratePpm contract={k} onClose={() => setGen(false)} />}
    </>
  );
}

function GeneratePpm({ contract, onClose }: { contract: any; onClose: () => void }) {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDaysStr(todayStr(), 90));
  const [result, setResult] = useState<any>(null);
  const { run, busy } = useAction();
  return (
    <Modal title="Generate planned maintenance jobs" onClose={onClose} footer={result ? <button className="primary" onClick={onClose}>Done</button> : <><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => { const r = await run(() => api.post(`/contracts/${contract.id}/generate-ppm`, { from, to }), (x: any) => `Created ${x.created.length} job(s)`); if (r) setResult(r); }}>Generate jobs</button></>}>
      {!result ? (
        <div className="stack">
          <p className="small">Creates one planned maintenance job per covered site for each visit falling due in the period ({contract.ppm_visits_per_year} per year, evenly spaced from the contract start). Jobs that already exist are skipped, so it is safe to run again.</p>
          <div className="form-grid"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
        </div>
      ) : (
        <div className="stack">
          <p>{result.created.length} job(s) created{result.skipped.length ? `, ${result.skipped.length} already existed` : ""}.</p>
          {result.created.map((c: any) => <div key={c.id}><Link to={`/jobs/${c.id}`}>{c.reference}</Link> {c.site} — due {fmtDate(c.due_date)}</div>)}
        </div>
      )}
    </Modal>
  );
}

function ContractForm({ contract, onClose, onSaved }: { contract?: any; onClose: () => void; onSaved?: (k: any) => void }) {
  const k = contract ?? {};
  const [customerId, setCustomerId] = useState<number | null>(k.customer_id ?? null);
  const customers = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get(`/customers${qs({ limit: 200 })}`), enabled: !contract });
  const customer = useQuery({ queryKey: ["customer", customerId], queryFn: () => api.get(`/customers/${customerId}`), enabled: !!customerId });
  const num = (v: any) => (v === "" || v == null ? null : Number(v));
  const [f, setF] = useState({
    reference: k.reference ?? "", name: k.name ?? "", start_date: k.start_date ?? todayStr(), end_date: k.end_date ?? addDaysStr(todayStr(), 364), status: k.status ?? "active",
    response_emergency_hours: k.response_emergency_hours ?? "", response_urgent_hours: k.response_urgent_hours ?? "", response_routine_hours: k.response_routine_hours ?? "",
    out_of_hours_cover: !!k.out_of_hours_cover, ppm_visits_per_year: k.ppm_visits_per_year ?? "", ppm_visit_hours: k.ppm_visit_hours ?? "", labour_included: !!k.labour_included, parts_included: !!k.parts_included,
    annual_value: k.annual_value ?? "", terms_notes: k.terms_notes ?? "",
  });
  const [sites, setSites] = useState<number[]>(k.sites?.map((s: any) => s.id) ?? []);
  const { run, busy } = useAction();
  const s = (key: keyof typeof f) => (e: any) => setF({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const body = {
    ...f,
    response_emergency_hours: num(f.response_emergency_hours), response_urgent_hours: num(f.response_urgent_hours), response_routine_hours: num(f.response_routine_hours),
    ppm_visits_per_year: num(f.ppm_visits_per_year), ppm_visit_hours: num(f.ppm_visit_hours), annual_value: num(f.annual_value), site_ids: sites,
  };
  return (
    <Modal wide title={contract ? `Edit ${contract.reference}` : "New contract"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !customerId} onClick={async () => { const r = await run(() => (contract ? api.patch(`/contracts/${contract.id}`, body) : api.post("/contracts", { ...body, customer_id: customerId })), contract ? "Contract updated" : "Contract created"); if (r) { onClose(); onSaved?.(r); } }}>{contract ? "Save changes" : "Create contract"}</button></>}>
      {contract && <div className="notice blue small" style={{ marginBottom: 12 }}>Changing response targets affects jobs logged from now on. Existing jobs keep the target that applied when they were logged.</div>}
      <div className="form-grid">
        {!contract && <Field label="Customer" full><select value={customerId ?? ""} onChange={(e) => { setCustomerId(Number(e.target.value) || null); setSites([]); }}><option value="">Choose…</option>{customers.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Reference"><input value={f.reference} onChange={s("reference")} disabled={!!contract} /></Field>
        <Field label="Name"><input value={f.name} onChange={s("name")} /></Field>
        <Field label="Start"><input type="date" value={f.start_date} onChange={s("start_date")} /></Field>
        <Field label="End"><input type="date" value={f.end_date} onChange={s("end_date")} /></Field>
        <Field label="Emergency response (hours)" hint="Leave blank if the contract sets no target"><input type="number" value={f.response_emergency_hours} onChange={s("response_emergency_hours")} /></Field>
        <Field label="Urgent response (hours)"><input type="number" value={f.response_urgent_hours} onChange={s("response_urgent_hours")} /></Field>
        <Field label="Routine response (hours)"><input type="number" value={f.response_routine_hours} onChange={s("response_routine_hours")} /></Field>
        <Field label="Status"><select value={f.status} onChange={s("status")}>{["draft", "active", "suspended", "ended"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        <Field label="Planned visits per year"><input type="number" value={f.ppm_visits_per_year} onChange={s("ppm_visits_per_year")} /></Field>
        <Field label="Hours per planned visit"><input type="number" step={0.5} value={f.ppm_visit_hours} onChange={s("ppm_visit_hours")} /></Field>
        <label className="check"><input type="checkbox" checked={f.out_of_hours_cover} onChange={s("out_of_hours_cover")} /> Out-of-hours cover</label>
        <label className="check"><input type="checkbox" checked={f.labour_included} onChange={s("labour_included")} /> Reactive labour included</label>
        <label className="check"><input type="checkbox" checked={f.parts_included} onChange={s("parts_included")} /> Parts included</label>
        <Field label="Annual value (£)"><input type="number" value={f.annual_value} onChange={s("annual_value")} /></Field>
        <Field label="Other terms" full><textarea value={f.terms_notes} onChange={s("terms_notes")} /></Field>
        <Field label="Covered sites" full>
          <div className="stack">{customer.data?.sites.map((x: any) => <label key={x.id} className="check"><input type="checkbox" checked={sites.includes(x.id)} onChange={(e) => setSites(e.target.checked ? [...sites, x.id] : sites.filter((y) => y !== x.id))} />{x.name} <span className="muted small">{x.postcode}</span></label>)}</div>
        </Field>
      </div>
    </Modal>
  );
}
