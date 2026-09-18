import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, fmtTime, label } from "../format";
import { askReason, ErrorBox, Field, JobStatus, Loading, Modal, Priority, QuoteStatus, ResponseGauge, Timeline, useAction, VisitStatus } from "../components/ui";
import { ScheduleDialog } from "../components/ScheduleDialog";
import { useAssistant } from "../components/OfficeLayout";

const HOLD_REASONS = ["awaiting_parts", "awaiting_quote", "awaiting_access", "awaiting_customer", "review", "other"];

export function JobDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, me } = useAuth();
  const assistant = useAssistant();
  const { data: j, isLoading, error } = useQuery({ queryKey: ["job", id], queryFn: () => api.get(`/jobs/${id}`) });
  const [scheduling, setScheduling] = useState<{ visit?: any } | null>(null);
  const [editing, setEditing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [note, setNote] = useState("");
  const { run, busy } = useAction();
  if (isLoading) return <Loading />;
  if (error || !j) return <ErrorBox error={error} />;

  const open = ["to_schedule", "scheduled", "in_progress", "on_hold"].includes(j.status);
  const manage = can("job.manage");
  const liveVisit = j.visits.some((v: any) => ["travelling", "on_site"].includes(v.status));

  return (
    <>
      <div className="crumbs"><Link to="/jobs">Jobs</Link> / {j.customer_name}</div>
      <div className="page-head">
        <div>
          <div className="row"><h1><span className="ref">{j.reference}</span> {j.title}</h1></div>
          <div className="row" style={{ marginTop: 6 }}>
            <JobStatus status={j.status} hold={j.hold_reason} />
            <Priority p={j.priority} />
            <span className="muted">{label(j.job_type)}</span>
            {j.via_ai && <span className="pill violet">Logged via assistant</span>}
          </div>
        </div>
        <div className="row">
          {open && can("schedule.manage") && <button className="primary" onClick={() => setScheduling({})}>Book visit</button>}
          {open && manage && <button onClick={() => setEditing(true)}>Edit</button>}
          {open && manage && j.status !== "on_hold" && <button onClick={() => setHolding(true)} disabled={liveVisit}>Put on hold</button>}
          {j.status === "on_hold" && manage && <button onClick={() => run(() => api.post(`/jobs/${j.id}/release`, { note: "" }), "Taken off hold")}>Take off hold</button>}
          {open && manage && !liveVisit && (
            <button onClick={() => {
              const note = window.prompt("Mark this job complete. Add a completion note (required if no visit was completed):", "");
              if (note !== null) run(() => api.post(`/jobs/${j.id}/complete`, { note }), "Job marked complete");
            }}>Mark complete</button>
          )}
          {j.status === "completed" && can("job.close") && <button className="primary" onClick={() => run(() => api.post(`/jobs/${j.id}/close`), "Job closed")}>Review & close</button>}
          {j.status === "completed" && manage && <button onClick={() => { const r = askReason("Why is this job being reopened?"); if (r) run(() => api.post(`/jobs/${j.id}/reopen`, { reason: r }), "Reopened"); }}>Reopen</button>}
          {open && manage && !liveVisit && <button className="danger" onClick={() => { const r = askReason("Reason for cancelling this job:"); if (r) run(() => api.post(`/jobs/${j.id}/cancel`, { reason: r }), "Job cancelled"); }}>Cancel job</button>}
          {can("ai.use") && me?.ai.enabled && open && <button className="ghost" onClick={() => assistant.open(`Help me get ${j.reference} scheduled — who's the best engineer and when?`)}>Ask assistant</button>}
        </div>
      </div>

      {j.account_hold ? <div className="notice red" style={{ marginBottom: 10 }}><b>Customer account on hold:</b> {j.account_hold_note}</div> : null}
      {j.next_action && open && <div className="notice blue" style={{ marginBottom: 10 }}><b>Next:</b> {j.next_action}</div>}
      {j.status === "cancelled" && <div className="notice" style={{ marginBottom: 10 }}>Cancelled: {j.cancelled_reason}</div>}

      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Details</h2></div>
            <div className="panel-body">
              {j.description && <p className="pre">{j.description}</p>}
              <dl className="facts">
                <dt>Customer</dt><dd><Link to={`/customers/${j.customer_id}`}>{j.customer_name}</Link></dd>
                <dt>Site</dt><dd><Link to={`/sites/${j.site_id}`}>{j.site_name}</Link> <span className="muted">{j.site_address} {j.site_postcode}</span></dd>
                {j.access_notes && <><dt>Access</dt><dd>{j.access_notes}</dd></>}
                <dt>Contract</dt><dd>{j.contract_reference ? <><Link to={`/contracts/${j.contract_id}`}>{j.contract_reference}</Link> {j.contract_name} {j.labour_included ? <span className="pill green">Labour included</span> : null} {j.parts_included ? <span className="pill green">Parts included</span> : null}</> : <span className="muted">None — chargeable/ad hoc</span>}</dd>
                <dt>Response target</dt><dd>{j.response_due_at ? <>{fmtDateTime(j.response_due_at)} <ResponseGauge job={j} /></> : "None"}<div className="assumption">{j.response_target_source}</div></dd>
                {j.due_date && <><dt>Target date</dt><dd>{fmtDate(j.due_date)}</dd></>}
                <dt>Reported</dt><dd>{fmtDateTime(j.created_at)}{j.reported_via ? ` by ${j.reported_via}` : ""}{j.reported_by_contact_name ? ` — ${j.reported_by_contact_name} ${j.reported_by_contact_phone ?? ""}` : j.reported_by_name ? ` — ${j.reported_by_name}` : ""}<span className="muted"> · logged by {j.created_by_name ?? "system"}</span></dd>
                {j.customer_order_ref && <><dt>Customer order</dt><dd>{j.customer_order_ref}</dd></>}
                {j.estimated_hours && <><dt>Estimate</dt><dd>{j.estimated_hours}h</dd></>}
                {j.quote_reference && <><dt>From quote</dt><dd><Link to={`/quotes/${j.quote_id}`}>{j.quote_reference}</Link></dd></>}
                {j.parent_job_reference && <><dt>Follow-on from</dt><dd><Link to={`/jobs/${j.parent_job_id}`}>{j.parent_job_reference}</Link></dd></>}
                {j.first_attended_at && <><dt>First attended</dt><dd>{fmtDateTime(j.first_attended_at)}</dd></>}
                {j.completed_at && <><dt>Completed</dt><dd>{fmtDateTime(j.completed_at)}</dd></>}
                {j.closed_at && <><dt>Closed</dt><dd>{fmtDateTime(j.closed_at)}</dd></>}
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Visits</h2>{open && can("schedule.manage") && <button className="small" onClick={() => setScheduling({})}>Book visit</button>}</div>
            {j.visits.length === 0 ? <div className="panel-body muted">No visits booked yet.</div> : j.visits.map((v: any) => (
              <div key={v.id} className="panel-body" style={{ borderBottom: "1px solid var(--rule)" }}>
                <div className="row spread">
                  <div className="row">
                    <b>{fmtDateTime(v.scheduled_start)}–{fmtTime(v.scheduled_end)}</b>
                    <span>{v.engineer_name}</span>
                    <VisitStatus status={v.status} />
                    {v.outcome && <span className="pill">{label(v.outcome)}</span>}
                  </div>
                  {v.status === "scheduled" && can("schedule.manage") && (
                    <div className="row">
                      <button className="small" onClick={() => setScheduling({ visit: v })}>Move</button>
                      <button className="small danger" onClick={() => { const r = askReason("Reason for cancelling this visit:"); if (r) run(() => api.post(`/visits/${v.id}/cancel`, { reason: r }), "Visit cancelled"); }}>Cancel visit</button>
                    </div>
                  )}
                </div>
                {v.instructions && <div className="small muted">Instructions: {v.instructions}</div>}
                {v.arrived_at && <div className="small muted">Arrived {fmtTime(v.arrived_at)}{v.departed_at ? `, left ${fmtTime(v.departed_at)}` : ""}{v.signoff_name ? ` · signed off by ${v.signoff_name}` : ""}</div>}
                {v.work_notes && <p className="pre" style={{ margin: "8px 0 0" }}>{v.work_notes}</p>}
                {v.outcome_notes && <p className="pre" style={{ margin: "6px 0 0" }}><b>Outcome:</b> {v.outcome_notes}</p>}
                {v.cancelled_reason && <div className="small muted">Cancelled: {v.cancelled_reason}</div>}
                {v.equipment_checks.length > 0 && (
                  <div className="small" style={{ marginTop: 6 }}>
                    {v.equipment_checks.map((c: any) => (
                      <div key={c.equipment_id}>
                        <Link to={`/equipment/${c.equipment_id}`}>{c.asset_tag}</Link> {c.location}: <span className={`pill ${c.condition === "good" ? "green" : c.condition === "failed" ? "red" : c.condition === "attention" ? "amber" : ""}`}>{label(c.condition)}</span> {c.notes} {c.readings && <span className="muted">({c.readings})</span>}
                      </div>
                    ))}
                  </div>
                )}
                {v.parts.length > 0 && <div className="small" style={{ marginTop: 6 }}>Parts used: {v.parts.map((p: any) => `${p.quantity} × ${p.part_name}`).join(", ")}</div>}
                {v.photos.length > 0 && (
                  <div className="row" style={{ marginTop: 8 }}>
                    {v.photos.map((p: any) => <a key={p.id} href={`/api/uploads/${p.file_name}`} target="_blank" rel="noreferrer"><img src={`/api/uploads/${p.file_name}`} alt={p.caption ?? "Visit photo"} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, border: "1px solid var(--rule)" }} /></a>)}
                  </div>
                )}
                {v.signature_file && <div style={{ marginTop: 6 }}><img src={`/api/uploads/${v.signature_file}`} alt="Customer signature" style={{ height: 50, border: "1px solid var(--rule)", borderRadius: 4, background: "#fff" }} /></div>}
              </div>
            ))}
          </section>

          {j.parts.length > 0 && <JobParts job={j} />}

          <section className="panel">
            <div className="panel-head"><h2>Activity</h2></div>
            <div className="panel-body">
              {open && (
                <form className="row" style={{ marginBottom: 14, flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post(`/jobs/${j.id}/notes`, { note }), "Note added")) setNote(""); }}>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. customer called for an update)" aria-label="Note" />
                  <button disabled={!note.trim() || busy}>Add</button>
                </form>
              )}
              <Timeline items={j.activity} />
            </div>
          </section>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head"><h2>Equipment</h2></div>
            <div className="panel-body">
              {j.equipment.length === 0 ? <span className="muted">No specific equipment recorded.</span> : j.equipment.map((e: any) => (
                <div key={e.id} style={{ marginBottom: 8 }}>
                  <Link to={`/equipment/${e.id}`}><b>{e.asset_tag}</b></Link> {e.category_label}
                  <div className="small muted">{e.manufacturer} {e.model} · {e.location}</div>
                </div>
              ))}
            </div>
          </section>

          {j.recommendations.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Engineer recommendations</h2></div>
              <div className="panel-body stack">
                {j.recommendations.map((r: any) => (
                  <div key={r.id}>
                    <div className="row"><span className={`pill ${r.urgency === "safety" ? "red" : r.urgency === "high" ? "amber" : ""}`}>{label(r.urgency)}</span><span className="pill">{label(r.status)}</span></div>
                    <div>{r.description}</div>
                    {r.status === "open" && can("quote.write") && <button className="small" style={{ marginTop: 4 }} onClick={() => nav(`/quotes/new?recommendation=${r.id}`)}>Prepare quote</button>}
                    {r.quote_reference && <Link className="small" to={`/quotes/${r.quote_id}`}>{r.quote_reference}</Link>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(j.quotes.length > 0 || can("quote.write")) && (
            <section className="panel">
              <div className="panel-head"><h2>Quotes</h2>{can("quote.write") && <button className="small" onClick={() => nav(`/quotes/new?job=${j.id}`)}>New quote</button>}</div>
              <div className="panel-body">
                {j.quotes.length === 0 ? <span className="muted">None.</span> : j.quotes.map((q: any) => (
                  <div key={q.id} className="row" style={{ marginBottom: 6 }}><Link to={`/quotes/${q.id}`} className="ref">{q.reference}{q.revision > 1 ? ` rev ${q.revision}` : ""}</Link><QuoteStatus status={q.status} /><span className="small">{q.title}</span></div>
                ))}
              </div>
            </section>
          )}
          {j.purchase_orders.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Purchase orders</h2></div>
              <div className="panel-body">
                {j.purchase_orders.map((p: any) => <div key={p.id}><Link to={`/purchase-orders/${p.id}`} className="ref">{p.reference}</Link> <span className="pill">{label(p.status)}</span> {p.expected_date && <span className="small muted">expected {fmtDate(p.expected_date)}</span>}</div>)}
              </div>
            </section>
          )}
          {j.follow_ups.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Follow-on jobs</h2></div>
              <div className="panel-body">{j.follow_ups.map((f: any) => <div key={f.id}><Link to={`/jobs/${f.id}`} className="ref">{f.reference}</Link> {f.title} <JobStatus status={f.status} /></div>)}</div>
            </section>
          )}
        </div>
      </div>

      {scheduling && <ScheduleDialog job={j} visit={scheduling.visit} onClose={() => setScheduling(null)} />}
      {editing && <EditJob job={j} onClose={() => setEditing(false)} />}
      {holding && <HoldDialog job={j} onClose={() => setHolding(false)} />}
    </>
  );
}

function JobParts({ job }: { job: any }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const { run } = useAction();
  const needed = job.parts.filter((p: any) => p.status === "needed");
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Parts required</h2>
        {needed.length > 0 && can("po.manage") && <button className="small" onClick={() => nav(`/purchase-orders/new?job=${job.id}`)}>Order needed parts</button>}
      </div>
      <table className="data">
        <tbody>
          {job.parts.map((p: any) => (
            <tr key={p.id}>
              <td>{p.quantity} × {p.description} {p.sku && <span className="muted small">{p.sku}</span>}</td>
              <td><span className={`pill ${p.status === "available" ? "green" : p.status === "ordered" ? "blue" : p.status === "needed" ? "amber" : ""}`}>{label(p.status)}</span></td>
              <td className="small">{p.po_reference && <Link to={`/purchase-orders/${p.po_id}`}>{p.po_reference}</Link>}</td>
              <td className="right">{p.status === "needed" && can("stock.manage") && <button className="small" onClick={() => run(() => api.post(`/job-parts/${p.id}/available`), "Marked as available from stock")}>In stock</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function EditJob({ job, onClose }: { job: any; onClose: () => void }) {
  const [f, setF] = useState({ title: job.title, description: job.description ?? "", priority: job.priority, customer_order_ref: job.customer_order_ref ?? "", estimated_hours: job.estimated_hours ?? "", due_date: job.due_date ?? "" });
  const [eq, setEq] = useState<number[]>(job.equipment.map((e: any) => e.id));
  const site = useQuery({ queryKey: ["site", job.site_id], queryFn: () => api.get(`/sites/${job.site_id}`) });
  const { run, busy } = useAction();
  const save = async () => {
    const r = await run(() => api.patch(`/jobs/${job.id}`, { ...f, estimated_hours: f.estimated_hours === "" ? null : Number(f.estimated_hours), due_date: f.due_date || null, equipment_ids: eq }), "Job updated");
    if (r) onClose();
  };
  return (
    <Modal title={`Edit ${job.reference}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>Save changes</button></>}>
      <div className="form-grid">
        <Field label="Title" full><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" full><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Priority" hint={job.response_due_at && !job.first_attended_at ? "Changing priority recalculates the response target from when the job was logged." : undefined}>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["emergency", "urgent", "routine", "planned"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
        </Field>
        <Field label="Customer order ref"><input value={f.customer_order_ref} onChange={(e) => setF({ ...f, customer_order_ref: e.target.value })} /></Field>
        <Field label="Estimated hours"><input type="number" step={0.5} value={f.estimated_hours} onChange={(e) => setF({ ...f, estimated_hours: e.target.value })} /></Field>
        <Field label="Target date"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Equipment" full>
          <div className="stack" style={{ maxHeight: 180, overflowY: "auto" }}>
            {site.data?.equipment.filter((e: any) => e.status !== "decommissioned").map((e: any) => (
              <label key={e.id} className="check"><input type="checkbox" checked={eq.includes(e.id)} onChange={(ev) => setEq(ev.target.checked ? [...eq, e.id] : eq.filter((x) => x !== e.id))} />{e.asset_tag} {e.category_label} — {e.location}</label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function HoldDialog({ job, onClose }: { job: any; onClose: () => void }) {
  const [reason, setReason] = useState("awaiting_customer");
  const [note, setNote] = useState("");
  const { run, busy } = useAction();
  return (
    <Modal title={`Put ${job.reference} on hold`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => { if (await run(() => api.post(`/jobs/${job.id}/hold`, { reason, note }), "Job put on hold")) onClose(); }}>Put on hold</button></>}>
      <div className="stack">
        <Field label="Reason"><select value={reason} onChange={(e) => setReason(e.target.value)}>{HOLD_REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
        <Field label="What needs to happen next?"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer to confirm access date" /></Field>
        {job.visits.some((v: any) => v.status === "scheduled") && <div className="notice">This job has booked visits. They stay booked unless you cancel them.</div>}
      </div>
    </Modal>
  );
}
