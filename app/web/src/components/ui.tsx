import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { fmtDateTime, label, minutesBetween, localNow, relative } from "../format";

// ---------- status ----------

const JOB_STATUS: Record<string, string> = {
  to_schedule: "amber",
  scheduled: "blue",
  in_progress: "green",
  on_hold: "violet",
  completed: "green",
  closed: "",
  cancelled: "",
};
const JOB_STATUS_TEXT: Record<string, string> = { to_schedule: "To schedule", in_progress: "In progress", on_hold: "On hold" };

export function JobStatus({ status, hold }: { status: string; hold?: string | null }) {
  return (
    <span className={`pill ${JOB_STATUS[status] ?? ""}`} title={hold ? label(hold) : undefined}>
      {JOB_STATUS_TEXT[status] ?? label(status)}
      {status === "on_hold" && hold ? ` · ${label(hold).replace("Awaiting ", "")}` : ""}
    </span>
  );
}

const VISIT_STATUS: Record<string, string> = { scheduled: "blue", travelling: "amber", on_site: "green", completed: "", no_access: "red", cancelled: "" };
export function VisitStatus({ status }: { status: string }) {
  return <span className={`pill ${VISIT_STATUS[status] ?? ""}`}>{status === "on_site" ? "On site" : label(status)}</span>;
}

const QUOTE_STATUS: Record<string, string> = { draft: "", sent: "blue", accepted: "green", rejected: "red", superseded: "", withdrawn: "" };
export function QuoteStatus({ status, expired }: { status: string; expired?: boolean }) {
  if (expired) return <span className="pill amber">Sent · validity expired</span>;
  return <span className={`pill ${QUOTE_STATUS[status] ?? ""}`}>{label(status)}</span>;
}

export function Priority({ p }: { p: string }) {
  return <span className={`prio ${p}`}>{label(p)}</span>;
}

/**
 * The response gauge: how much of the response target has been used, cold → hot.
 * No target means no gauge — we never imply a commitment that doesn't exist.
 */
export function ResponseGauge({ job }: { job: { response_due_at?: string | null; created_at: string; first_attended_at?: string | null; response_state?: string; status?: string } }) {
  if (!job.response_due_at) return <span className="gauge-text muted small">No response target</span>;
  const state = job.response_state ?? "pending";
  if (job.first_attended_at) {
    return (
      <span className={`gauge ${state}`}>
        <span className="gauge-text">{state === "met" ? "Attended within target" : `Attended late (${fmtDateTime(job.first_attended_at)})`}</span>
      </span>
    );
  }
  const total = Math.max(1, minutesBetween(job.created_at, job.response_due_at));
  const used = minutesBetween(job.created_at, localNow());
  const pct = Math.min(100, Math.max(2, (used / total) * 100));
  return (
    <span className={`gauge ${state}`} title={`Response due ${fmtDateTime(job.response_due_at)}`}>
      <span className="gauge-track">
        <span className="gauge-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="gauge-text">{state === "overdue" ? `Overdue by ${relative(job.response_due_at).replace(" ago", "")}` : `Due ${relative(job.response_due_at)}`}</span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ padding: "18px 16px" }}>{children}</div>;
}

export function Loading() {
  return <div className="muted" style={{ padding: 16 }}>Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : String((error as any)?.message ?? error);
  return <div className="notice red">{msg}</div>;
}

// ---------- modal ----------

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- toasts ----------

interface Toast { id: number; text: string; kind: "info" | "error"; list?: string[] }
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.list?.length ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.text}
            {t.list?.length ? <ul>{t.list.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * Run a mutation: shows success/warnings/errors, refreshes cached queries, and turns a
 * server "needs_confirmation" response into an explicit confirm prompt.
 */
export function useAction() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: (acknowledge?: boolean) => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(true);
      try {
        let result: T;
        try {
          result = await fn(false);
        } catch (e) {
          if (e instanceof ApiError && e.code === "needs_confirmation") {
            const issues: { message: string }[] = e.details?.issues ?? [];
            const ok = window.confirm(`Please check before continuing:\n\n${issues.map((i) => `• ${i.message}`).join("\n")}\n\nContinue anyway? This will be recorded.`);
            if (!ok) return undefined;
            result = await fn(true);
          } else throw e;
        }
        await qc.invalidateQueries();
        const warnings: string[] = (result as any)?.warnings ?? [];
        const msg = typeof success === "function" ? success(result) : success;
        if (msg || warnings.length) toast({ text: msg ?? "Done", kind: "info", list: warnings });
        return result;
      } catch (e) {
        toast({ text: e instanceof ApiError ? e.message : String(e), kind: "error" });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [qc, toast],
  );
  return { run, busy };
}

/** Prompt for a required reason (used for cancellations, holds, rejections). */
export function askReason(question: string, initial = ""): string | null {
  const r = window.prompt(question, initial);
  if (r === null) return null;
  if (!r.trim()) {
    window.alert("A reason is required.");
    return null;
  }
  return r.trim();
}

export function Field({ label: l, children, hint, full }: { label: string; children: ReactNode; hint?: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{l}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Timeline({ items }: { items: any[] }) {
  if (!items?.length) return <Empty>No activity yet.</Empty>;
  return (
    <ul className="timeline">
      {items.map((a) => (
        <li key={a.id} className={a.via === "ai" ? "ai" : ""}>
          <div>{a.summary}</div>
          <div className="meta">
            {fmtDateTime(a.at)} · {a.user_name ?? "System"}
            {a.via === "ai" ? " · via assistant" : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
