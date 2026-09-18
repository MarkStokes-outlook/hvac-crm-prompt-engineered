import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDateTime, label } from "../format";
import { Field, useAction } from "../components/ui";

const TYPES = ["reactive", "planned_maintenance", "quoted_works", "installation", "survey", "warranty"];

export function NewJob() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(params.get("site") ? Number(params.get("site")) : null);
  const [f, setF] = useState({ job_type: "reactive", priority: "routine", title: "", description: "", reported_via: "phone", reported_by_contact_id: "", reported_by_name: "", customer_order_ref: "", estimated_hours: "", due_date: "" });
  const [equipmentIds, setEquipmentIds] = useState<number[]>(params.get("equipment") ? [Number(params.get("equipment"))] : []);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const { run, busy } = useAction();

  const customers = useQuery({ queryKey: ["customers", customerQuery], queryFn: () => api.get(`/customers${qs({ q: customerQuery, limit: 8 })}`), enabled: !customerId && customerQuery.length > 1 });
  const site = useQuery({ queryKey: ["site", siteId], queryFn: () => api.get(`/sites/${siteId}`), enabled: !!siteId });
  const customer = useQuery({ queryKey: ["customer", customerId ?? site.data?.customer_id], queryFn: () => api.get(`/customers/${customerId ?? site.data?.customer_id}`), enabled: !!(customerId ?? site.data?.customer_id) });
  const preview = useQuery({ queryKey: ["job-preview", siteId, f.job_type, f.priority], queryFn: () => api.get(`/jobs/preview${qs({ site_id: siteId, job_type: f.job_type, priority: f.priority })}`), enabled: !!siteId });

  useEffect(() => {
    if (site.data && !customerId) setCustomerId(site.data.customer_id);
  }, [site.data, customerId]);
  useEffect(() => {
    const sites = customer.data?.sites?.filter((s: any) => s.active);
    if (sites?.length === 1 && !siteId) setSiteId(sites[0].id);
  }, [customer.data, siteId]);
  useEffect(() => {
    if (f.job_type === "planned_maintenance" && f.priority !== "planned") setF((x) => ({ ...x, priority: "planned" }));
    if (f.job_type === "reactive" && f.priority === "planned") setF((x) => ({ ...x, priority: "routine" }));
  }, [f.job_type]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!siteId) return;
    const job = await run(
      () =>
        api.post("/jobs", {
          site_id: siteId,
          job_type: f.job_type,
          priority: f.priority,
          title: f.title,
          description: f.description || null,
          equipment_ids: equipmentIds,
          reported_via: f.reported_via || null,
          reported_by_contact_id: f.reported_by_contact_id ? Number(f.reported_by_contact_id) : null,
          reported_by_name: f.reported_by_name || null,
          customer_order_ref: f.customer_order_ref || null,
          estimated_hours: f.estimated_hours ? Number(f.estimated_hours) : null,
          due_date: f.due_date || null,
        }),
      (j: any) => `Logged ${j.reference}`,
    );
    if (job) nav(`/jobs/${(job as any).id}`);
  }

  const contacts = customer.data?.contacts ?? [];

  return (
    <>
      <div className="crumbs"><Link to="/jobs">Jobs</Link> / New</div>
      <div className="page-head"><div><h1>Log a job</h1><div className="sub">Record a fault call, email or planned work. Contract cover and response target are applied automatically.</div></div></div>
      <div className="cols">
        <form className="panel" onSubmit={submit}>
          <div className="panel-body stack">
            {aiNote && <div className="notice blue small">{aiNote}</div>}
            {!customerId ? (
              <div>
                <Field label="Customer" hint="Search by customer, site name, address, postcode or contact">
                  <input autoFocus value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="e.g. Northgate, BB4, Joanne" />
                </Field>
                {customers.data?.map((c: any) => (
                  <button type="button" key={c.id} className="ghost" style={{ display: "flex", width: "100%", justifyContent: "space-between" }} onClick={() => setCustomerId(c.id)}>
                    <span>{c.name} <span className="muted small">{c.account_ref}</span></span>
                    <span className="small muted">{c.active_contracts ? "Contract" : "No contract"}{c.account_hold ? " · On hold" : ""}</span>
                  </button>
                ))}
                {customers.data?.length === 0 && <div className="muted small">No match. <Link to="/customers?new=1">Add a new customer</Link></div>}
              </div>
            ) : (
              <div className="row spread">
                <div><span className="muted small">Customer</span><div><b>{customer.data?.name}</b></div></div>
                <button type="button" className="small" onClick={() => { setCustomerId(null); setSiteId(null); setEquipmentIds([]); }}>Change</button>
              </div>
            )}

            {customerId && (
              <Field label="Site">
                <select value={siteId ?? ""} onChange={(e) => { setSiteId(Number(e.target.value) || null); setEquipmentIds([]); }} required>
                  <option value="">Choose a site…</option>
                  {customer.data?.sites?.filter((s: any) => s.active).map((s: any) => <option key={s.id} value={s.id}>{s.name} — {s.postcode}</option>)}
                </select>
              </Field>
            )}

            {siteId && (
              <>
                <div className="form-grid">
                  <Field label="Type"><select value={f.job_type} onChange={(e) => setF({ ...f, job_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
                  <Field label="Priority" hint="Choose based on the customer's situation; response targets come from their contract.">
                    <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                      {(f.job_type === "reactive" ? ["emergency", "urgent", "routine"] : ["emergency", "urgent", "routine", "planned"]).map((p) => <option key={p} value={p}>{label(p)}</option>)}
                    </select>
                  </Field>
                  <Field label="Title" full><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Meeting room AC blowing warm air" /></Field>
                  <Field label="Fault / work description" full><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Symptoms, location, what the customer has tried, access constraints" /></Field>
                  <Field label="Reported via"><select value={f.reported_via} onChange={(e) => setF({ ...f, reported_via: e.target.value })}>{["phone", "email", "engineer", "planned", "other"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></Field>
                  <Field label="Reported by">
                    <select value={f.reported_by_contact_id} onChange={(e) => setF({ ...f, reported_by_contact_id: e.target.value })}>
                      <option value="">Someone else / not a contact</option>
                      {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ""}</option>)}
                    </select>
                  </Field>
                  {!f.reported_by_contact_id && <Field label="Caller name"><input value={f.reported_by_name} onChange={(e) => setF({ ...f, reported_by_name: e.target.value })} /></Field>}
                  <Field label="Customer order / PO ref"><input value={f.customer_order_ref} onChange={(e) => setF({ ...f, customer_order_ref: e.target.value })} /></Field>
                  <Field label="Estimated hours"><input type="number" min={0.25} step={0.25} value={f.estimated_hours} onChange={(e) => setF({ ...f, estimated_hours: e.target.value })} /></Field>
                  {f.job_type !== "reactive" && <Field label="Target date"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>}
                </div>
                <Field label="Equipment involved">
                  <div className="stack" style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--rule)", borderRadius: 5, padding: 10 }}>
                    {site.data?.equipment?.filter((e: any) => e.status !== "decommissioned").map((e: any) => (
                      <label key={e.id} className="check">
                        <input type="checkbox" checked={equipmentIds.includes(e.id)} onChange={(ev) => setEquipmentIds(ev.target.checked ? [...equipmentIds, e.id] : equipmentIds.filter((x) => x !== e.id))} />
                        <span><b>{e.asset_tag}</b> {e.category_label} — {e.location} <span className="muted small">{e.manufacturer} {e.model}</span></span>
                      </label>
                    ))}
                    {site.data?.equipment?.length === 0 && <span className="muted small">No equipment recorded at this site.</span>}
                  </div>
                </Field>
                <div className="row"><button className="primary" disabled={busy || !f.title.trim()}>Log job</button><Link to="/jobs" className="btn">Cancel</Link></div>
              </>
            )}
          </div>
        </form>

        <div>
          {siteId && preview.data && (
            <section className="panel">
              <div className="panel-head"><h2>What will apply</h2></div>
              <div className="panel-body stack">
                <div>
                  <div className="muted small">Contract</div>
                  {preview.data.contract ? <div><b>{preview.data.contract.reference}</b> {preview.data.contract.name}<div className="small">{preview.data.contract.labour_included ? "Labour included · " : ""}{preview.data.contract.parts_included ? "Parts included · " : ""}{preview.data.contract.out_of_hours_cover ? "Out-of-hours cover" : "No out-of-hours cover"}</div></div> : <div>No active contract — chargeable work</div>}
                </div>
                <div>
                  <div className="muted small">Response target</div>
                  <div><b>{preview.data.target.due ? `By ${fmtDateTime(preview.data.target.due)}` : "None"}</b></div>
                  <div className="assumption">{preview.data.target.source}</div>
                </div>
                {preview.data.warnings.map((w: string) => <div key={w} className="notice">{w}</div>)}
                {site.data?.access_notes && <div><div className="muted small">Site access</div><div className="small">{site.data.access_notes}</div></div>}
                {site.data?.jobs?.filter((j: any) => !["closed", "cancelled", "completed"].includes(j.status)).length > 0 && (
                  <div>
                    <div className="muted small">Already open at this site — check it isn't a duplicate</div>
                    {site.data.jobs.filter((j: any) => !["closed", "cancelled", "completed"].includes(j.status)).map((j: any) => <div key={j.id} className="small"><Link to={`/jobs/${j.id}`}>{j.reference}</Link> {j.title}</div>)}
                  </div>
                )}
              </div>
            </section>
          )}
          {me?.ai.enabled && (
            <EmailToJob
              onExtract={(x, candidates) => {
                setF((cur) => ({
                  ...cur,
                  title: x.title,
                  description: [x.description, x.equipment_hint ? `Equipment mentioned: ${x.equipment_hint}` : "", x.contact_phone ? `Contact phone: ${x.contact_phone}` : ""].filter(Boolean).join("\n\n"),
                  priority: x.suggested_priority,
                  reported_via: "email",
                  reported_by_name: x.contact_name ?? "",
                  customer_order_ref: x.customer_order_ref ?? "",
                }));
                if (candidates.length === 1) setCustomerId(candidates[0].id);
                else setCustomerQuery(x.customer_search);
                setAiNote(`Pre-filled from the email. Suggested priority "${x.suggested_priority}": ${x.priority_reason} Check everything before logging.${x.site_hint ? ` Site mentioned: ${x.site_hint}.` : ""}`);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function EmailToJob({ onExtract }: { onExtract: (x: any, candidates: any[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head"><h2>From an email</h2></div>
      <div className="panel-body stack">
        <p className="small muted" style={{ margin: 0 }}>Paste a customer's email and the assistant fills in the form. Nothing is saved until you log the job.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email here" style={{ minHeight: 120 }} />
        {err && <div className="notice red small">{err}</div>}
        <button disabled={busy || text.trim().length < 20} onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api.post("/ai/email-to-job", { text });
            onExtract(r.extraction, r.customer_candidates);
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : "Could not read the email");
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Reading…" : "Fill in from email"}</button>
      </div>
    </section>
  );
}
