import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, label, money } from "../format";
import { Empty, Field, Loading, Modal, useAction } from "../components/ui";

export function Stock() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "parts";
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  const { can } = useAuth();
  return (
    <>
      <div className="page-head">
        <div><h1>Stock & orders</h1><div className="sub">Depot stores, van stock and supplier orders. Not a replacement for the accounts package.</div></div>
        {can("po.manage") && <Link className="btn primary" to="/purchase-orders/new">New purchase order</Link>}
      </div>
      <div className="tabs" role="tablist">
        {[["parts", "Parts & levels"], ["locations", "Stores & vans"], ["reorder", "Below minimum"], ["orders", "Purchase orders"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "parts" && <Parts />}
      {tab === "locations" && <Locations />}
      {tab === "reorder" && <Reorder />}
      {tab === "orders" && <Orders />}
    </>
  );
}

function Parts() {
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | { kind: "transfer" | "adjust"; part: any } | "new">(null);
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["parts", q], queryFn: () => api.get(`/parts${qs({ q })}`) });
  return (
    <>
      <div className="filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part name, SKU or category" aria-label="Search parts" />
        {can("stock.manage") && <button onClick={() => setModal("new")}>Add part</button>}
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : (
          <table className="data">
            <thead><tr><th>Part</th><th>Category</th><th className="right">Cost</th><th className="right">Sell</th><th>Where it is</th><th className="right">On order</th><th></th></tr></thead>
            <tbody>
              {data.map((p: any) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="small muted">{p.sku} · {p.unit}{p.supplier_name ? ` · ${p.supplier_name}` : ""}</div></td>
                  <td className="small">{p.category}</td>
                  <td className="right small">{p.unit_cost != null ? money(p.unit_cost) : "—"}</td>
                  <td className="right small">{money(p.sell_price)}</td>
                  <td className="small">{p.levels.filter((l: any) => l.quantity !== 0 || l.min_quantity > 0).map((l: any) => (
                    <span key={l.location_id} style={{ marginRight: 10, color: l.quantity < 0 ? "var(--heat)" : l.quantity < l.min_quantity ? "#8a5a12" : undefined }}>{l.location_name.replace("Van — ", "")}: <b>{l.quantity}</b>{l.quantity < l.min_quantity ? ` (min ${l.min_quantity})` : ""}</span>
                  ))}</td>
                  <td className="right">{p.on_order || ""}</td>
                  <td className="right nowrap">{can("stock.manage") && <><button className="small" onClick={() => setModal({ kind: "transfer", part: p })}>Transfer</button> <button className="small" onClick={() => setModal({ kind: "adjust", part: p })}>Count</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal === "new" && <NewPart onClose={() => setModal(null)} />}
      {modal && typeof modal === "object" && modal.kind === "transfer" && <Transfer part={modal.part} onClose={() => setModal(null)} />}
      {modal && typeof modal === "object" && modal.kind === "adjust" && <Adjust part={modal.part} onClose={() => setModal(null)} />}
    </>
  );
}

function useLocations() {
  return useQuery({ queryKey: ["locations"], queryFn: () => api.get("/stock/locations") });
}

function Transfer({ part, onClose }: { part: any; onClose: () => void }) {
  const locs = useLocations();
  const store = locs.data?.find((l: any) => l.kind === "store");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [qty, setQty] = useState(1);
  const { run, busy } = useAction();
  const fromId = from || String(store?.id ?? "");
  return (
    <Modal title={`Transfer ${part.name}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !to} onClick={async () => { if (await run(() => api.post("/stock/transfer", { part_id: part.id, from_location_id: Number(fromId), to_location_id: Number(to), quantity: qty }), "Stock transferred")) onClose(); }}>Transfer</button></>}>
      <div className="form-grid">
        <Field label="From"><select value={fromId} onChange={(e) => setFrom(e.target.value)}>{locs.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name} ({part.levels.find((x: any) => x.location_id === l.id)?.quantity ?? 0})</option>)}</select></Field>
        <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{locs.data?.filter((l: any) => String(l.id) !== fromId).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Quantity"><input type="number" min={0.1} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function Adjust({ part, onClose }: { part: any; onClose: () => void }) {
  const locs = useLocations();
  const [loc, setLoc] = useState<string>("");
  const [count, setCount] = useState<string>("");
  const [note, setNote] = useState("Stock count");
  const { run, busy } = useAction();
  const current = part.levels.find((x: any) => String(x.location_id) === loc)?.quantity ?? 0;
  return (
    <Modal title={`Stock count — ${part.name}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !loc || count === "" || !note.trim()} onClick={async () => { if (await run(() => api.post("/stock/adjust", { part_id: part.id, location_id: Number(loc), counted_quantity: Number(count), note }), "Stock level corrected")) onClose(); }}>Record count</button></>}>
      <div className="form-grid">
        <Field label="Location"><select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">Choose…</option>{locs.data?.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Counted quantity" hint={loc ? `System says ${current}` : undefined}><input type="number" min={0} step="any" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="Reason" full><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function NewPart({ onClose }: { onClose: () => void }) {
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/suppliers") });
  const [f, setF] = useState({ sku: "", name: "", category: "", unit: "each", unit_cost: "", sell_price: "", preferred_supplier_id: "" });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add part" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.sku || !f.name} onClick={async () => { if (await run(() => api.post("/parts", { ...f, unit_cost: f.unit_cost ? Number(f.unit_cost) : null, sell_price: f.sell_price ? Number(f.sell_price) : null, preferred_supplier_id: f.preferred_supplier_id ? Number(f.preferred_supplier_id) : null }), "Part added")) onClose(); }}>Add part</button></>}>
      <div className="form-grid">
        <Field label="SKU"><input value={f.sku} onChange={s("sku")} /></Field>
        <Field label="Name"><input value={f.name} onChange={s("name")} /></Field>
        <Field label="Category"><input value={f.category} onChange={s("category")} /></Field>
        <Field label="Unit"><input value={f.unit} onChange={s("unit")} /></Field>
        <Field label="Unit cost £"><input type="number" step="0.01" value={f.unit_cost} onChange={s("unit_cost")} /></Field>
        <Field label="Sell price £"><input type="number" step="0.01" value={f.sell_price} onChange={s("sell_price")} /></Field>
        <Field label="Preferred supplier" full><select value={f.preferred_supplier_id} onChange={s("preferred_supplier_id")}><option value="">—</option>{suppliers.data?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function Locations() {
  const locs = useLocations();
  const [sel, setSel] = useState<number | null>(null);
  const detail = useQuery({ queryKey: ["location", sel], queryFn: () => api.get(`/stock/locations/${sel}`), enabled: !!sel });
  return (
    <div className="cols" style={{ gridTemplateColumns: "300px 1fr" }}>
      <div className="panel">
        {locs.data?.map((l: any) => (
          <div key={l.id} className={`queue-item ${sel === l.id ? "selected" : ""}`} style={{ cursor: "pointer" }} onClick={() => setSel(l.id)}>
            <b>{l.name}</b>
            <div className="small muted">{l.kind === "van" ? "Van stock" : "Store"}{l.below_min ? ` · ${l.below_min} below min` : ""}{l.negative ? <span style={{ color: "var(--heat)" }}> · {l.negative} negative</span> : ""}</div>
          </div>
        ))}
      </div>
      <div>
        {!sel ? <div className="panel"><Empty>Select a store or van.</Empty></div> : !detail.data ? <Loading /> : (
          <>
            <section className="panel">
              <div className="panel-head"><h2>{detail.data.name}</h2></div>
              <table className="data">
                <thead><tr><th>Part</th><th className="right">Qty</th><th className="right">Min</th></tr></thead>
                <tbody>{detail.data.items.map((i: any) => <tr key={i.part_id}><td>{i.name} <span className="muted small">{i.sku}</span></td><td className="right" style={{ color: i.quantity < 0 ? "var(--heat)" : i.quantity < i.min_quantity ? "#8a5a12" : undefined }}><b>{i.quantity}</b></td><td className="right muted">{i.min_quantity}</td></tr>)}</tbody>
              </table>
              {detail.data.items.some((i: any) => i.quantity < 0) && <div className="panel-body"><div className="notice red small">Negative quantities mean parts were recorded as used that the system didn't know were on the van. Count the van and record the correct level.</div></div>}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Recent movements</h2></div>
              <table className="data"><tbody>
                {detail.data.movements.map((m: any) => (
                  <tr key={m.id}><td className="small nowrap">{fmtDateTime(m.created_at)}</td><td className="small">{label(m.reason)}: {m.quantity} × {m.part_name}</td><td className="small">{m.from_name ?? "—"} → {m.to_name ?? "fitted"}</td><td className="small">{m.job_reference ?? m.po_reference ?? m.note ?? ""}</td><td className="small muted">{m.user_name}</td></tr>
                ))}
              </tbody></table>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Reorder() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["reorder"], queryFn: () => api.get("/stock/reorder") });
  if (isLoading) return <Loading />;
  return (
    <div className="panel table-wrap">
      {!data.length ? <Empty>Everything is at or above its minimum.</Empty> : (
        <table className="data">
          <thead><tr><th>Part</th><th>Location</th><th className="right">Qty</th><th className="right">Min</th><th className="right">On order</th><th>Supplier</th><th></th></tr></thead>
          <tbody>
            {data.map((r: any) => (
              <tr key={`${r.part_id}-${r.location_id}`}>
                <td>{r.name} <span className="muted small">{r.sku}</span></td><td className="small">{r.location_name}</td>
                <td className="right" style={{ color: r.quantity < 0 ? "var(--heat)" : undefined }}><b>{r.quantity}</b></td><td className="right">{r.min_quantity}</td><td className="right">{r.on_order || ""}</td><td className="small">{r.supplier_name}</td>
                <td className="right">{r.kind === "store" && can("po.manage") && r.preferred_supplier_id && <button className="small" onClick={() => nav(`/purchase-orders/new?supplier=${r.preferred_supplier_id}&part=${r.part_id}&qty=${Math.max(1, r.min_quantity * 2 - r.quantity - r.on_order)}`)}>Order</button>}{r.kind === "van" && <span className="small muted">Top up from store</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Orders() {
  const nav = useNavigate();
  const [status, setStatus] = useState("open");
  const { data, isLoading } = useQuery({ queryKey: ["pos", status], queryFn: () => api.get(`/purchase-orders${qs({ status: status === "all" ? "" : status })}`) });
  return (
    <>
      <div className="filters"><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="open">Open</option><option value="received">Received</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : !data.length ? <Empty>No purchase orders.</Empty> : (
          <table className="data">
            <thead><tr><th>PO</th><th>Supplier</th><th>Deliver to</th><th>For job</th><th>Status</th><th>Expected</th><th className="right">Value</th></tr></thead>
            <tbody>{data.map((p: any) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/purchase-orders/${p.id}`)}>
                <td className="ref">{p.reference}</td><td>{p.supplier_name}</td><td className="small">{p.location_name}</td><td className="small">{p.job_reference ?? "Stock"}</td><td><span className={`pill ${p.status === "received" ? "green" : p.status === "part_received" ? "amber" : p.status === "ordered" ? "blue" : ""}`}>{label(p.status)}</span></td><td className="small">{fmtDate(p.expected_date)}</td><td className="right">{money(p.total_cost)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
