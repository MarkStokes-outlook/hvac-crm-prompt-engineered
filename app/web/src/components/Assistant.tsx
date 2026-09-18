import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { label } from "../format";

interface Msg { role: "user" | "assistant"; text: string; tools?: string[]; actions?: number[] }

const SUGGESTIONS = [
  "What needs attention right now?",
  "Who can attend the Rossendale House heating emergency today?",
  "Summarise open work for Northgate Property Management",
  "Draft a quote for the Deansgate AHU bearing recommendation",
];

function pageContext(path: string) {
  const m = path.match(/^\/(jobs|customers|sites|equipment|quotes|contracts|purchase-orders)\/(\d+)/);
  if (!m) return null;
  const kind = { jobs: "job", customers: "customer", sites: "site", equipment: "equipment", quotes: "quote", contracts: "contract", "purchase-orders": "purchase order" }[m[1]];
  return `${kind} id ${m[2]}`;
}

function resultLink(a: any) {
  const r = a.result;
  if (!r) return null;
  if (a.tool === "create_job" && r.id) return <Link to={`/jobs/${r.id}`}>Open {r.reference}</Link>;
  if (a.tool === "create_quote_draft" && r.id) return <Link to={`/quotes/${r.id}`}>Open {r.reference}</Link>;
  if ((a.tool === "schedule_visit" || a.tool === "reschedule_visit") && r.job_id) return <Link to={`/jobs/${r.job_id}`}>Open job</Link>;
  if (a.tool === "create_customer" && r.customer_id) return <Link to={`/customers/${r.customer_id}`}>Open customer</Link>;
  if (a.tool === "put_job_on_hold" && r.id) return <Link to={`/jobs/${r.id}`}>Open {r.reference}</Link>;
  return null;
}

export function Assistant({ onClose, initialPrompt, promptSeq }: { onClose: () => void; initialPrompt?: string; promptSeq: number }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const loc = useLocation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [actions, setActions] = useState<Record<number, any>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [promptSeq, initialPrompt]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const enabled = me?.ai?.enabled;

  async function send(e?: FormEvent, text = input) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setError(null);
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.post("/ai/chat", { conversation_id: conversationId, message: text, context: pageContext(loc.pathname) });
      setConversationId(r.conversation_id);
      setActions((a) => ({ ...a, ...Object.fromEntries(r.actions.map((x: any) => [x.id, x])) }));
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, tools: r.tools_used.map((t: any) => t.name), actions: r.actions.map((x: any) => x.id) }]);
      qc.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The assistant could not respond");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: number, verb: "confirm" | "reject") {
    try {
      const r = await api.post(`/ai/actions/${id}/${verb}`);
      setActions((a) => ({ ...a, [id]: r }));
      qc.invalidateQueries();
    } catch (err) {
      setActions((a) => ({ ...a, [id]: { ...a[id], status: "failed", error: err instanceof ApiError ? err.message : String(err) } }));
    }
  }

  function reset() {
    setConversationId(null);
    setMsgs([]);
    setActions({});
    setError(null);
  }

  return (
    <aside className="assistant" aria-label="Assistant">
      <div className="assistant-head">
        <div>
          <h2>Assistant</h2>
          <div className="muted small">Looks things up and prepares actions. You confirm anything that changes data.</div>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
          {msgs.length > 0 && <button className="ghost small" onClick={reset}>New chat</button>}
          <button className="ghost" onClick={onClose} aria-label="Close assistant">✕</button>
        </div>
      </div>
      <div className="assistant-log" ref={logRef}>
        {!enabled && (
          <div className="notice">
            <b>The assistant isn't available.</b>
            <p className="small" style={{ margin: "4px 0 0" }}>{me?.ai?.reason ?? "AI is not configured."} Every screen and workflow works without it.</p>
          </div>
        )}
        {enabled && msgs.length === 0 && (
          <div className="stack">
            <p className="muted small">Ask about customers, jobs, availability or stock, paste a customer email, or ask it to log a job, book a visit or draft a quote.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(undefined, s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="body">{m.text || (m.role === "assistant" && !m.actions?.length ? "(no reply)" : "")}</div>
            {m.tools && m.tools.length > 0 && <div className="tools">Checked: {[...new Set(m.tools)].map((t) => label(t)).join(", ")}</div>}
            {m.actions?.map((id) => {
              const a = actions[id];
              if (!a) return null;
              return (
                <div key={id} className={`action-card ${a.status}`} style={{ marginTop: 8 }}>
                  <div className="kind">Proposed action · {label(a.tool)}</div>
                  <div style={{ margin: "4px 0 6px" }}>{a.summary}</div>
                  {a.preview?.overridden?.length > 0 && (
                    <div className="notice small">Overrides: {a.preview.overridden.map((o: any) => o.message).join("; ")}</div>
                  )}
                  {a.preview?.warnings?.length > 0 && <div className="notice small">{a.preview.warnings.join(" ")}</div>}
                  {a.status === "proposed" ? (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="primary small" onClick={() => decide(id, "confirm")}>Confirm</button>
                      <button className="small" onClick={() => decide(id, "reject")}>Discard</button>
                    </div>
                  ) : (
                    <div className="small" style={{ marginTop: 6 }}>
                      {a.status === "executed" && <span className="pill green">Done</span>}
                      {a.status === "rejected" && <span className="pill">Discarded</span>}
                      {a.status === "failed" && <span className="pill red">Failed: {a.error}</span>} {a.status === "executed" && resultLink(a)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {busy && <div className="thinking">Working</div>}
        {error && <div className="notice red small">{error}</div>}
      </div>
      <form className="assistant-input" onSubmit={send}>
        <textarea
          value={input}
          disabled={!enabled}
          placeholder={enabled ? "e.g. Brindle Stockport says the rear cassette is leaking again — log it and find someone for tomorrow" : "Assistant unavailable"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e as any);
          }}
        />
        <div className="row spread">
          <span className="muted small">Enter to send · Shift+Enter for a new line</span>
          <button className="primary" disabled={!enabled || busy || !input.trim()}>Send</button>
        </div>
      </form>
    </aside>
  );
}
