import { useState, type ReactNode } from "react";
import { useSession } from "./session";

export function Centered({ title, detail, children, testId }: { title: string; detail?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="center" data-testid={testId}>
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
      {children && <div className="buttons">{children}</div>}
    </div>
  );
}

export function RuntimeStopped() {
  return (
    <Centered testId="runtime-stopped" title="The assistant stopped" detail="Its runtime isn't answering. Ardia restarts it on its own; reload once it's back.">
      <button className="btn go" onClick={() => location.reload()}>
        Reload ↩
      </button>
    </Centered>
  );
}

export function SignInRows() {
  const session = useSession();
  const [started, setStarted] = useState<string | null>(null);
  const rows = [
    { driver: "claudeAgent", provider: "claude" as const, title: "Claude", plan: "Pro or Max plan" },
  ];
  return (
    <div className="rows">
      {rows.map((row) => {
        const p = session.providers?.find((x) => x.driver === row.driver);
        const signedIn = !!p && p.installed && p.auth?.status !== "unauthenticated";
        return (
          <div key={row.driver} className="connect" data-testid={`connect-${row.provider}`}>
            <div className="label">
              <div>{row.title}</div>
              <div className="detail">{!p || !p.installed ? `Install ${row.provider === "claude" ? "Claude Code" : "Codex"} first` : row.plan}</div>
            </div>
            {signedIn ? (
              <span className="ok">Connected</span>
            ) : (
              <button
                className="btn go"
                disabled={!p?.installed}
                onClick={() => {
                  setStarted(row.provider);
                  void session.api?.login(row.provider);
                }}
              >
                {started === row.provider ? "Opened in Terminal" : "Sign in"}
              </button>
            )}
          </div>
        );
      })}
      {started && (
        <button className="btn" onClick={() => void session.refreshProviders()}>
          I've signed in
        </button>
      )}
    </div>
  );
}

export function NotSignedIn() {
  return (
    <div className="center" data-testid="not-signed-in">
      <h1>Connect your plan</h1>
      <p>The assistant runs on your own Claude or ChatGPT subscription. Ardia never sees your password.</p>
      <SignInRows />
    </div>
  );
}
