import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { label, money } from "../format";
import { Field, Loading, useAction } from "../components/ui";
import { useAssistant } from "../components/OfficeLayout";

interface Line { line_type: string; description: string; part_id: number | null; equipment_id: number | null; quantity: number; unit_price: number }
const LINE_TYPES = ["labour", "part", "material", "subcontract", "other"];

export function QuoteEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const assistant = useAssistant();
  const existing = useQuery({ queryKey: ["quote", id], queryFn: () => api.get(`/quotes/${id}`), enabled: !!id });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings") });
  const recId = params.get("recommendation");
  const jobId = params.get("job");
  const recs = useQuery({ queryKey: ["recommendations", "all"], queryFn: () => api.get("/recommendations?status=all"), enabled: !!recId });
  const originJob = useQuery({ queryKey: ["job", jobId], queryFn: () => api.get(`/jobs/${jobId}`), enabled: !!jobId });
  const [customerId, setCustomerId] = useState<number | null>(params.get("customer") ? Number(params.get("customer")) : null);
  const [f, setF] = useState({ site_id: "", contact_id: "", quote_type: "repair", title: "", scope: "", valid_until: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [recommendationIds, setRecommendationIds] = useState<number[]>([]);
  const [originJobId, setOriginJobId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { run, busy } = useAction();
  const customers = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get(`/customers${qs({ limit: 200 })}`) });
  const customer = useQuery({ queryKey: ["customer", customerId], queryFn: () => api.get(`/customers/${customerId}`), enabled: !!customerId });
  const site = useQuery({ queryKey: ["site", f.site_id], queryFn: () => api.get(`/sites/${f.site_id}`), enabled: !!f.site_id });
  const labourRate = settings.data?.find((s: any) => s.key === "labour_rate")?.value ?? null;

  // Prefill from an existing draft, a recommendation or a job.
  useEffect(() => {
    if (loaded) return;
    if (id && existing.data) {
      const q = existing.data;
      setCustomerId(q.customer_id);
      setF({ site_id: q.site_id ?? "", contact_id: q.contact_id ?? "", quote_type: q.quote_type, title: q.title, scope: q.scope ?? "", valid_until: q.valid_until ?? "" });
      setLines(q.lines.map((l: any) => ({ line_type: l.line_type, description: l.description, part_id: l.part_id, equipment_id: l.equipment_id, quantity: l.quantity, unit_price: l.unit_price })));
      setLoaded(true);
    } else if (recId && recs.data) {
      const r = recs.data.find((x: any) => String(x.id) === recId);
      if (r) {
        setCustomerId(r.customer_id);
        setF((x) => ({ ...x, site_id: String(r.site_id), title: r.description.split(/[.—-]/)[0].slice(0, 90), scope: r.description, quote_type: "repair" }));
        setRecommendationIds([r.id]);
        if (r.job_id) setOriginJobId(r.job_id);
        if (r.equipment_id) setLines([{ line_type: "labour", description: "Engineer labour", part_id: null, equipment_id: r.equipment_id, quantity: 1, unit_price: labourRate ?? 0 }]);
      }
      setLoaded(true);
    } else if (jobId && originJob.data) {
      const j = originJob.data;
      setCustomerId(j.customer_id);
      setOriginJobId(j.id);
      setF((x) => ({ ...x, site_id: String(j.site_id), title: j.title }));
      setLoaded(true);
    } else if (!id && !recId && !jobId) setLoaded(true);
  }, [existing.data, recs.data, originJob.data, labourRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const net = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    const body = {
      site_id: f.site_id ? Number(f.site_id) : null,
      contact_id: f.contact_id ? Number(f.contact_id) : null,
      quote_type: f.quote_type,
      title: f.title,
      scope: f.scope || null,
      valid_until: f.valid_until || undefined,
      lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
    };
    const r: any = await run(
      () => (id ? api.patch(`/quotes/${id}`, body) : api.post("/quotes", { ...body, customer_id: customerId, origin_job_id: originJobId, recommendation_ids: recommendationIds })),
      id ? "Draft saved" : "Draft quote created",
    );
    if (r) nav(`/quotes/${r.id}`);
  }

  if ((id && existing.isLoading) || !loaded) return <Loading />;

  return (
    <>
      <div className="crumbs"><Link to="/quotes">Quotes</Link> / {id ? `Edit ${existing.data?.reference}` : "New"}</div>
      <div className="page-head">
        <div><h1>{id ? `Edit draft ${existing.data?.reference}${existing.data?.revision > 1 ? ` rev ${existing.data.revision}` : ""}` : "New quote"}</h1><div className="sub">Drafts can be edited freely. Once sent, changes need a revision.</div></div>
        {can("ai.use") && me?.ai.enabled && !id && (
          <button onClick={() => assistant.open(`Draft a quote for ${customer.data?.name ?? "this customer"}${f.site_id ? ` at site id ${f.site_id}` : ""}: ${f.scope || f.title || "(describe the work)"}`)}>Draft with assistant</button>
        )}
      </div>
      <div className="cols">
        <div className="panel">
          <div className="panel-body stack">
            <div className="form-grid">
              <Field label="Customer" full>
                {id ? <input value={existing.data?.customer_name} disabled /> : (
                  <select value={customerId ?? ""} onChange={(e) => { setCustomerId(Number(e.target.value) || null); setF({ ...f, site_id: "", contact_id: "" }); }}>
                    <option value="">Choose…</option>{customers.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Site"><select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">—</option>{customer.data?.sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="For the attention of"><select value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}><option value="">—</option>{customer.data?.contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Type"><select value={f.quote_type} onChange={(e) => setF({ ...f, quote_type: e.target.value })}>{["repair", "installation", "replacement", "other"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
              <Field label="Valid until" hint={!f.valid_until && settings.data ? `Defaults to ${settings.data.find((s: any) => s.key === "quote_validity_days")?.value} days (setting)` : undefined}><input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>
              <Field label="Title" full><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Scope of works" full><textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} style={{ minHeight: 110 }} /></Field>
            </div>
            <h3>Lines</h3>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th style={{ width: 120 }}>Type</th><th>Description</th><th style={{ width: 150 }}>Equipment</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 110 }}>Unit £</th><th className="right" style={{ width: 100 }}>Total</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td><select value={l.line_type} onChange={(e) => upd(i, { line_type: e.target.value })}>{LINE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></td>
                      <td><input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} aria-label="Description" /></td>
                      <td><select value={l.equipment_id ?? ""} onChange={(e) => upd(i, { equipment_id: Number(e.target.value) || null })}><option value="">—</option>{site.data?.equipment.map((e: any) => <option key={e.id} value={e.id}>{e.asset_tag} {e.location}</option>)}</select></td>
                      <td><input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value as any })} aria-label="Quantity" /></td>
                      <td><input type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => upd(i, { unit_price: e.target.value as any })} aria-label="Unit price" /></td>
                      <td className="right">{money((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</td>
                      <td><button className="ghost small" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button className="small" onClick={() => setLines([...lines, { line_type: "labour", description: "Engineer labour", part_id: null, equipment_id: null, quantity: 1, unit_price: labourRate ?? 0 }])}>Add labour</button>
              <PartPicker onPick={(p) => setLines([...lines, { line_type: "part", description: p.name, part_id: p.id, equipment_id: null, quantity: 1, unit_price: p.sell_price ?? 0 }])} />
              <button className="small" onClick={() => setLines([...lines, { line_type: "material", description: "", part_id: null, equipment_id: null, quantity: 1, unit_price: 0 }])}>Add other line</button>
            </div>
            {labourRate != null && <div className="assumption">Labour defaults to £{labourRate}/h from settings — a demo value; confirm FrostLine's real rates.</div>}
            <div className="row spread" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
              <div><b>Net {money(net)}</b> <span className="muted">+ VAT</span></div>
              <div className="row"><Link className="btn" to={id ? `/quotes/${id}` : "/quotes"}>Cancel</Link><button className="primary" disabled={busy || !customerId || !f.title.trim()} onClick={save}>{id ? "Save draft" : "Create draft"}</button></div>
            </div>
          </div>
        </div>
        <div>
          {recommendationIds.length > 0 && <div className="notice blue">Linked to an engineer recommendation — it will be marked as quoted.</div>}
          {originJobId && <div className="notice blue">Raised from job {originJob.data?.reference ?? `#${originJobId}`}. If that job is waiting on this quote, accepting it resumes the job.</div>}
          {site.data?.recommendations?.filter((r: any) => r.status === "open").length > 0 && (
            <section className="panel" style={{ marginTop: 12 }}>
              <div className="panel-head"><h2>Open recommendations at this site</h2></div>
              <div className="panel-body stack small">{site.data.recommendations.filter((r: any) => r.status === "open").map((r: any) => (
                <label key={r.id} className="check" style={{ alignItems: "flex-start" }}><input type="checkbox" disabled={!!id} checked={recommendationIds.includes(r.id)} onChange={(e) => setRecommendationIds(e.target.checked ? [...recommendationIds, r.id] : recommendationIds.filter((x) => x !== r.id))} /> {r.description}</label>
              ))}</div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function PartPicker({ onPick }: { onPick: (p: any) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const parts = useQuery({ queryKey: ["parts", q], queryFn: () => api.get(`/parts${qs({ q })}`), enabled: open });
  return (
    <span style={{ position: "relative" }}>
      <button className="small" onClick={() => setOpen(!open)}>Add catalogue part</button>
      {open && (
        <div className="panel" style={{ position: "absolute", zIndex: 20, top: 34, left: 0, width: 380, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
          <div className="panel-body">
            <input autoFocus placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
              {parts.data?.map((p: any) => (
                <button key={p.id} className="ghost" style={{ display: "flex", width: "100%", justifyContent: "space-between", whiteSpace: "normal", textAlign: "left" }} onClick={() => { onPick(p); setOpen(false); }}>
                  <span className="small">{p.name} <span className="muted">{p.sku}</span></span><span className="small">{money(p.sell_price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
