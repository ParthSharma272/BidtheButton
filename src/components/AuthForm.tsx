"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client.ts";

export function AuthForm({ onDone, demoMode, intro }: { onDone: () => void; demoMode: boolean; intro?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/signup", { json: mode === "login" ? { email, password } : { email, password, displayName } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      {intro && <p className="muted">{intro}</p>}
      <div className="seg" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => setMode("signup")}>
          Create account
        </button>
      </div>
      {mode === "signup" && (
        <label className="field">
          <span>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" required minLength={2} maxLength={40} />
          <small>Shown publicly as the owner when you hold the button.</small>
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      {demoMode && (
        <div className="demo-creds">
          <strong>Demo accounts</strong> (password <code>demo1234</code>)
          <ul>
            <li>
              <button type="button" className="linkish" onClick={() => { setMode("login"); setEmail("you@demo.test"); setPassword("demo1234"); }}>
                you@demo.test
              </button>{" "}
              — a buyer with an approved campaign ready
            </li>
            <li>
              <button type="button" className="linkish" onClick={() => { setMode("login"); setEmail("admin@demo.test"); setPassword("demo1234"); }}>
                admin@demo.test
              </button>{" "}
              — moderator
            </li>
          </ul>
        </div>
      )}
    </form>
  );
}
