import { useEffect, useState } from "react";
import { ChatView } from "./ChatView";
import type { ContextTab } from "./Composer";
import { History } from "./History";
import { RuntimeStopped } from "./Notices";
import { SessionProvider, useSession } from "./session";
import { Welcome } from "./Welcome";
import { watchGlass } from "./glass";

export type Route = { kind: "chat"; chatId: string } | { kind: "new" } | { kind: "history" } | { kind: "welcome" };

const CHAT_ID = /^[A-Za-z0-9-]{8,64}$/;

export function routeOf(pathname: string): Route {
  const path = pathname.replace(/^\/+|\/+$/g, "");
  if (path === "history") return { kind: "history" };
  if (path === "welcome") return { kind: "welcome" };
  if (CHAT_ID.test(path) && path !== "history") return { kind: "chat", chatId: path };
  return { kind: "new" };
}

export function contextOf(search: string): ContextTab | null {
  const raw = new URLSearchParams(search).get("ardiaContext");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tabId?: unknown; title?: unknown };
    return typeof parsed.tabId === "string" ? { id: parsed.tabId, title: typeof parsed.title === "string" && parsed.title ? parsed.title : "This tab" } : null;
  } catch {
    return null;
  }
}

function NewChat() {
  const session = useSession();
  const [chatId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (session.api) void session.api.open(`${chatId}${location.search}`).catch(() => undefined);
  }, [session.api]);
  return null;
}

function Screen() {
  const session = useSession();
  const route = routeOf(location.pathname);
  if (session.error && session.connected === false) return <RuntimeStopped />;
  if (route.kind === "history") return <History />;
  if (route.kind === "welcome") return <Welcome />;
  if (route.kind === "new") return <NewChat />;
  const query = new URLSearchParams(location.search);
  return (
    <>
      <ChatView chatId={route.chatId} contextTab={contextOf(location.search)} initialPrompt={query.get("q")} />
    </>
  );
}

export function App() {
  useEffect(() => watchGlass(), []);
  return (
    <SessionProvider>
      <div className="app">
        <Screen />
      </div>
    </SessionProvider>
  );
}
