import { createContext, ReactNode, useContext, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo } from "../pages/Login";
import { Assistant } from "./Assistant";

const AssistantCtx = createContext<{ open: (prompt?: string) => void; isOpen: boolean }>({ open: () => {}, isOpen: false });
export const useAssistant = () => useContext(AssistantCtx);

export function OfficeLayout({ children }: { children: ReactNode }) {
  const { me, setMe, can } = useAuth();
  const nav = useNavigate();
  const [assistant, setAssistant] = useState<{ open: boolean; prompt?: string; seq: number }>({ open: false, seq: 0 });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/dashboard"), refetchInterval: 60_000, enabled: can("job.read") });
  const c = dash.data?.counts;

  async function logout() {
    await api.post("/auth/logout").catch(() => {});
    setMe(null);
    nav("/");
  }

  const link = (to: string, text: string, count?: number, hot?: boolean) => (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => `nav ${isActive ? "active" : ""}`}>
      <span>{text}</span>
      {count ? <span className={`count ${hot ? "hot" : ""}`}>{count}</span> : null}
    </NavLink>
  );

  return (
    <AssistantCtx.Provider value={{ open: (prompt) => setAssistant((a) => ({ open: true, prompt, seq: a.seq + 1 })), isOpen: assistant.open }}>
      <div className={`shell ${assistant.open ? "with-assistant" : ""}`}>
        <nav className="side" aria-label="Main">
          <div className="brand">
            <Logo />
            <span className="brand-name">Frostline <span>Ops</span></span>
          </div>
          {link("/", "Today", c?.response_risk, true)}
          {can("job.read") && link("/jobs", "Jobs", c?.to_schedule)}
          {can("schedule.read") && link("/schedule", "Schedule")}
          {can("customer.read") && link("/customers", "Customers")}
          {can("contract.read") && link("/contracts", "Contracts")}
          {can("quote.read") && link("/quotes", "Quotes")}
          {can("recommendation.read") && link("/recommendations", "Recommendations", c?.recommendations)}
          {can("stock.read") && link("/stock", "Stock & orders", c?.low_stock)}
          {link("/settings", can("settings.manage") ? "Settings & audit" : "Settings")}
          <div className="side-foot">
            <div className="who">{me?.name}</div>
            <div>{me?.job_title}</div>
            <div className="row" style={{ gap: 14 }}>
              {can("ai.use") && (
                <button className="ghost" onClick={() => setAssistant((a) => ({ ...a, open: !a.open }))}>
                  {assistant.open ? "Hide assistant" : "Assistant"}
                </button>
              )}
              <button className="ghost" onClick={logout}>Sign out</button>
            </div>
          </div>
        </nav>
        <main className="main">{children}</main>
        {assistant.open && <Assistant key="assistant" initialPrompt={assistant.prompt} promptSeq={assistant.seq} onClose={() => setAssistant((a) => ({ ...a, open: false }))} />}
      </div>
    </AssistantCtx.Provider>
  );
}
