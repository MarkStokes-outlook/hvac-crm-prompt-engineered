import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, label, money } from "../format";
import { ErrorBox, Field, JobStatus, Loading, Modal, Priority, QuoteStatus, Timeline, useAction } from "../components/ui";
import { AiBrief } from "../components/AiBrief";
import { REGIONS } from "./CustomersList";

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState<null | "site" | "contact" | "edit" | { contact: any }>(null);
  const { data: c, isLoading, error } = useQuery({ queryKey: ["customer", id], queryFn: () => api.get(`/customers/${id}`) });
  const history = useQuery({ queryKey: ["customer-history", id], queryFn: () => api.get(`/customers/${id}/history`) });
  const activity = useQuery({ queryKey: ["customer-activity", id], queryFn: () => api.get(`/customers/${id}/activity`), enabled: tab === "activity" });
  const { run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !c) return <ErrorBox error={error} />;
  const openJobs = history.data?.jobs.filter((j: any) => !["closed", "cancelled"].includes(j.status)) ?? [];

  return (
    <>
      <div className="crumbs"><Link to="/customers">Customers</Link></div>
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="muted">{c.account_ref}</span>
            {c.sector && <span className="muted">· {c.sector}</span>}
            {c.status !== "active" && <span className="pill">{label(c.status)}</span>}
            {c.account_hold ? <span className="pill red">Account on hold</span> : null}
          </div>
        </div>
        <div className="row">
          {can("job.create") && <button className="primary" onClick={() => nav(`/jobs/new?site=${c.sites[0]?.id ?? ""}`)} disabled={!c.sites.length}>Log a job</button>}
          {can("quote.write") && <button onClick={() => nav(`/quotes/new?customer=${c.id}`)}>New quote</button>}
          {can("customer.write") && <button onClick={() => setModal("edit")}>Edit</button>}
          {can("customer.account_hold") && (
            <button onClick={() => {
              if (c.account_hold) run(() => api.post(`/customers/${c.id}/account-hold`, { hold: false }), "Account hold released");
              else {
                const note = window.prompt("Reason for placing the account on hold:");
                if (note?.trim()) run(() => api.post(`/customers/${c.id}/account-hold`, { hold: true, note }), "Account placed on hold");
              }
            }}>{c.account_hold ? "Release account hold" : "Place on account hold"}</button>
          )}
        </div>
      </div>
      {c.account_hold ? <div className="notice red" style={{ marginBottom: 12 }}><b>Account hold:</b> {c.account_hold_note}</div> : null}
      <AiBrief kind="customer" id={c.id} />

      <div className="tabs" role="tablist">
        {[["overview", "Overview"], ["jobs", `Jobs (${history.data?.jobs.length ?? "…"})`], ["quotes", `Quotes (${history.data?.quotes.length ?? "…"})`], ["contracts", `Contracts (${c.contracts.length})`], ["activity", "Activity"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="cols">
          <div>
            <section className="panel">
              <div className="panel-head"><h2>Sites</h2>{can("customer.write") && <button className="small" onClick={() => setModal("site")}>Add site</button>}</div>
              <table className="data">
                <tbody>
                  {c.sites.map((s: any) => (
                    <tr key={s.id} className="clickable" onClick={() => nav(`/sites/${s.id}`)}>
                      <td><b>{s.name}</b>{!s.active && <span className="pill" style={{ marginLeft: 6 }}>Inactive</span>}<div className="muted small">{s.address} {s.postcode}</div></td>
                      <td className="small">{s.region}</td>
                      <td className="small">{s.equipment_count} assets</td>
                      <td className="small">{s.open_jobs ? `${s.open_jobs} open job${s.open_jobs > 1 ? "s" : ""}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.sites.length === 0 && <div className="panel-body muted">No sites yet — add one before logging jobs.</div>}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Open work</h2></div>
              {openJobs.length === 0 ? <div className="panel-body muted">No open jobs.</div> : (
                <table className="data"><tbody>
                  {openJobs.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span></td><td>{j.title}<div className="muted small">{j.site_name}</div></td><td><Priority p={j.priority} /></td><td><JobStatus status={j.status} /></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </section>
          </div>
          <div>
            <section className="panel">
              <div className="panel-head"><h2>Details</h2></div>
              <div className="panel-body">
                <dl className="facts">
                  <dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}</dd>
                  <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</dd>
                  <dt>Billing</dt><dd>{c.billing_address ?? "—"}</dd>
                  <dt>Customer since</dt><dd>{fmtDate(c.created_at)}</dd>
                </dl>
                {c.notes && <p className="pre" style={{ marginTop: 10 }}>{c.notes}</p>}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Contacts</h2>{can("customer.write") && <button className="small" onClick={() => setModal("contact")}>Add contact</button>}</div>
              <div className="panel-body stack">
                {c.contacts.map((ct: any) => (
                  <div key={ct.id}>
                    <div className="row spread"><b>{ct.name}</b>{can("customer.write") && <button className="ghost small" onClick={() => setModal({ contact: ct })}>Edit</button>}</div>
                    <div className="small muted">{ct.role}{ct.site_name ? ` · ${ct.site_name}` : ""}{ct.is_primary ? " · Primary" : ""}</div>
                    <div className="small">{ct.phone && <a href={`tel:${ct.phone}`}>{ct.phone}</a>} {ct.email && <a href={`mailto:${ct.email}`}>{ct.email}</a>}</div>
                  </div>
                ))}
                {c.contacts.length === 0 && <span className="muted">No contacts.</span>}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "jobs" && (
        <div className="panel table-wrap">
          <table className="data">
            <thead><tr><th>Job</th><th>Site</th><th>Type</th><th>Status</th><th>Logged</th><th>Completed</th></tr></thead>
            <tbody>
              {history.data?.jobs.map((j: any) => (
                <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                  <td><span className="ref">{j.reference}</span> {j.title}</td><td className="small">{j.site_name}</td><td className="small">{label(j.job_type)}</td><td><JobStatus status={j.status} /></td><td className="small">{fmtDate(j.created_at)}</td><td className="small">{fmtDate(j.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "quotes" && (
        <div className="panel table-wrap">
          <table className="data">
            <thead><tr><th>Quote</th><th>Site</th><th>Status</th><th className="right">Net</th><th>Valid until</th></tr></thead>
            <tbody>
              {history.data?.quotes.map((q: any) => (
                <tr key={q.id} className="clickable" onClick={() => nav(`/quotes/${q.id}`)}>
                  <td><span className="ref">{q.reference}{q.revision > 1 ? ` r${q.revision}` : ""}</span> {q.title}</td><td className="small">{q.site_name}</td><td><QuoteStatus status={q.status} /></td><td className="right">{money(q.net_total)}</td><td className="small">{fmtDate(q.valid_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data?.quotes.length === 0 && <div className="panel-body muted">No quotes.</div>}
        </div>
      )}

      {tab === "contracts" && (
        <div className="panel table-wrap">
          <table className="data">
            <thead><tr><th>Contract</th><th>Term</th><th>Response targets (E / U / R)</th><th>PPM</th><th>Status</th></tr></thead>
            <tbody>
              {c.contracts.map((k: any) => (
                <tr key={k.id} className="clickable" onClick={() => nav(`/contracts/${k.id}`)}>
                  <td><span className="ref">{k.reference}</span> {k.name}</td>
                  <td className="small">{fmtDate(k.start_date)} – {fmtDate(k.end_date)}</td>
                  <td className="small">{[k.response_emergency_hours, k.response_urgent_hours, k.response_routine_hours].map((h) => (h ? `${h}h` : "—")).join(" / ")}</td>
                  <td className="small">{k.ppm_visits_per_year ? `${k.ppm_visits_per_year}/yr` : "—"}</td>
                  <td><span className="pill">{label(k.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.contracts.length === 0 && <div className="panel-body muted">No contracts. Work for this customer is ad hoc.</div>}
        </div>
      )}

      {tab === "activity" && <div className="panel"><div className="panel-body">{activity.isLoading ? <Loading /> : <Timeline items={activity.data} />}</div></div>}

      {modal === "site" && <SiteForm customerId={c.id} onClose={() => setModal(null)} />}
      {modal === "contact" && <ContactForm customer={c} onClose={() => setModal(null)} />}
      {modal && typeof modal === "object" && <ContactForm customer={c} contact={modal.contact} onClose={() => setModal(null)} />}
      {modal === "edit" && <CustomerForm customer={c} onClose={() => setModal(null)} />}
    </>
  );
}

function CustomerForm({ customer, onClose }: { customer: any; onClose: () => void }) {
  const [f, setF] = useState({ name: customer.name, sector: customer.sector ?? "", status: customer.status, phone: customer.phone ?? "", email: customer.email ?? "", billing_address: customer.billing_address ?? "", notes: customer.notes ?? "" });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Edit customer" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => { if (await run(() => api.patch(`/customers/${customer.id}`, f), "Customer updated")) onClose(); }}>Save changes</button></>}>
      <div className="form-grid">
        <Field label="Name" full><input value={f.name} onChange={s("name")} /></Field>
        <Field label="Sector"><input value={f.sector} onChange={s("sector")} /></Field>
        <Field label="Status"><select value={f.status} onChange={s("status")}><option value="active">Active</option><option value="prospect">Prospect</option><option value="inactive">Inactive</option></select></Field>
        <Field label="Phone"><input value={f.phone} onChange={s("phone")} /></Field>
        <Field label="Email"><input value={f.email} onChange={s("email")} /></Field>
        <Field label="Billing address" full><input value={f.billing_address} onChange={s("billing_address")} /></Field>
        <Field label="Notes" full><textarea value={f.notes} onChange={s("notes")} /></Field>
      </div>
    </Modal>
  );
}

export function SiteForm({ customerId, site, onClose }: { customerId: number; site?: any; onClose: () => void }) {
  const [f, setF] = useState({ name: site?.name ?? "", address: site?.address ?? "", postcode: site?.postcode ?? "", region: site?.region ?? "Greater Manchester", access_notes: site?.access_notes ?? "" });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={site ? "Edit site" : "Add site"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.name || !f.address} onClick={async () => { if (await run(() => (site ? api.patch(`/sites/${site.id}`, f) : api.post("/sites", { ...f, customer_id: customerId })), site ? "Site updated" : "Site added")) onClose(); }}>{site ? "Save changes" : "Add site"}</button></>}>
      <div className="form-grid">
        <Field label="Site name" full><input value={f.name} onChange={s("name")} /></Field>
        <Field label="Address" full><input value={f.address} onChange={s("address")} /></Field>
        <Field label="Postcode"><input value={f.postcode} onChange={s("postcode")} /></Field>
        <Field label="Region" hint="Used for scheduling suggestions"><select value={f.region} onChange={s("region")}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Access notes" full hint="Shown to engineers: parking, sign-in, permits, restricted hours"><textarea value={f.access_notes} onChange={s("access_notes")} /></Field>
      </div>
    </Modal>
  );
}

function ContactForm({ customer, contact, onClose }: { customer: any; contact?: any; onClose: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? "", role: contact?.role ?? "", phone: contact?.phone ?? "", email: contact?.email ?? "", site_id: contact?.site_id ?? "", is_primary: !!contact?.is_primary });
  const { run, busy } = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const body = { ...f, site_id: f.site_id ? Number(f.site_id) : null };
  return (
    <Modal title={contact ? "Edit contact" : "Add contact"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.name} onClick={async () => { if (await run(() => (contact ? api.patch(`/contacts/${contact.id}`, body) : api.post("/contacts", { ...body, customer_id: customer.id })), contact ? "Contact updated" : "Contact added")) onClose(); }}>{contact ? "Save changes" : "Add contact"}</button></>}>
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={s("name")} /></Field>
        <Field label="Role"><input value={f.role} onChange={s("role")} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={s("phone")} /></Field>
        <Field label="Email"><input value={f.email} onChange={s("email")} /></Field>
        <Field label="Site (optional)"><select value={f.site_id} onChange={s("site_id")}><option value="">All sites</option>{customer.sites.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} /> Primary contact</label>
      </div>
    </Modal>
  );
}
