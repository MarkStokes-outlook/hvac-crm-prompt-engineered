import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, label, money } from "../format";
import { askReason, ErrorBox, Field, Loading, Modal, Timeline, useAction } from "../components/ui";

export function PurchaseOrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const { data: po, isLoading, error } = useQuery({ queryKey: ["po", id], queryFn: () => api.get(`/purchase-orders/${id}`) });
  const { run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !po) return <ErrorBox error={error} />;
  const total = po.lines.reduce((a: number, l: any) => a + l.quantity * (l.unit_cost ?? 0), 0);
  return (
    <>
      <div className="crumbs"><Link to="/stock?tab=orders">Purchase orders</Link></div>
      <div className="page-head">
        <div>
          <h1><span className="ref">{po.reference}</span> {po.supplier_name}</h1>
          <div className="row" style={{ marginTop: 4 }}><span className={`pill ${po.status === "received" ? "green" : po.status === "part_received" ? "amber" : po.status === "ordered" ? "blue" : ""}`}>{label(po.status)}</span><span className="muted">Deliver to {po.location_name}</span>{po.job_reference && <span>for <Link to={`/jobs/${po.job_id}`}>{po.job_reference}</Link></span>}</div>
        </div>
        <div className="row">
          {po.status === "draft" && can("po.manage") && <button className="primary" onClick={() => { const ref = window.prompt("Supplier order reference (optional):", ""); if (ref !== null) run(() => api.post(`/purchase-orders/${po.id}/order`, { supplier_ref: ref || null }), "Marked as ordered"); }}>Mark as ordered</button>}
          {["ordered", "part_received"].includes(po.status) && can("po.manage") && <button className="primary" onClick={() => setReceiving(true)}>Receive goods</button>}
          {["draft", "ordered"].includes(po.status) && can("po.manage") && <button className="danger" onClick={() => { const r = askReason("Reason for cancelling this order:"); if (r) run(() => api.post(`/purchase-orders/${po.id}/cancel`, { reason: r }), "Order cancelled"); }}>Cancel order</button>}
        </div>
      </div>
      <div className="cols">
        <section className="panel">
          <table className="data">
            <thead><tr><th>Item</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Unit cost</th><th className="right">Line</th></tr></thead>
            <tbody>
              {po.lines.map((l: any) => <tr key={l.id}><td>{l.description} <span className="muted small">{l.sku}</span>{l.job_part_id && <span className="pill blue" style={{ marginLeft: 6 }}>For job</span>}</td><td className="right">{l.quantity}</td><td className="right" style={{ color: l.received_quantity >= l.quantity ? "var(--ok)" : undefined }}>{l.received_quantity}</td><td className="right">{money(l.unit_cost)}</td><td className="right">{money(l.quantity * (l.unit_cost ?? 0))}</td></tr>)}
              <tr><td colSpan={4} className="right"><b>Total (ex VAT)</b></td><td className="right"><b>{money(total)}</b></td></tr>
            </tbody>
          </table>
        </section>
        <div>
          <section className="panel">
            <div className="panel-body">
              <dl className="facts">
                <dt>Supplier</dt><dd>{po.supplier_name}<div className="small">{po.supplier_phone} {po.supplier_email}</div></dd>
                <dt>Supplier ref</dt><dd>{po.supplier_ref ?? "—"}</dd>
                <dt>Expected</dt><dd>{fmtDate(po.expected_date)}</dd>
                <dt>Raised</dt><dd>{fmtDateTime(po.created_at)} by {po.created_by_name}</dd>
                {po.notes && <><dt>Notes</dt><dd>{po.notes}</dd></>}
              </dl>
              <div className="assumption" style={{ marginTop: 8 }}>Sending the order to the supplier and invoicing happen outside this system.</div>
            </div>
          </section>
          <section className="panel"><div className="panel-head"><h2>History</h2></div><div className="panel-body"><Timeline items={po.activity} /></div></section>
        </div>
      </div>
      {receiving && <Receive po={po} onClose={() => setReceiving(false)} />}
    </>
  );
}

function Receive({ po, onClose }: { po: any; onClose: () => void }) {
  const open = po.lines.filter((l: any) => l.received_quantity < l.quantity);
  const [qty, setQty] = useState<Record<number, number>>(Object.fromEntries(open.map((l: any) => [l.id, l.quantity - l.received_quantity])));
  const { run, busy } = useAction();
  return (
    <Modal title={`Receive against ${po.reference}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => {
      const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id: Number(line_id), quantity }));
      if (await run(() => api.post(`/purchase-orders/${po.id}/receive`, { lines }), (r: any) => r.released_jobs?.length ? `Received. ${r.released_jobs.join(", ")} can now be scheduled.` : "Goods received")) onClose();
    }}>Receive into {po.location_name}</button></>}>
      <table className="data">
        <thead><tr><th>Item</th><th className="right">Outstanding</th><th style={{ width: 110 }}>Receiving</th></tr></thead>
        <tbody>{open.map((l: any) => <tr key={l.id}><td>{l.description}</td><td className="right">{l.quantity - l.received_quantity}</td><td><input type="number" min={0} max={l.quantity - l.received_quantity} step="any" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} /></td></tr>)}</tbody>
      </table>
      {po.job_reference && <p className="small muted" style={{ marginTop: 10 }}>When every part {po.job_reference} is waiting for has arrived, the job comes off hold and goes back to the scheduling queue.</p>}
    </Modal>
  );
}

export function NewPurchaseOrder() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const jobId = params.get("job");
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/suppliers") });
  const locs = useQuery({ queryKey: ["locations"], queryFn: () => api.get("/stock/locations") });
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.get(`/jobs/${jobId}`), enabled: !!jobId });
  const parts = useQuery({ queryKey: ["parts", ""], queryFn: () => api.get(`/parts${qs({})}`) });
  const [supplierId, setSupplierId] = useState(params.get("supplier") ?? "");
  const [locationId, setLocationId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<any[]>([]);
  const { run, busy } = useAction();

  useEffect(() => {
    if (!locationId && locs.data) setLocationId(String(locs.data.find((l: any) => l.kind === "store")?.id ?? ""));
  }, [locs.data, locationId]);
  useEffect(() => {
    if (job.data && !lines.length) {
      const needed = job.data.parts.filter((p: any) => p.status === "needed");
      setLines(needed.map((p: any) => ({ part_id: p.part_id, description: p.description, quantity: p.quantity, unit_cost: null, job_part_id: p.id })));
      const first = parts.data?.find((x: any) => x.id === needed[0]?.part_id);
      if (first?.preferred_supplier_id && !supplierId) setSupplierId(String(first.preferred_supplier_id));
    }
    if (!jobId && params.get("part") && parts.data && !lines.length) {
      const p = parts.data.find((x: any) => String(x.id) === params.get("part"));
      if (p) setLines([{ part_id: p.id, description: p.name, quantity: Number(params.get("qty") ?? 1), unit_cost: p.unit_cost }]);
    }
  }, [job.data, parts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const r: any = await run(() => api.post("/purchase-orders", { supplier_id: Number(supplierId), deliver_to_location_id: Number(locationId), job_id: jobId ? Number(jobId) : null, expected_date: expected || null, notes: notes || null, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_cost: l.unit_cost === "" || l.unit_cost == null ? null : Number(l.unit_cost) })) }), (x: any) => `Draft ${x.reference} created`);
    if (r) nav(`/purchase-orders/${r.id}`);
  }

  return (
    <>
      <div className="crumbs"><Link to="/stock?tab=orders">Purchase orders</Link> / New</div>
      <div className="page-head"><div><h1>New purchase order</h1>{job.data && <div className="sub">For job <Link to={`/jobs/${job.data.id}`}>{job.data.reference}</Link> — {job.data.title}</div>}</div></div>
      <div className="panel"><div className="panel-body stack">
        <div className="form-grid">
          <Field label="Supplier"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose…</option>{suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Deliver to"><select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{locs.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Expected delivery"><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <table className="data">
          <thead><tr><th>Part</th><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 110 }}>Unit cost</th><th></th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td><select value={l.part_id ?? ""} onChange={(e) => { const p = parts.data?.find((x: any) => String(x.id) === e.target.value); setLines(lines.map((x, j) => j === i ? { ...x, part_id: p?.id ?? null, description: p?.name ?? x.description, unit_cost: p?.unit_cost ?? x.unit_cost } : x)); }}><option value="">Non-catalogue item</option>{parts.data?.map((p: any) => <option key={p.id} value={p.id}>{p.sku}</option>)}</select></td>
              <td><input value={l.description} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />{l.job_part_id && <span className="small muted">Job requirement</span>}</td>
              <td><input type="number" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></td>
              <td><input type="number" step="0.01" value={l.unit_cost ?? ""} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unit_cost: e.target.value } : x))} /></td>
              <td><button className="ghost small" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove">✕</button></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="row spread">
          <button className="small" onClick={() => setLines([...lines, { part_id: null, description: "", quantity: 1, unit_cost: null }])}>Add line</button>
          <div className="row"><Link className="btn" to="/stock?tab=orders">Cancel</Link><button className="primary" disabled={busy || !supplierId || !lines.length} onClick={save}>Create draft order</button></div>
        </div>
      </div></div>
    </>
  );
}
