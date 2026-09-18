import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, label } from "../format";
import { ErrorBox, JobStatus, Loading } from "../components/ui";
import { AiBrief } from "../components/AiBrief";
import { EquipmentForm } from "./SiteDetail";

export function EquipmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const { data: e, isLoading, error } = useQuery({ queryKey: ["equipment", id], queryFn: () => api.get(`/equipment/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !e) return <ErrorBox error={error} />;
  return (
    <>
      <div className="crumbs"><Link to={`/customers/${e.customer_id}`}>{e.customer_name}</Link> / <Link to={`/sites/${e.site_id}`}>{e.site_name}</Link></div>
      <div className="page-head">
        <div>
          <h1><span className="ref">{e.asset_tag}</span> {e.category_label}</h1>
          <div className="sub">{e.manufacturer} {e.model} · {e.location}</div>
        </div>
        <div className="row">
          {can("job.create") && <button className="primary" onClick={() => nav(`/jobs/new?site=${e.site_id}&equipment=${e.id}`)}>Log a job for this unit</button>}
          {can("customer.write") && <button onClick={() => setEditing(true)}>Edit</button>}
        </div>
      </div>
      <AiBrief kind="equipment" id={e.id} />
      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Service history</h2></div>
            {e.history.length === 0 ? <div className="panel-body muted">No visits have recorded this unit yet.</div> : (
              <ul className="timeline" style={{ padding: "14px 16px" }}>
                {e.history.map((h: any) => (
                  <li key={h.visit_id}>
                    <div className="row"><b>{fmtDate(h.scheduled_start)}</b><Link to={`/jobs/${h.job_id}`} className="ref">{h.job_reference}</Link><span className="small muted">{label(h.job_type)} · {h.engineer_name}</span>{h.condition && <span className={`pill ${h.condition === "good" ? "green" : h.condition === "failed" ? "red" : h.condition === "attention" ? "amber" : ""}`}>{label(h.condition)}</span>}</div>
                    <div className="small">{h.job_title}</div>
                    {h.equipment_notes && <div className="small">{h.equipment_notes}</div>}
                    {h.readings && <div className="small muted">Readings: {h.readings}</div>}
                    {h.work_notes && <div className="small muted pre">{h.work_notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Jobs</h2></div>
            <table className="data"><tbody>
              {e.jobs.map((j: any) => <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}><td className="ref">{j.reference}</td><td>{j.title}</td><td><JobStatus status={j.status} /></td><td className="small">{fmtDate(j.created_at)}</td></tr>)}
            </tbody></table>
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Details</h2></div>
            <div className="panel-body">
              <dl className="facts">
                <dt>Status</dt><dd>{label(e.status)}</dd>
                <dt>Serial</dt><dd>{e.serial_number ?? "—"}</dd>
                <dt>Installed</dt><dd>{fmtDate(e.install_date)}</dd>
                <dt>Warranty</dt><dd>{e.warranty_expiry ? `${e.under_warranty ? "Until" : "Expired"} ${fmtDate(e.warranty_expiry)}` : "—"}</dd>
                <dt>Refrigerant</dt><dd>{e.refrigerant ? `${e.refrigerant}${e.refrigerant_kg != null ? `, ${e.refrigerant_kg} kg` : ""}` : "—"}</dd>
                {e.co2e_tonnes != null && <><dt>CO₂e</dt><dd>{e.co2e_tonnes} t {e.fgas_leak_check_required ? <span className="pill amber">Statutory F-gas leak checks apply (≥5 t)</span> : null}</dd></>}
              </dl>
              {e.notes && <p className="pre" style={{ marginTop: 10 }}>{e.notes}</p>}
              {e.co2e_tonnes != null && <div className="assumption" style={{ marginTop: 8 }}>CO₂e uses standard GWP values. Leak-check frequency depends on charge and detection fitted — confirm against current F-gas regulations.</div>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Parts fitted on jobs for this unit</h2></div>
            <div className="panel-body small">{e.parts.length === 0 ? <span className="muted">None recorded.</span> : e.parts.map((p: any, i: number) => <div key={i}>{fmtDate(p.scheduled_start)} · {p.quantity} × {p.part_name} <span className="muted">({p.job_reference})</span></div>)}</div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recommendations</h2></div>
            <div className="panel-body small stack">{e.recommendations.length === 0 ? <span className="muted">None.</span> : e.recommendations.map((r: any) => <div key={r.id}><span className="pill">{label(r.status)}</span> {r.description}</div>)}</div>
          </section>
          {e.photos.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Photos</h2></div>
              <div className="panel-body row">{e.photos.map((p: any) => <a key={p.id} href={`/api/uploads/${p.file_name}`} target="_blank" rel="noreferrer"><img src={`/api/uploads/${p.file_name}`} alt={p.caption ?? ""} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4 }} /></a>)}</div>
            </section>
          )}
        </div>
      </div>
      {editing && <EquipmentForm siteId={e.site_id} equipment={e} onClose={() => setEditing(false)} />}
    </>
  );
}
