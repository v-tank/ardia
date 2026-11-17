import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArdiaApi, type Values } from "./api";
import { connect, signIn, type Connection } from "./connection";
import { modelOptions, type ModelOption, type ProviderInfo } from "./models";
import { applyShell, type ShellThread } from "./shellState";

export type { ShellThread };


export type Session = {
  connection: Connection | null;
  api: ArdiaApi | null;
  connected: boolean | null;
  error: string | null;
  providers: ProviderInfo[] | null;
  models: ModelOption[];
  projectId: string | null;
  threads: ShellThread[];
  shellLoaded: boolean;
  values: Values;
  refreshProviders(): Promise<void>;
  ensureProject(): Promise<string>;
  setValues(values: Values): void;
};

const SessionContext = createContext<Session | null>(null);

export const useSession = () => useContext(SessionContext)!;

const HEARTBEAT_MS = 10_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [api, setApi] = useState<ArdiaApi | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ShellThread[]>([]);
  const [shellLoaded, setShellLoaded] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const live = useRef<Connection | null>(null);
  const shellMap = useRef(new Map<string, ShellThread>());

  const loadProviders = useCallback(async (conn: Connection, refresh: boolean) => {
    if (refresh) await conn.call((c) => c["server.refreshProviders"]({} as never)).catch(() => undefined);
    const config = (await conn.call((c) => c["server.getConfig"]({} as never))) as unknown as { providers: ProviderInfo[] };
    setProviders([...config.providers]);
  }, []);

  useEffect(() => {
    let stopShell: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const bearer = await signIn();
        const conn = await connect(bearer);
        if (cancelled) return conn.close();
        live.current = conn;
        const ardia = new ArdiaApi(bearer);
        setConnection(conn);
        setApi(ardia);
        setConnected(true);
        void ardia.info().then((info) => {
          setValues(info.values);
          setWorkspaceRoot(info.workspaceRoot);
        }).catch(() => undefined);
        await loadProviders(conn, false);
        stopShell = conn.subscribe(
          (c) => c["orchestration.subscribeShell"]({} as never),
          (item: unknown) => {
            const next = applyShell(shellMap.current, item as Record<string, unknown>);
            shellMap.current = next.threads;
            if (next.projectId) setProjectId((current) => current ?? next.projectId);
            setThreads([...next.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt));
            setShellLoaded(true);
          },
          () => setConnected(false),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setConnected(false);
      }
    })();
    const beat = setInterval(() => {
      fetch("/.well-known/t3/environment", { cache: "no-store" }).then(
        (r) => !r.ok && setConnected(false),
        () => setConnected(false),
      );
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(beat);
      stopShell?.();
      live.current?.close();
    };
  }, [loadProviders]);

  const value = useMemo<Session>(
    () => ({
      connection,
      api,
      connected,
      error,
      providers,
      models: providers ? modelOptions(providers) : [],
      projectId,
      threads,
      shellLoaded,
      values,
      refreshProviders: () => (connection ? loadProviders(connection, true) : Promise.resolve()),
      ensureProject: async () => {
        if (projectId) return projectId;
        if (!connection || !workspaceRoot) throw new Error("The assistant is still getting ready. Try again in a moment.");
        const id = "ardia-workspace";
        await connection
          .call((c) => c["projects.mutate"]({ type: "project.create", commandId: crypto.randomUUID(), projectId: id, title: "Ardia", workspaceRoot, createWorkspaceRootIfMissing: true } as never))
          .catch(() => undefined);
        setProjectId(id);
        return id;
      },
      setValues,
    }),
    [connection, api, connected, error, providers, projectId, threads, shellLoaded, values, workspaceRoot, loadProviders],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
