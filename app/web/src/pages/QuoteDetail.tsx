import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, label, money } from "../format";
import { askReason, ErrorBox, Field, Loading, Modal, QuoteStatus, Timeline, useAction } from "../components/ui";

export function QuoteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const { data: q, isLoading, error } = useQuery({ queryKey: ["quote", id], queryFn: () => api.get(`/quotes/${id}`) });
  const { run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !q) return <ErrorBox error={error} />;

  return (
    <>
      <div className="crumbs"><Link to="/quotes">Quotes</Link> / <Link to={`/customers/${q.customer_id}`}>{q.customer_name}</Link></div>
      <div className="page-head">
        <div>
          <h1><span className="ref">{q.reference}{q.revision > 1 ? ` rev ${q.revision}` : ""}</span> {q.title}</h1>
          <div className="row" style={{ marginTop: 4 }}><QuoteStatus status={q.status} expired={q.expired} /><span className="muted">{label(q.quote_type)} · prepared by {q.prepared_by_name}</span></div>
        </div>
        <div className="row">
          {q.status === "draft" && can("quote.write") && <button onClick={() => nav(`/quotes/${q.id}/edit`)}>Edit draft</button>}
          {q.status === "draft" && can("quote.send") && <button className="primary" onClick={() => { if (window.confirm("Mark this quote as issued to the customer? It can no longer be edited (create a revision instead). Send the printed/PDF copy yourself.")) run(() => api.post(`/quotes/${q.id}/send`), "Quote marked as sent"); }}>Mark as sent</button>}
          {q.status === "sent" && can("quote.decide") && <button className="primary" onClick={() => setAccepting(true)}>Record acceptance</button>}
          {q.status === "sent" && can("quote.decide") && <button onClick={() => { const r = askReason("Why did the customer reject it?"); if (r) run(() => api.post(`/quotes/${q.id}/reject`, { reason: r }), "Rejection recorded"); }}>Record rejection</button>}
          {["sent", "rejected"].includes(q.status) && can("quote.write") && <button onClick={async () => { const r: any = await run(() => api.post(`/quotes/${q.id}/revise`), "Revision created"); if (r) nav(`/quotes/${r.id}/edit`); }}>Revise</button>}
          {q.status === "accepted" && !q.converted_job_id && can("quote.convert") && <button className="primary" onClick={async () => { const j: any = await run(() => api.post(`/quotes/${q.id}/convert`), (x: any) => `Job ${x.reference} ready to schedule`); if (j) nav(`/jobs/${j.id}`); }}>Create job</button>}
          {["draft", "sent"].includes(q.status) && can("quote.write") && <button className="danger" onClick={() => { const r = askReason("Reason for withdrawing:"); if (r) run(() => api.post(`/quotes/${q.id}/withdraw`, { reason: r }), "Quote withdrawn"); }}>Withdraw</button>}
          <button className="ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      {q.expired && <div className="notice" style={{ marginBottom: 10 }}>Validity ended {fmtDate(q.valid_until)}. You can still record acceptance, but check prices first — or revise it.</div>}
      {q.status === "accepted" && q.converted_job_id && <div className="notice green" style={{ marginBottom: 10 }}>Accepted by {q.decision_by_name} on {fmtDate(q.decided_at)}{q.customer_po ? ` (PO ${q.customer_po})` : ""}. Work: <Link to={`/jobs/${q.converted_job_id}`}>{q.converted_job_reference}</Link></div>}
      {q.status === "accepted" && !q.converted_job_id && <div className="notice" style={{ marginBottom: 10 }}>Accepted by {q.decision_by_name} — not yet turned into a job.</div>}
      {q.status === "rejected" && <div className="notice red" style={{ marginBottom: 10 }}>Rejected{q.decision_by_name ? ` by ${q.decision_by_name}` : ""} on {fmtDate(q.decided_at)}: {q.rejection_reason}</div>}
      {q.status === "superseded" && <div className="notice" style={{ marginBottom: 10 }}>Superseded by <Link to={`/quotes/${q.superseded_by_id}`}>revision {q.superseded_by_revision}</Link>.</div>}

      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-body">
              <dl className="facts" style={{ marginBottom: 14 }}>
                <dt>Customer</dt><dd>{q.customer_name}{q.contact_name ? ` — FAO ${q.contact_name}` : ""}</dd>
                <dt>Site</dt><dd>{q.site_name ? <Link to={`/sites/${q.site_id}`}>{q.site_name}</Link> : "—"} <span className="muted small">{q.site_address}</span></dd>
                <dt>Valid until</dt><dd>{fmtDate(q.valid_until)}</dd>
                {q.origin_job_reference && <><dt>Raised from job</dt><dd><Link to={`/jobs/${q.origin_job_id}`}>{q.origin_job_reference}</Link></dd></>}
              </dl>
              {q.scope && <><h3>Scope of works</h3><p className="pre">{q.scope}</p></>}
              <table className="data" style={{ marginTop: 10 }}>
                <thead><tr><th>Description</th><th>Type</th><th className="right">Qty</th><th className="right">Unit</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {q.lines.map((l: any) => (
                    <tr key={l.id}><td>{l.description}{l.sku && <span className="muted small"> ({l.sku})</span>}{l.asset_tag && <span className="muted small"> · {l.asset_tag}</span>}</td><td className="small">{label(l.line_type)}</td><td className="right">{l.quantity}</td><td className="right">{money(l.unit_price)}</td><td className="right">{money(l.quantity * l.unit_price)}</td></tr>
                  ))}
                  <tr><td colSpan={4} className="right">Net</td><td className="right"><b>{money(q.net)}</b></td></tr>
                  <tr><td colSpan={4} className="right">VAT at {Math.round(q.vat_rate * 100)}%</td><td className="right">{money(q.vat)}</td></tr>
                  <tr><td colSpan={4} className="right"><b>Total</b></td><td className="right"><b>{money(q.gross)}</b></td></tr>
                </tbody>
              </table>
              {q.lines.some((l: any) => l.unit_price === 0) && <div className="notice small" style={{ marginTop: 10 }}>Some lines are priced at £0 — check they are intentional.</div>}
            </div>
          </section>
        </div>
        <div>
          {q.revisions.length > 1 && (
            <section className="panel">
              <div className="panel-head"><h2>Revisions</h2></div>
              <div className="panel-body">{q.revisions.map((r: any) => <div key={r.id}><Link to={`/quotes/${r.id}`}>Rev {r.revision}</Link> <QuoteStatus status={r.status} /> <span className="small muted">{fmtDate(r.created_at)}</span></div>)}</div>
            </section>
          )}
          {q.recommendations.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>From engineer recommendations</h2></div>
              <div className="panel-body small stack">{q.recommendations.map((r: any) => <div key={r.id}>{r.description}</div>)}</div>
            </section>
          )}
          <section className="panel">
            <div className="panel-head"><h2>History</h2></div>
            <div className="panel-body"><Timeline items={q.activity} /></div>
          </section>
        </div>
      </div>
      {accepting && <AcceptDialog quote={q} onClose={() => setAccepting(false)} onDone={(r) => r.created_job && nav(`/jobs/${r.created_job.id}`)} />}
    </>
  );
}

function AcceptDialog({ quote, onClose, onDone }: { quote: any; onClose: () => void; onDone: (r: any) => void }) {
  const [by, setBy] = useState(quote.contact_name ?? "");
  const [po, setPo] = useState("");
  const [createJob, setCreateJob] = useState(true);
  const { run, busy } = useAction();
  return (
    <Modal title={`Record acceptance of ${quote.reference}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !by.trim()} onClick={async () => { const r: any = await run(() => api.post(`/quotes/${quote.id}/accept`, { decision_by_name: by, customer_po: po || null, create_job: createJob }), (x: any) => x.created_job ? `Accepted — job ${x.created_job.reference} is ready to schedule` : "Acceptance recorded"); if (r) { onClose(); onDone(r); } }}>Record acceptance</button></>}>
      <div className="stack">
        {quote.expired && <div className="notice">This quote's validity ended on {fmtDateTime(quote.valid_until)}.</div>}
        <Field label="Accepted by (customer name)"><input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        <Field label="Customer order / PO number"><input value={po} onChange={(e) => setPo(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={createJob} onChange={(e) => setCreateJob(e.target.checked)} /> Create the job now{quote.origin_job_reference ? ` (resumes ${quote.origin_job_reference} if it's waiting on this quote)` : ""}</label>
        <p className="small muted">Quoted parts become the job's parts requirements so they can be ordered or allocated.</p>
      </div>
    </Modal>
  );
}
