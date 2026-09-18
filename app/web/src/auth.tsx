import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface Me {
  id: number;
  name: string;
  email: string;
  role: "manager" | "coordinator" | "sales" | "engineer";
  job_title: string;
  permissions: string[];
  ai: { enabled: boolean; reason?: string; model?: string };
}

const Ctx = createContext<{ me: Me | null; setMe: (m: Me | null) => void; can: (p: string) => boolean }>({ me: null, setMe: () => {}, can: () => false });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe).catch(() => setMe(null));
    const onUnauth = () => setMe(null);
    window.addEventListener("fl:unauthenticated", onUnauth);
    return () => window.removeEventListener("fl:unauthenticated", onUnauth);
  }, []);
  if (me === undefined) return null;
  return <Ctx.Provider value={{ me, setMe, can: (p) => !!me?.permissions.includes(p) }}>{children}</Ctx.Provider>;
}
