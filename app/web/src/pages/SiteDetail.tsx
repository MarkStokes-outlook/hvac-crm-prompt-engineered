import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, label } from "../format";
import { ErrorBox, Field, JobStatus, Loading, Modal, useAction } from "../components/ui";
import { AiBrief } from "../components/AiBrief";
import { SiteForm } from "./CustomerDetail";

export function SiteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [modal, setModal] = useState<null | "edit" | "equipment">(null);
  const [showOld, setShowOld] = useState(false);
  const { data: s, isLoading, error } = useQuery({ queryKey: ["site", id], queryFn: () => api.get(`/sites/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;
  const equipment = s.equipment.filter((e: any) => showOld || e.status !== "decommissioned");

  return (
    <>
      <div className="crumbs"><Link to="/customers">Customers</Link> / <Link to={`/customers/${s.customer_id}`}>{s.customer_name}</Link></div>
      <div className="page-head">
        <div>
          <h1>{s.name}</h1>
          <div className="sub">{s.address} {s.postcode} · {s.region}</div>
        </div>
        <div className="row">
          {can("job.create") && <button className="primary" onClick={() => nav(`/jobs/new?site=${s.id}`)}>Log a job</button>}
          {can("customer.write") && <button onClick={() => setModal("equipment")}>Add equipment</button>}
          {can("customer.write") && <button onClick={() => setModal("edit")}>Edit site</button>}
        </div>
      </div>
      {s.account_hold ? <div className="notice red" style={{ marginBottom: 12 }}><b>Customer account on hold:</b> {s.account_hold_note}</div> : null}
      <AiBrief kind="site" id={s.id} />
      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Equipment</h2><label className="check small"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show decommissioned</label></div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Asset</th><th>Equipment</th><th>Location</th><th>Refrigerant</th><th>Last serviced</th></tr></thead>
                <tbody>
                  {equipment.map((e: any) => (
                    <tr key={e.id} className="clickable" onClick={() => nav(`/equipment/${e.id}`)}>
                      <td><span className="ref">{e.asset_tag ?? "—"}</span>{e.status !== "active" && <div><span className="pill">{label(e.status)}</span></div>}</td>
                      <td>{e.category_label}<div className="small muted">{e.manufacturer} {e.model}</div></td>
                      <td className="small">{e.location}</td>
                      <td className="small">{e.refrigerant ? `${e.refrigerant}${e.refrigerant_kg ? ` ${e.refrigerant_kg}kg` : ""}` : "—"}{e.fgas_leak_check_required ? <div><span className="pill amber" title="≥5 tCO2e — statutory F-gas leak checks apply">F-gas checks</span></div> : null}</td>
                      <td className="small">{fmtDate(e.last_serviced)}{e.under_warranty ? <div><span className="pill blue">Warranty to {fmtDate(e.warranty_expiry)}</span></div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {equipment.length === 0 && <div className="panel-body muted">No equipment recorded.</div>}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Work history</h2></div>
            <table className="data">
              <tbody>
                {s.jobs.map((j: any) => (
                  <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                    <td><span className="ref">{j.reference}</span></td><td>{j.title}<div className="small muted">{label(j.job_type)}</div></td><td><JobStatus status={j.status} /></td><td className="small nowrap">{fmtDate(j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.jobs.length === 0 && <div className="panel-body muted">No jobs at this site yet.</div>}
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Site information</h2></div>
            <div className="panel-body">
              <dl className="facts">
                <dt>Contract cover</dt><dd>{s.active_contracts.length ? s.active_contracts.map((k: any) => <div key={k.id}><Link to={`/contracts/${k.id}`}>{k.reference}</Link> {k.name}</div>) : <span className="muted">None active</span>}</dd>
                <dt>Access</dt><dd className="pre">{s.access_notes ?? "—"}</dd>
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Contacts</h2></div>
            <div className="panel-body stack">
              {s.contacts.map((c: any) => <div key={c.id}><b>{c.name}</b> <span className="small muted">{c.role}</span><div className="small">{c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>} {c.email}</div></div>)}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recommendations</h2></div>
            <div className="panel-body stack">
              {s.recommendations.length === 0 && <span className="muted">None.</span>}
              {s.recommendations.map((r: any) => (
                <div key={r.id}>
                  <div className="row"><span className={`pill ${r.urgency === "safety" ? "red" : r.urgency === "high" ? "amber" : ""}`}>{label(r.urgency)}</span><span className="pill">{label(r.status)}</span>{r.asset_tag && <span className="small">{r.asset_tag}</span>}</div>
                  <div className="small">{r.description}</div>
                  {r.status === "open" && can("quote.write") && <button className="small" style={{ marginTop: 4 }} onClick={() => nav(`/quotes/new?recommendation=${r.id}`)}>Prepare quote</button>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {modal === "edit" && <SiteForm customerId={s.customer_id} site={s} onClose={() => setModal(null)} />}
      {modal === "equipment" && <EquipmentForm siteId={s.id} onClose={() => setModal(null)} />}
    </>
  );
}

const REFRIGERANTS = ["", "R32", "R410A", "R407C", "R404A", "R134a", "R448A", "R449A", "R454B", "R454C", "R513A", "R290", "R744", "R22"];

export function EquipmentForm({ siteId, equipment, onClose }: { siteId: number; equipment?: any; onClose: () => void }) {
  const cats = useQuery({ queryKey: ["equipment-categories"], queryFn: () => api.get("/equipment-categories") });
  const e = equipment ?? {};
  const [f, setF] = useState({ category: e.category ?? "split_ac", asset_tag: e.asset_tag ?? "", manufacturer: e.manufacturer ?? "", model: e.model ?? "", serial_number: e.serial_number ?? "", location: e.location ?? "", refrigerant: e.refrigerant ?? "", refrigerant_kg: e.refrigerant_kg ?? "", install_date: e.install_date ?? "", warranty_expiry: e.warranty_expiry ?? "", status: e.status ?? "active", notes: e.notes ?? "" });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (ev: any) => setF({ ...f, [k]: ev.target.value });
  const body = { ...f, refrigerant: f.refrigerant || null, refrigerant_kg: f.refrigerant_kg === "" ? null : Number(f.refrigerant_kg), install_date: f.install_date || null, warranty_expiry: f.warranty_expiry || null };
  return (
    <Modal wide title={equipment ? "Edit equipment" : "Add equipment"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => { if (await run(() => (equipment ? api.patch(`/equipment/${equipment.id}`, body) : api.post("/equipment", { ...body, site_id: siteId })), equipment ? "Equipment updated" : "Equipment added")) onClose(); }}>{equipment ? "Save changes" : "Add equipment"}</button></>}>
      <div className="form-grid">
        <Field label="Type"><select value={f.category} onChange={s("category")}>{cats.data?.map((c: any) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
        <Field label="Asset tag"><input value={f.asset_tag} onChange={s("asset_tag")} /></Field>
        <Field label="Manufacturer"><input value={f.manufacturer} onChange={s("manufacturer")} /></Field>
        <Field label="Model"><input value={f.model} onChange={s("model")} /></Field>
        <Field label="Serial number"><input value={f.serial_number} onChange={s("serial_number")} /></Field>
        <Field label="Location on site"><input value={f.location} onChange={s("location")} /></Field>
        <Field label="Refrigerant"><select value={f.refrigerant} onChange={s("refrigerant")}>{REFRIGERANTS.map((r) => <option key={r} value={r}>{r || "None / not applicable"}</option>)}</select></Field>
        <Field label="Refrigerant charge (kg)"><input type="number" step={0.1} value={f.refrigerant_kg} onChange={s("refrigerant_kg")} /></Field>
        <Field label="Installed"><input type="date" value={f.install_date} onChange={s("install_date")} /></Field>
        <Field label="Warranty until"><input type="date" value={f.warranty_expiry} onChange={s("warranty_expiry")} /></Field>
        {equipment && <Field label="Status"><select value={f.status} onChange={s("status")}><option value="active">Active</option><option value="out_of_service">Out of service</option><option value="decommissioned">Decommissioned</option></select></Field>}
        <Field label="Notes" full><textarea value={f.notes} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}
