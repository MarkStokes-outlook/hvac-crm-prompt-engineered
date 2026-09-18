import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

export function Login() {
  const { setMe } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<any[]>([]);
  useEffect(() => {
    api.get("/auth/demo-users").then(setDemo).catch(() => {});
  }, []);

  async function signIn(e?: FormEvent, as?: string) {
    e?.preventDefault();
    setError(null);
    try {
      await api.post("/auth/login", { email: as ?? email, password: as ? "frostline" : password });
      setMe(await api.get("/auth/me"));
      if (window.location.pathname !== "/") window.history.replaceState(null, "", "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <Logo />
          <span className="brand-name">Frostline <span>Operations</span></span>
        </div>
        <div>
          <h1>Service, maintenance and installation in one place.</h1>
          <p style={{ marginTop: 14, maxWidth: "46ch" }}>Customers, sites and equipment history; jobs from first call to close; engineer scheduling; quotes; and van and depot stock.</p>
        </div>
        <div className="coverage">Greater Manchester · Lancashire · Merseyside · Cheshire · West Yorkshire</div>
      </div>
      <div className="login-form">
        <h2>Sign in</h2>
        <form onSubmit={signIn} className="stack" style={{ marginTop: 14 }}>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {error && <div className="notice red">{error}</div>}
          <button className="primary" type="submit">Sign in</button>
        </form>
        {demo.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <h3>Demo accounts</h3>
            <p className="muted small">Each role sees different screens and permissions. Password for all: <b>frostline</b>. Engineers get the mobile app.</p>
            <div className="demo-users">
              {demo.map((u) => (
                <button key={u.email} type="button" onClick={() => signIn(undefined, u.email)}>
                  <b>{u.name}</b>
                  <span className="muted small">{u.job_title} · {u.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#1f5f8b" />
      <path d="M16 5v22M6.5 10.5l19 11M6.5 21.5l19-11" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
