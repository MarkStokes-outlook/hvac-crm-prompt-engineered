import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, label } from "../format";
import { askReason, Empty, Loading, useAction } from "../components/ui";

export function Recommendations() {
  const [status, setStatus] = useState("open");
  const nav = useNavigate();
  const { can } = useAuth();
  const { run } = useAction();
  const { data, isLoading } = useQuery({ queryKey: ["recommendations", status], queryFn: () => api.get(`/recommendations?status=${status}`) });
  return (
    <>
      <div className="page-head">
        <div><h1>Engineer recommendations</h1><div className="sub">Remedial and replacement work spotted on site. Quote it or dismiss it with a reason.</div></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }} aria-label="Status"><option value="open">Open</option><option value="quoted">Quoted</option><option value="dismissed">Dismissed</option><option value="all">All</option></select>
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : !data?.length ? <Empty>No recommendations here.</Empty> : (
          <table className="data">
            <thead><tr><th>Urgency</th><th>Recommendation</th><th>Customer / site</th><th>Raised</th><th></th></tr></thead>
            <tbody>
              {data.map((r: any) => (
                <tr key={r.id}>
                  <td><span className={`pill ${r.urgency === "safety" ? "red" : r.urgency === "high" ? "amber" : ""}`}>{label(r.urgency)}</span></td>
                  <td style={{ maxWidth: 460 }}>{r.description}{r.asset_tag && <div className="small muted"><Link to={`/equipment/${r.equipment_id}`}>{r.asset_tag}</Link> {r.manufacturer} {r.model}</div>}{r.dismissed_reason && <div className="small muted">Dismissed: {r.dismissed_reason}</div>}</td>
                  <td><Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link><div className="small"><Link to={`/sites/${r.site_id}`}>{r.site_name}</Link></div></td>
                  <td className="small">{fmtDate(r.created_at)}<div className="muted">{r.raised_by_name}{r.job_reference ? ` · ${r.job_reference}` : ""}</div></td>
                  <td className="right nowrap">
                    {r.status === "open" && can("quote.write") && <button className="small primary" onClick={() => nav(`/quotes/new?recommendation=${r.id}`)}>Prepare quote</button>}{" "}
                    {r.status === "open" && can("recommendation.manage") && <button className="small" onClick={() => { const why = askReason("Why dismiss this recommendation?"); if (why) run(() => api.post(`/recommendations/${r.id}/dismiss`, { reason: why }), "Dismissed"); }}>Dismiss</button>}
                    {r.quote_reference && <Link to={`/quotes/${r.quote_id}`}>{r.quote_reference}</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
