import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "../api";
import { fmtDate, fmtDay, fmtTime, label } from "../format";
import { ErrorBox, Loading, Priority, useAction, useToast, VisitStatus } from "../components/ui";

export function VisitScreen() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useQuery({ queryKey: ["visit", id], queryFn: () => api.get(`/visits/${id}`) });
  const { run, busy } = useAction();
  const [completing, setCompleting] = useState(false);
  if (isLoading) return <Loading />;
  if (error || !v) return <div className="eng-body"><ErrorBox error={error} /><Link to="/">Back to my work</Link></div>;
  const j = v.job;
  const editable = ["scheduled", "travelling", "on_site"].includes(v.status);
  const onSite = v.status === "on_site";
  const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${j.site_address} ${j.postcode ?? ""}`)}`;

  return (
    <>
      <header className="eng-top">
        <Link to="/" className="back">‹ My work</Link>
        <h1>{j.site_name}</h1>
        <div className="sub">{fmtDay(v.scheduled_start)} {fmtTime(v.scheduled_start)}–{fmtTime(v.scheduled_end)} · <span className="ref">{j.reference}</span></div>
      </header>
      <div className="eng-body">
        <div className="row" style={{ marginBottom: 10 }}><VisitStatus status={v.status} /><Priority p={j.priority} /><span className="muted">{label(j.job_type)}</span></div>

        {/* primary action for the current state */}
        {v.status === "scheduled" && (
          <div className="actions-grid">
            <button onClick={() => run(() => api.post(`/visits/${v.id}/travel`), "Travelling — the office can see you're on your way")} disabled={busy}>On my way</button>
            <button className="primary" onClick={() => run(() => api.post(`/visits/${v.id}/arrive`), "Arrival recorded")} disabled={busy}>Arrived on site</button>
          </div>
        )}
        {v.status === "travelling" && <button className="primary bigaction" onClick={() => run(() => api.post(`/visits/${v.id}/arrive`), "Arrival recorded")} disabled={busy}>Arrived on site</button>}
        {onSite && <button className="primary bigaction" onClick={() => setCompleting(true)}>Finish visit</button>}
        {v.status === "scheduled" && <button className="bigaction" style={{ marginTop: 10 }} onClick={() => setCompleting(true)}>Couldn't get access</button>}
        {!editable && (
          <div className="notice green">
            {v.status === "completed" ? `Completed ${fmtTime(v.departed_at)} — ${label(v.outcome)}` : `${label(v.status)}${v.outcome_notes ? `: ${v.outcome_notes}` : ""}`}
            {v.outcome_notes && v.status === "completed" && <div className="small">{v.outcome_notes}</div>}
          </div>
        )}

        <section className="eng-section">
          <h2>The job</h2>
          <div className="inner stack">
            <div><b>{j.title}</b>{j.description && <p className="pre" style={{ margin: "4px 0 0" }}>{j.description}</p>}</div>
            {v.instructions && <div className="notice blue"><b>From the office:</b> {v.instructions}</div>}
            <div className="small">{j.contract_reference ? <>Contract {j.contract_reference}{j.labour_included ? " · labour included" : ""}{j.parts_included ? " · parts included" : " · parts chargeable"}</> : "No contract — chargeable work. Agree anything extra with the office."}</div>
            {v.job_parts?.length > 0 && <div className="small"><b>Parts for this job:</b> {v.job_parts.map((p: any) => `${p.quantity} × ${p.description} (${label(p.status)})`).join("; ")}</div>}
            {v.other_visits.length > 0 && (
              <div className="small">
                <b>Earlier visits on this job</b>
                {v.other_visits.map((o: any) => <div key={o.id}>{fmtDate(o.scheduled_start)} {o.engineer_name}: {o.outcome ? label(o.outcome) : label(o.status)}{o.outcome_notes ? ` — ${o.outcome_notes}` : o.work_notes ? ` — ${o.work_notes}` : ""}</div>)}
              </div>
            )}
          </div>
        </section>

        <section className="eng-section">
          <h2>Site</h2>
          <div className="inner stack">
            <div>{j.customer_name}<div className="muted">{j.site_address} {j.postcode}</div></div>
            <a className="btn" href={mapUrl} target="_blank" rel="noreferrer">Directions</a>
            {j.access_notes && <div className="notice"><b>Access:</b> {j.access_notes}</div>}
            {v.site_contacts.map((c: any, i: number) => (
              <div key={i} className="row spread"><div>{c.name}<div className="small muted">{c.role}</div></div>{c.phone && <a className="btn tel" href={`tel:${c.phone.replace(/\s/g, "")}`}>Call</a>}</div>
            ))}
          </div>
        </section>

        <Equipment v={v} editable={editable} />
        <Notes v={v} editable={editable} />
        <Parts v={v} editable={editable} />
        <Photos v={v} editable={editable} />
        <Recommendations v={v} editable={editable} />

        {v.site_history.length > 0 && (
          <section className="eng-section">
            <h2>Recent work at this site</h2>
            <div className="inner small stack">
              {v.site_history.map((h: any) => <div key={h.reference}><span className="ref">{h.reference}</span> {h.title} <span className="muted">· {label(h.job_type)} · {fmtDate(h.last_visit ?? h.created_at)}</span></div>)}
            </div>
          </section>
        )}
      </div>
      {completing && <CompleteSheet v={v} noAccessOnly={!onSite} onClose={() => setCompleting(false)} />}
    </>
  );
}

function Equipment({ v, editable }: { v: any; editable: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const checks = Object.fromEntries(v.checks.map((c: any) => [c.equipment_id, c]));
  const onJob = v.equipment.filter((e: any) => e.on_job);
  const others = v.equipment.filter((e: any) => !e.on_job);
  const [showAll, setShowAll] = useState(onJob.length === 0);
  const list = showAll ? [...onJob, ...others] : onJob;
  return (
    <section className="eng-section">
      <h2>Equipment <span className="small muted">{Object.keys(checks).length}/{list.length} checked</span></h2>
      {list.map((e: any) => (
        <div key={e.id} style={{ borderBottom: "1px solid var(--rule)" }}>
          <button className="ghost" style={{ width: "100%", justifyContent: "space-between", borderRadius: 0, textAlign: "left", whiteSpace: "normal" }} onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
            <span><b>{e.asset_tag}</b> {e.category_label}<br /><span className="small muted">{e.location} · {e.manufacturer} {e.model}</span></span>
            {checks[e.id] ? <span className={`pill ${checks[e.id].condition === "good" ? "green" : checks[e.id].condition === "failed" ? "red" : checks[e.id].condition === "attention" ? "amber" : ""}`}>{label(checks[e.id].condition)}</span> : <span className="small muted">Not recorded</span>}
          </button>
          {open === e.id && <EquipmentCheck v={v} e={e} check={checks[e.id]} editable={editable} />}
        </div>
      ))}
      {!showAll && others.length > 0 && <div className="inner"><button className="small" onClick={() => setShowAll(true)}>Show {others.length} other unit{others.length > 1 ? "s" : ""} on site</button></div>}
      {list.length === 0 && <div className="inner muted small">No equipment recorded at this site. Tell the office what's there.</div>}
    </section>
  );
}

function EquipmentCheck({ v, e, check, editable }: { v: any; e: any; check?: any; editable: boolean }) {
  const [condition, setCondition] = useState(check?.condition ?? "");
  const [readings, setReadings] = useState(check?.readings ?? "");
  const [notes, setNotes] = useState(check?.notes ?? "");
  const { run, busy } = useAction();
  return (
    <div className="inner stack" style={{ background: "#fafbfc" }}>
      <div className="small muted">{e.serial_number && `S/N ${e.serial_number} · `}{e.refrigerant ? `${e.refrigerant}${e.refrigerant_kg ? ` ${e.refrigerant_kg}kg` : ""}` : ""}{e.warranty_expiry && e.warranty_expiry >= new Date().toISOString().slice(0, 10) ? ` · Under warranty to ${fmtDate(e.warranty_expiry)} — speak to the office before repairing` : ""}</div>
      {e.notes && <div className="small notice">{e.notes}</div>}
      {e.recent.length > 0 && <div className="small"><b>Last time:</b> {e.recent.map((r: any, i: number) => <div key={i}>{fmtDate(r.scheduled_start)} {r.engineer_name}: {label(r.condition)}{r.notes ? ` — ${r.notes}` : ""}</div>)}</div>}
      {editable && (
        <>
          <div className="cond" role="group" aria-label="Condition">
            {["good", "attention", "failed", "not_checked"].map((c) => <button key={c} className={`${condition === c ? "on" : ""} ${c}`} onClick={() => setCondition(c)}>{c === "not_checked" ? "Not checked" : label(c)}</button>)}
          </div>
          <input placeholder="Readings (pressures, temps, currents)" value={readings} onChange={(ev) => setReadings(ev.target.value)} />
          <textarea placeholder="Notes on this unit" value={notes} onChange={(ev) => setNotes(ev.target.value)} style={{ minHeight: 60 }} />
          <button className="primary" disabled={!condition || busy} onClick={() => run(() => api.put(`/visits/${v.id}/checks`, { equipment_id: e.id, condition, readings, notes }), "Saved")}>Save check</button>
        </>
      )}
    </div>
  );
}

function Notes({ v, editable }: { v: any; editable: boolean }) {
  const [text, setText] = useState(v.work_notes ?? "");
  const [saved, setSaved] = useState(v.work_notes ?? "");
  const toast = useToast();
  const qc = useQueryClient();
  async function save() {
    try {
      await api.put(`/visits/${v.id}/notes`, { work_notes: text });
      setSaved(text);
      qc.invalidateQueries({ queryKey: ["visit"] });
    } catch (e) {
      toast({ kind: "error", text: e instanceof ApiError ? e.message : "Couldn't save notes — check your signal and try again" });
    }
  }
  return (
    <section className="eng-section">
      <h2>Work notes {text !== saved && <span className="small" style={{ color: "var(--amber)" }}>Unsaved</span>}</h2>
      <div className="inner stack">
        {editable ? (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== saved && save()} placeholder="What you found and what you did" style={{ minHeight: 120 }} />
            <button onClick={save} disabled={text === saved}>Save notes</button>
          </>
        ) : <p className="pre">{v.work_notes || <span className="muted">No notes.</span>}</p>}
      </div>
    </section>
  );
}

function Parts({ v, editable }: { v: any; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [freeText, setFreeText] = useState("");
  const van = useQuery({ queryKey: ["my-van"], queryFn: () => api.get("/my/van"), enabled: adding });
  const search = useQuery({ queryKey: ["parts", q], queryFn: () => api.get(`/parts${qs({ q })}`), enabled: adding && q.length > 1 });
  const { run, busy } = useAction();
  const vanItems = van.data?.items.filter((i: any) => !q || `${i.name} ${i.sku}`.toLowerCase().includes(q.toLowerCase())) ?? [];
  const add = async (body: any) => {
    const r = await run(() => api.post(`/visits/${v.id}/parts`, body), "Part recorded");
    if (r) { setAdding(false); setQ(""); setQty(1); setFreeText(""); }
  };
  return (
    <section className="eng-section">
      <h2>Parts used</h2>
      <div className="inner stack">
        {v.parts.length === 0 && <span className="muted small">None recorded.</span>}
        {v.parts.map((p: any) => (
          <div key={p.id} className="row spread">
            <div>{p.quantity} × {p.part_name}<div className="small muted">{p.sku ?? "Non-stock item"}</div></div>
            {editable && <button className="small" onClick={() => run(() => api.del(`/visits/${v.id}/parts/${p.id}`), "Removed and returned to van")}>Remove</button>}
          </div>
        ))}
        {editable && !adding && <button onClick={() => setAdding(true)}>Add part used</button>}
        {editable && adding && (
          <div className="stack">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input autoFocus placeholder="Search your van or catalogue" value={q} onChange={(e) => setQ(e.target.value)} />
              <input type="number" min={0.1} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 80 }} aria-label="Quantity" />
            </div>
            <div className="small muted">On your van</div>
            {vanItems.slice(0, 8).map((i: any) => (
              <button key={i.part_id} className="ghost" style={{ justifyContent: "space-between", whiteSpace: "normal", textAlign: "left" }} disabled={busy} onClick={() => add({ part_id: i.part_id, quantity: qty })}>
                <span>{i.name}</span><span className="small muted">{i.quantity} on van</span>
              </button>
            ))}
            {q.length > 1 && search.data?.filter((p: any) => !vanItems.some((i: any) => i.part_id === p.id)).slice(0, 5).map((p: any) => (
              <button key={p.id} className="ghost" style={{ justifyContent: "space-between", whiteSpace: "normal", textAlign: "left" }} disabled={busy} onClick={() => add({ part_id: p.id, quantity: qty })}>
                <span>{p.name}</span><span className="small muted">not on your van record</span>
              </button>
            ))}
            <div className="small muted">Bought locally or not in the catalogue?</div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input placeholder="Describe the item" value={freeText} onChange={(e) => setFreeText(e.target.value)} />
              <button disabled={!freeText.trim() || busy} onClick={() => add({ description: freeText, quantity: qty })}>Add</button>
            </div>
            <button className="ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        )}
      </div>
    </section>
  );
}

function Photos({ v, editable }: { v: any; editable: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const { run, busy } = useAction();
  async function upload(file: File) {
    const fd = new FormData();
    fd.append("photo", file);
    if (caption) fd.append("caption", caption);
    const r = await run(() => api.post(`/visits/${v.id}/photos`, fd), "Photo added");
    if (r) setCaption("");
  }
  return (
    <section className="eng-section">
      <h2>Photos</h2>
      <div className="inner stack">
        {v.photos.length > 0 && <div className="photos">{v.photos.map((p: any) => <a key={p.id} href={`/api/uploads/${p.file_name}`} target="_blank" rel="noreferrer"><img src={`/api/uploads/${p.file_name}`} alt={p.caption ?? "Visit photo"} /></a>)}</div>}
        {editable && (
          <>
            <input placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <input ref={input} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <button disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Take or add photo"}</button>
          </>
        )}
        {!editable && v.photos.length === 0 && <span className="muted small">No photos.</span>}
      </div>
    </section>
  );
}

function Recommendations({ v, editable }: { v: any; editable: boolean }) {
  const [text, setText] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [eq, setEq] = useState("");
  const { run, busy } = useAction();
  return (
    <section className="eng-section">
      <h2>Recommendations</h2>
      <div className="inner stack">
        <p className="small muted" style={{ margin: 0 }}>Spotted something that needs fixing or replacing later? Record it here and the office will follow it up with the customer.</p>
        {v.recommendations.map((r: any) => <div key={r.id} className="small"><span className={`pill ${r.urgency === "safety" ? "red" : r.urgency === "high" ? "amber" : ""}`}>{label(r.urgency)}</span> {r.description}</div>)}
        {editable && (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Condenser coil corroded — recommend replacement within 12 months" style={{ minHeight: 70 }} />
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} aria-label="Urgency"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="safety">Safety</option></select>
              <select value={eq} onChange={(e) => setEq(e.target.value)} aria-label="Equipment"><option value="">Whole site</option>{v.equipment.map((e: any) => <option key={e.id} value={e.id}>{e.asset_tag} {e.location}</option>)}</select>
            </div>
            <button disabled={text.trim().length < 3 || busy} onClick={async () => { if (await run(() => api.post(`/visits/${v.id}/recommendations`, { description: text, urgency, equipment_id: eq ? Number(eq) : null }), "Recommendation sent to the office")) setText(""); }}>Add recommendation</button>
          </>
        )}
      </div>
    </section>
  );
}

const OUTCOMES = [
  { key: "resolved", title: "Fixed / work complete", help: "Nothing more needed on this job." },
  { key: "return_visit", title: "Need to come back", help: "e.g. more time, specialist access, another trade." },
  { key: "parts_required", title: "Parts needed", help: "The office will order them and book a return visit." },
  { key: "quote_required", title: "Needs a quote", help: "Work beyond this job that the customer must approve." },
];

function CompleteSheet({ v, noAccessOnly, onClose }: { v: any; noAccessOnly: boolean; onClose: () => void }) {
  const [outcome, setOutcome] = useState(noAccessOnly ? "no_access" : "");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState("");
  const [parts, setParts] = useState<{ part_id: number | null; description: string; quantity: number }[]>([]);
  const [partQ, setPartQ] = useState("");
  const [signoff, setSignoff] = useState("");
  const [workNotes, setWorkNotes] = useState(v.work_notes ?? "");
  const canvas = useRef<HTMLCanvasElement>(null);
  const [signed, setSigned] = useState(false);
  const search = useQuery({ queryKey: ["parts", partQ], queryFn: () => api.get(`/parts${qs({ q: partQ })}`), enabled: partQ.length > 1 });
  const { run, busy } = useAction();

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    c.width = c.offsetWidth * 2;
    c.height = c.offsetHeight * 2;
    ctx.scale(2, 2);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    let drawing = false;
    const pt = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e: PointerEvent) => { drawing = true; const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drawing) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); setSigned(true); };
    const up = () => { drawing = false; };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); };
  }, [outcome]);

  const needsNotes = outcome && outcome !== "resolved";
  const valid = outcome && (!needsNotes || notes.trim() || (outcome === "parts_required" && parts.length) || (outcome === "quote_required" && quote.trim())) && (outcome !== "parts_required" || parts.length) && (outcome !== "quote_required" || quote.trim() || notes.trim());

  async function submit() {
    const r = await run(
      () => api.post(`/visits/${v.id}/complete`, {
        outcome,
        outcome_notes: notes || null,
        work_notes: outcome === "no_access" ? undefined : workNotes,
        signoff_name: signoff || null,
        signature_data_url: signed && canvas.current ? canvas.current.toDataURL("image/png") : null,
        parts_needed: outcome === "parts_required" ? parts : undefined,
        quote_description: outcome === "quote_required" ? quote || notes : undefined,
      }),
      outcome === "no_access" ? "No access recorded — the office will rebook" : "Visit completed",
    );
    if (r) onClose();
  }

  return (
    <div className="overlay" style={{ padding: 0, alignItems: "stretch" }}>
      <div className="modal" style={{ width: "100%", maxWidth: 640, borderRadius: 0, minHeight: "100%" }}>
        <div className="modal-head"><h2>{noAccessOnly ? "No access" : "Finish visit"}</h2><button className="ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body stack">
          {!noAccessOnly && (
            <>
              <div className="outcomes" role="radiogroup" aria-label="Outcome">
                {OUTCOMES.map((o) => (
                  <label key={o.key} className={outcome === o.key ? "on" : ""}>
                    <input type="radio" name="outcome" checked={outcome === o.key} onChange={() => setOutcome(o.key)} />
                    <span><b>{o.title}</b><br /><span className="small muted">{o.help}</span></span>
                  </label>
                ))}
              </div>
              <label className="field"><span>Work notes</span><textarea value={workNotes} onChange={(e) => setWorkNotes(e.target.value)} style={{ minHeight: 90 }} /></label>
            </>
          )}
          {outcome === "parts_required" && (
            <div className="stack">
              <b>Parts needed</b>
              {parts.map((p, i) => <div key={i} className="row spread"><span>{p.quantity} × {p.description}</span><button className="small" onClick={() => setParts(parts.filter((_, j) => j !== i))}>Remove</button></div>)}
              <input placeholder="Search catalogue or type a description" value={partQ} onChange={(e) => setPartQ(e.target.value)} />
              {search.data?.slice(0, 5).map((p: any) => <button key={p.id} className="ghost" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={() => { setParts([...parts, { part_id: p.id, description: p.name, quantity: 1 }]); setPartQ(""); }}>{p.name} <span className="muted small">{p.sku}</span></button>)}
              {partQ.trim().length > 2 && <button className="small" onClick={() => { setParts([...parts, { part_id: null, description: partQ.trim(), quantity: 1 }]); setPartQ(""); }}>Add "{partQ.trim()}" as a description</button>}
            </div>
          )}
          {outcome === "quote_required" && <label className="field"><span>What needs quoting?</span><textarea value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Describe the work, equipment and any sizes/models" /></label>}
          {outcome && (
            <label className="field"><span>{outcome === "resolved" ? "Anything the office should know? (optional)" : outcome === "no_access" ? "What happened?" : "What happens next?"}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} /></label>
          )}
          {outcome && outcome !== "no_access" && (
            <>
              <label className="field"><span>Customer sign-off name (optional)</span><input value={signoff} onChange={(e) => setSignoff(e.target.value)} /></label>
              <div><div className="small muted" style={{ marginBottom: 4 }}>Signature (optional)</div><canvas ref={canvas} className="sig" aria-label="Signature pad" /></div>
            </>
          )}
          <button className="primary bigaction" disabled={!valid || busy} onClick={submit}>{noAccessOnly ? "Record no access" : "Complete visit"}</button>
        </div>
      </div>
    </div>
  );
}
