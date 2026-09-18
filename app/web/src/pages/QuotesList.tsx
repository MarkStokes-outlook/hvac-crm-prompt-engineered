import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { fmtDate, label, money } from "../format";
import { Empty, Loading, QuoteStatus } from "../components/ui";

export function QuotesList() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const q = params.get("q") ?? "";
  const nav = useNavigate();
  const { can } = useAuth();
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); };
  const { data, isLoading } = useQuery({ queryKey: ["quotes", status, q], queryFn: () => api.get(`/quotes${qs({ status: status === "all" ? "" : status, q })}`) });
  return (
    <>
      <div className="page-head">
        <div><h1>Quotes</h1><div className="sub">Repairs found on visits through to installations and replacements</div></div>
        {can("quote.write") && <Link className="btn primary" to="/quotes/new">New quote</Link>}
      </div>
      <div className="filters">
        <input type="search" value={q} onChange={(e) => set("q", e.target.value)} placeholder="Search reference, title or customer" aria-label="Search quotes" />
        <select value={status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="open">Open (draft & sent)</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="awaiting_conversion">Accepted, not yet work</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option><option value="all">All</option>
        </select>
      </div>
      <div className="panel table-wrap">
        {isLoading ? <Loading /> : !data?.length ? <Empty>No quotes match.</Empty> : (
          <table className="data">
            <thead><tr><th>Quote</th><th>Customer / site</th><th>Type</th><th>Status</th><th className="right">Net</th><th>Valid until</th><th>Prepared by</th></tr></thead>
            <tbody>
              {data.map((x: any) => (
                <tr key={x.id} className="clickable" onClick={() => nav(`/quotes/${x.id}`)}>
                  <td><span className="ref">{x.reference}{x.revision > 1 ? ` rev ${x.revision}` : ""}</span><div>{x.title}</div></td>
                  <td>{x.customer_name}<div className="small muted">{x.site_name}</div></td>
                  <td className="small">{label(x.quote_type)}</td>
                  <td><QuoteStatus status={x.status} expired={x.expired} />{x.status === "accepted" && !x.converted_job_id && <div className="small" style={{ color: "var(--amber)" }}>Not yet work</div>}</td>
                  <td className="right">{money(x.net_total)}</td>
                  <td className="small">{fmtDate(x.valid_until)}</td>
                  <td className="small">{x.prepared_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
