import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

/** On-demand AI briefing that condenses a record's history. Optional — the page is complete without it. */
export function AiBrief({ kind, id }: { kind: "customer" | "site" | "equipment"; id: number }) {
  const { me, can } = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!can("ai.use") || !me?.ai.enabled) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {text ? (
        <div className="ai-brief"><div className="small muted" style={{ marginBottom: 4 }}>Assistant briefing — generated from the records below; check before relying on it.</div>{text}</div>
      ) : (
        <button disabled={busy} onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            setText((await api.post("/ai/summarise", { kind, id })).summary);
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : "Could not summarise");
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Summarising…" : `Brief me on this ${kind}`}</button>
      )}
      {err && <div className="notice red small" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
