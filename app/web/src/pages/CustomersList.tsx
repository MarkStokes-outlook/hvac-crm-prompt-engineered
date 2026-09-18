import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Empty, Field, Loading, Modal, useAction } from "../components/ui";

export function CustomersList() {
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["customers", q, status], queryFn: () => api.get(`/customers${qs({ q, status })}`) });
  return (
    <>
      <div className="page-head">
        <div><h1>Customers</h1><div className="sub">Search matches customers, sites, addresses, postcodes and contacts</div></div>
        {can("customer.write") && <button className="primary" onClick={() => setCreating(true)}>Add customer</button>}
      </div>
      <div className="filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search customers" autoFocus />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="active">Active</option><option value="prospect">Prospect</option><option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : !data?.length ? <Empty>No customers match.</Empty> : (
          <table className="data">
            <thead><tr><th>Customer</th><th>Sector</th><th>Sites</th><th>Contract</th><th>Open jobs</th><th></th></tr></thead>
            <tbody>
              {data.map((c: any) => (
                <tr key={c.id} className="clickable" onClick={() => nav(`/customers/${c.id}`)}>
                  <td><b>{c.name}</b><div className="muted small">{c.account_ref}</div></td>
                  <td className="small">{c.sector ?? "—"}</td>
                  <td>{c.site_count}</td>
                  <td>{c.active_contracts ? <span className="pill green">Active</span> : <span className="muted small">None</span>}</td>
                  <td>{c.open_jobs || <span className="muted">0</span>}</td>
                  <td className="right">{c.status !== "active" && <span className="pill">{c.status}</span>} {c.account_hold ? <span className="pill red">Account hold</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NewCustomer onClose={() => setCreating(false)} onCreated={(id) => nav(`/customers/${id}`)} />}
    </>
  );
}

const SECTORS = ["Offices & commercial property", "Retail", "Hospitality & leisure", "Education", "Healthcare & care", "Light industrial & warehousing", "Multi-site & facilities management", "Other"];
export const REGIONS = ["Greater Manchester", "Lancashire", "Merseyside", "Cheshire", "West Yorkshire", "Other"];

function NewCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [f, setF] = useState({ name: "", sector: "", status: "active", phone: "", email: "", billing_address: "", site_name: "", site_address: "", postcode: "", region: "Greater Manchester", contact_name: "", contact_role: "", contact_phone: "", contact_email: "" });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save() {
    const r = await run(async () => {
      const c = await api.post("/customers", { name: f.name, sector: f.sector || null, status: f.status, phone: f.phone, email: f.email, billing_address: f.billing_address });
      if (f.site_name && f.site_address) {
        const site = await api.post("/sites", { customer_id: c.id, name: f.site_name, address: f.site_address, postcode: f.postcode, region: f.region });
        if (f.contact_name) await api.post("/contacts", { customer_id: c.id, site_id: site.id, name: f.contact_name, role: f.contact_role, phone: f.contact_phone, email: f.contact_email, is_primary: true });
      } else if (f.contact_name) await api.post("/contacts", { customer_id: c.id, name: f.contact_name, role: f.contact_role, phone: f.contact_phone, email: f.contact_email, is_primary: true });
      return c;
    }, "Customer added");
    if (r) onCreated((r as any).id);
  }
  return (
    <Modal wide title="Add customer" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.name.trim()} onClick={save}>Add customer</button></>}>
      <div className="form-grid">
        <Field label="Organisation name" full><input value={f.name} onChange={s("name")} autoFocus /></Field>
        <Field label="Sector"><select value={f.sector} onChange={s("sector")}><option value="">—</option>{SECTORS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Status"><select value={f.status} onChange={s("status")}><option value="active">Active</option><option value="prospect">Prospect</option></select></Field>
        <Field label="Main phone"><input value={f.phone} onChange={s("phone")} /></Field>
        <Field label="Main email"><input type="email" value={f.email} onChange={s("email")} /></Field>
        <Field label="Billing address" full><input value={f.billing_address} onChange={s("billing_address")} /></Field>
        <h3 className="full" style={{ marginTop: 6 }}>First site (optional)</h3>
        <Field label="Site name"><input value={f.site_name} onChange={s("site_name")} /></Field>
        <Field label="Region"><select value={f.region} onChange={s("region")}>{REGIONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Address"><input value={f.site_address} onChange={s("site_address")} /></Field>
        <Field label="Postcode"><input value={f.postcode} onChange={s("postcode")} /></Field>
        <h3 className="full" style={{ marginTop: 6 }}>Main contact (optional)</h3>
        <Field label="Name"><input value={f.contact_name} onChange={s("contact_name")} /></Field>
        <Field label="Role"><input value={f.contact_role} onChange={s("contact_role")} /></Field>
        <Field label="Phone"><input value={f.contact_phone} onChange={s("contact_phone")} /></Field>
        <Field label="Email"><input value={f.contact_email} onChange={s("contact_email")} /></Field>
      </div>
    </Modal>
  );
}
