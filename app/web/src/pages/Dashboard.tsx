import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { fmtDate, fmtDateTime, fmtTime, label } from "../format";
import { Empty, JobStatus, Loading, Priority, ResponseGauge, VisitStatus } from "../components/ui";
import { useAssistant } from "../components/OfficeLayout";

export function Dashboard() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const assistant = useAssistant();
  const { data: d, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/dashboard"), refetchInterval: 60_000 });
  if (isLoading || !d) return <Loading />;
  const c = d.counts;
  const hour = new Date().getHours();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, {me?.name.split(" ")[0]}</h1>
          <div className="sub">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <div className="row">
          {can("ai.use") && me?.ai.enabled && <button onClick={() => assistant.open("What needs attention right now?")}>Ask the assistant</button>}
          {can("job.create") && <Link className="btn primary" to="/jobs/new">Log a job</Link>}
        </div>
      </div>

      <div className="statbar">
        <Link to="/jobs?response=at_risk" className={`bigstat ${c.response_risk ? "hot" : ""}`}><span className="n">{c.response_risk}</span><span className="l">Response targets at risk or overdue</span></Link>
        <Link to="/jobs?status=to_schedule" className={`bigstat ${c.to_schedule ? "warm" : ""}`}><span className="n">{c.to_schedule}</span><span className="l">Jobs to schedule</span></Link>
        <Link to="/schedule" className="bigstat"><span className="n">{c.today_visits}</span><span className="l">Visits today</span></Link>
        <Link to="/jobs?status=on_hold" className="bigstat"><span className="n">{c.on_hold}</span><span className="l">Jobs on hold</span></Link>
        <Link to="/jobs?status=completed" className="bigstat"><span className="n">{c.completed_to_review}</span><span className="l">Completed, awaiting close</span></Link>
      </div>

      <div className="cols">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Response targets at risk</h2><span className="muted small">Contractual targets only</span></div>
            {d.response_risk.length === 0 ? <Empty>No jobs are close to missing a response target.</Empty> : (
              <table className="data">
                <tbody>
                  {d.response_risk.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span><div className="small"><Priority p={j.priority} /></div></td>
                      <td><div>{j.title}</div><div className="muted small">{j.customer_name} — {j.site_name}</div></td>
                      <td><JobStatus status={j.status} hold={j.hold_reason} /><div className="small muted">{j.engineers ?? "Unassigned"}</div></td>
                      <td style={{ width: 150 }}><ResponseGauge job={j} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Waiting to be scheduled</h2><Link to="/schedule">Open schedule</Link></div>
            {d.to_schedule.length === 0 ? <Empty>Nothing waiting — every open job has a visit booked or is on hold.</Empty> : (
              <table className="data">
                <tbody>
                  {d.to_schedule.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span></td>
                      <td><div>{j.title}</div><div className="muted small">{j.site_name}{j.next_action ? ` · ${j.next_action}` : ""}</div></td>
                      <td className="nowrap"><Priority p={j.priority} /><div className="small muted">{j.due_date ? `Target ${fmtDate(j.due_date)}` : label(j.job_type)}</div></td>
                      <td style={{ width: 150 }}>{j.response_due_at ? <ResponseGauge job={j} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>On hold</h2></div>
            {d.on_hold.length === 0 ? <Empty>No jobs on hold.</Empty> : (
              <table className="data">
                <tbody>
                  {d.on_hold.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span></td>
                      <td><div>{j.title}</div><div className="muted small">{j.customer_name}</div></td>
                      <td><JobStatus status={j.status} hold={j.hold_reason} /><div className="small muted">{j.next_action}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head"><h2>Today's visits</h2><Link to="/schedule">Board</Link></div>
            {d.today_visits.length === 0 ? <Empty>No visits booked today.</Empty> : (
              <table className="data">
                <tbody>
                  {d.today_visits.map((v: any) => (
                    <tr key={v.id} className="clickable" onClick={() => nav(`/jobs/${v.job_id}`)}>
                      <td className="nowrap">{fmtTime(v.scheduled_start)}</td>
                      <td><div className="small"><b>{v.engineer_name}</b></div><div className="small muted">{v.job_reference} · {v.site_name}</div></td>
                      <td><VisitStatus status={v.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {(d.absent_today.length > 0 || d.visit_clashes?.length > 0) && (
            <section className="panel">
              <div className="panel-head"><h2>Availability</h2></div>
              <div className="panel-body stack small">
                {d.absent_today.map((a: any) => <div key={a.id}><b>{a.name}</b> — {label(a.kind)} until {fmtDateTime(a.end_at)}</div>)}
                {d.visit_clashes?.map((v: any) => (
                  <div key={v.id} className="notice red">
                    <Link to={`/jobs/${v.job_id}`}>{v.job_reference}</Link>: {v.engineer_name} is booked {fmtDateTime(v.scheduled_start)} but is marked as {v.kind}. Rebook this visit.
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2>Follow-ups</h2></div>
            <div className="panel-body">
              <dl className="facts">
                {d.quotes && <><dt>Quotes awaiting customer</dt><dd><Link to="/quotes?status=sent">{d.quotes.awaiting_customer}</Link>{d.quotes.expired ? <span className="pill amber" style={{ marginLeft: 6 }}>{d.quotes.expired} past validity</span> : null}</dd></>}
                {d.quotes && <><dt>Accepted, not yet work</dt><dd><Link to="/quotes?status=awaiting_conversion">{d.quotes.awaiting_conversion}</Link></dd></>}
                {d.quotes && <><dt>Draft quotes</dt><dd><Link to="/quotes?status=draft">{d.quotes.drafts}</Link></dd></>}
                <dt>Open recommendations</dt><dd><Link to="/recommendations">{c.recommendations}</Link></dd>
                <dt>Job parts not yet ordered</dt><dd>{c.parts_needed}</dd>
                <dt>Stock below minimum</dt><dd><Link to="/stock?tab=reorder">{c.low_stock}</Link>{c.negative_stock ? <span className="pill red" style={{ marginLeft: 6 }}>{c.negative_stock} negative</span> : null}</dd>
              </dl>
            </div>
          </section>

          {d.planned_due.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Planned maintenance due (14 days)</h2></div>
              <table className="data">
                <tbody>
                  {d.planned_due.map((j: any) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="ref">{j.reference}</span><div className="small muted">{j.site_name}</div></td>
                      <td className="nowrap">{fmtDate(j.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {d.contracts_expiring.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Contracts ending soon</h2></div>
              <table className="data">
                <tbody>
                  {d.contracts_expiring.map((k: any) => (
                    <tr key={k.id} className="clickable" onClick={() => nav(`/contracts/${k.id}`)}>
                      <td><span className="ref">{k.reference}</span><div className="small muted">{k.customer_name}</div></td>
                      <td className="nowrap">{fmtDate(k.end_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
