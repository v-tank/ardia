import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ask, TabSummary } from "./api";
import { entriesOf, isWorking, screenOf, type Entry, type ProviderAuth, type Step } from "./chatState";
import { Composer, type ContextTab } from "./Composer";
import { Favicon, indexTabs, TabChip, type TabIndex } from "./Favicon";
import { Markdown } from "./Markdown";
import { pickModel, splitTags, type ModelOption } from "./models";
import { Centered, NotSignedIn, RuntimeStopped } from "./Notices";
import { useSession } from "./session";
import { useChat } from "./useChat";

const siteOf = (origin: string | null) => {
  if (!origin) return null;
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const ASK_LINE: Record<Ask["kind"], (tab: string) => string> = {
  read: (tab) => `Read “${tab}”?`,
  act: (tab) => `Use “${tab}”?`,
  close: (tab) => `Close “${tab}”?`,
  group: (tab) => `Move “${tab}” into this chat's group?`,
  open: () => "Open a new tab?",
};

function PermissionAsk({ ask, onAnswer }: { ask: Ask; onAnswer: (choice: "allow" | "always" | "deny") => void }) {
  const site = siteOf(ask.origin);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    go.current?.focus();
  }, []);
  return (
    <div className="popover" role="alertdialog" aria-label="The assistant asks" data-testid="permission">
      <p className="q">
        {ASK_LINE[ask.kind](ask.tabTitle)}
        <small>{ask.kind === "open" ? `${ask.detail ?? ""} · this chat has read pages, so new addresses need your OK` : [site, ask.detail].filter(Boolean).join(" · ") || "This tab"}</small>
      </p>
      <div className="buttons">
        <button ref={go} className="btn go" onClick={() => onAnswer("allow")} data-testid="allow">
          Allow ↩
        </button>
        {site && (ask.kind === "read" || ask.kind === "act") && (
          <button className="btn" onClick={() => onAnswer("always")} title={`Always for ${site}`} data-testid="always">
            Always
          </button>
        )}
        <button className="btn" onClick={() => onAnswer("deny")} data-testid="deny">
          Don’t
        </button>
      </div>
    </div>
  );
}

function StepLine({ step, tabs }: { step: Step; tabs: TabIndex }) {
  const tab = step.tabId ? tabs.byId.get(step.tabId) : step.url ? tabs.byUrl.get(step.url.split("#")[0]!) : undefined;
  const showFav = !!(tab || step.url);
  return (
    <div className={`step ${step.status}`} data-testid={`step-${step.tool}`}>
      {showFav && <Favicon src={tab?.favicon} url={tab?.url ?? step.url} title={step.label} />}
      <span className="what">{step.status === "done" && tab && step.tool === "ardia_read_tab" ? `Read ${tab.title}` : step.label}</span>
    </div>
  );
}

function EntryView({ entry, latestUser, tabs }: { entry: Entry; latestUser: boolean; tabs: TabIndex }) {
  const cite = useCallback(
    (href: string, label: string, key: string) => (
      <a key={key} href={href} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none" }}>
        <TabChip tab={tabs.byUrl.get(href.split("#")[0]!)} url={href} title={label} />
      </a>
    ),
    [tabs],
  );
  if (entry.kind === "user") {
    const { text, tags } = splitTags(entry.text);
    return (
      <div className={latestUser ? "ask" : "ask earlier"} data-testid="question">
        {text}
        {latestUser && tags.length > 0 && (
          <div className="tags">
            {tags.map((t, i) => (
              <TabChip key={i} title={t} />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === "assistant")
    return (
      <div className="answer" data-testid="answer">
        <Markdown text={entry.text} link={cite} />
      </div>
    );
  if (entry.kind === "steps")
    return (
      <div className="steps">
        {entry.steps.map((s) => (
          <StepLine key={s.id} step={s} tabs={tabs} />
        ))}
      </div>
    );
  if (entry.kind === "error" && entry.failureClass === "usage_limit") return null;
  if (entry.kind === "error")
    return (
      <div className="answer">
        <p className="error">{entry.message}</p>
      </div>
    );
  return <div className="step">{entry.message}</div>;
}

function useTabIndex(chatId: string, refreshKey: unknown) {
  const session = useSession();
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const load = useCallback(async () => {
    if (!session.api) return [];
    const list = (await session.api.tabs(chatId).catch(() => null))?.tabs ?? [];
    setTabs(list);
    return list;
  }, [session.api, chatId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  return { index: useMemo(() => indexTabs(tabs), [tabs]), load };
}

export function ChatView({ chatId, contextTab, initialPrompt }: { chatId: string; contextTab: ContextTab | null; initialPrompt: string | null }) {
  const session = useSession();
  const { chat, asks, send, stop, answer, sendError } = useChat(chatId);
  const [modelSlug, setModelSlug] = useState<string | null>(() => localStorage.getItem("ardia.ai.model"));
  const model = pickModel(session.models, modelSlug ?? (typeof session.values.model === "string" ? session.values.model : null));
  const providerAuth: ProviderAuth | null = session.providers === null ? null : session.models.some((m) => m.signedIn) ? "authenticated" : "unauthenticated";
  const screen = screenOf({ connected: session.connected, providerAuth, chat, asks: asks.length });
  const entries = useMemo(() => entriesOf(chat), [chat]);
  const working = isWorking(chat);
  const { index: tabs, load: loadTabs } = useTabIndex(chatId, `${working}-${entries.length}`);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  const lastUser = entries.map((e) => e.kind).lastIndexOf("user");

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [entries.length, asks.length, entries[entries.length - 1]]);
  useEffect(() => {
    document.title = chat.title || "New chat";
  }, [chat.title]);
  useEffect(() => {
    if (!initialPrompt || autoSent.current || !model || screen !== "empty") return;
    autoSent.current = true;
    void send(initialPrompt, contextTab ? [contextTab] : [], model);
  }, [initialPrompt, model, screen]);

  const chooseModel = (m: ModelOption) => {
    setModelSlug(m.slug);
    localStorage.setItem("ardia.ai.model", m.slug);
  };

  if (screen === "runtime-stopped") return <RuntimeStopped />;
  if (screen === "connecting") return <Centered title="Starting the assistant…" />;
  if (screen === "not-signed-in") return <NotSignedIn />;

  const limitEntry = screen === "limit-reached" ? [...entries].reverse().find((e) => e.kind === "error") : null;
  const hasRunningStep = entries.some((e) => e.kind === "steps" && e.steps.some((s) => s.status === "running"));
  const contextWithUrl = contextTab ? { ...contextTab, url: contextTab.url ?? tabs.byId.get(contextTab.id)?.url } : null;

  return (
    <>
      <div className="scroll">
        {screen === "empty" ? (
          <div data-testid="empty">
            <div className="lead">{contextTab ? "Ask about this page" : "Ask anything, or about your tabs"}</div>
            {sendError && (
              <div className="thread">
                <p className="answer error">{sendError}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="thread" data-testid="thread" data-screen={screen}>
            {entries.map((e, i) => (
              <EntryView key={e.id} entry={e} latestUser={i === lastUser} tabs={tabs} />
            ))}
            {asks.map((a) => (
              <PermissionAsk key={a.id} ask={a} onAnswer={(c) => void answer(a.id, c)} />
            ))}
            {working && asks.length === 0 && !hasRunningStep && (
              <div className="working" data-testid="working">
                Thinking…
              </div>
            )}
            {limitEntry && (
              <div className="popover" data-testid="limit">
                <p className="q">
                  You’ve reached your plan’s limit
                  <small>{limitEntry.kind === "error" ? limitEntry.message : ""}</small>
                </p>
                <div className="buttons">
                  <button className="btn" onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="model"]')?.click()}>
                    Pick another model
                  </button>
                </div>
              </div>
            )}
            {sendError && (
              <div className="answer">
                <p className="error">{sendError}</p>
              </div>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <Composer
        working={working}
        placeholder={contextTab ? "Ask about this page…" : "Ask anything, or about your tabs…"}
        contextTab={contextWithUrl}
        tabs={tabs}
        models={session.models}
        model={model}
        loadTabs={loadTabs}
        onModel={chooseModel}
        onSend={(text, tags) => model && void send(text, tags, model)}
        onStop={() => void stop()}
      />
    </>
  );
}
