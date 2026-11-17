import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TabSummary } from "./api";
import { Favicon, type TabIndex } from "./Favicon";
import { Icon } from "./icons";
import type { ModelOption, TagRef } from "./models";

export type ContextTab = { id: string; title: string; url?: string | undefined };

type Props = {
  working: boolean;
  placeholder: string;
  contextTab: ContextTab | null;
  tabs: TabIndex;
  models: ModelOption[];
  model: ModelOption | null;
  loadTabs: () => Promise<TabSummary[]>;
  onModel: (model: ModelOption) => void;
  onSend: (text: string, tags: TagRef[]) => void;
  onStop: () => void;
};

const shortModel = (m: ModelOption) => m.label.replace(/^Claude /, "");

export function Composer(props: Props) {
  const [text, setText] = useState("");
  const [useThisTab, setUseThisTab] = useState(!!props.contextTab);
  const [tags, setTags] = useState<TagRef[]>([]);
  const [menu, setMenu] = useState<"tabs" | "model" | null>(null);
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setUseThisTab(!!props.contextTab);
  }, [props.contextTab?.id]);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);
  useEffect(() => {
    field.current?.focus();
  }, []);

  const context: TagRef[] = [...(useThisTab && props.contextTab ? [props.contextTab] : []), ...tags.filter((t) => t.id !== props.contextTab?.id)];

  const send = () => {
    const value = text.trim();
    if (!value || props.working || !props.model) return;
    props.onSend(value, context);
    setText("");
    setTags([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") setMenu(null);
  };

  const openTabs = async () => {
    setMenu(menu === "tabs" ? null : "tabs");
    setTabs(await props.loadTabs().catch(() => []));
  };

  const fav = (t: TagRef) => {
    const known = props.tabs.byId.get(t.id);
    return <Favicon key={t.id} src={known?.favicon} url={known?.url ?? t.url} title={t.title} />;
  };

  return (
    <div className="bar-wrap">
      <div className="bar">
        <textarea ref={field} rows={1} value={text} placeholder={props.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} data-testid="prompt" />
        <div className="foot">
          {context.length === 1 && (
            <button className="ctx" title={context[0]!.title} onClick={() => (context[0]!.id === props.contextTab?.id ? setUseThisTab(false) : setTags([]))} data-testid="this-tab">
              {fav(context[0]!)}
              <span>{context[0]!.id === props.contextTab?.id ? "This tab" : context[0]!.title}</span>
            </button>
          )}
          {context.length > 1 && (
            <button className="ctx" title={context.map((t) => t.title).join(", ")} onClick={() => void openTabs()} data-testid="context-tabs">
              <span className="stack">{context.slice(0, 3).map(fav)}</span>
              <span>{context.length} tabs</span>
            </button>
          )}
          {context.length === 0 && props.contextTab && (
            <button className="ctx off" onClick={() => setUseThisTab(true)} data-testid="this-tab">
              <span>This tab</span>
            </button>
          )}
          <button className="ctx add" aria-label="Add tabs" title="Add tabs" onClick={() => void openTabs()} data-testid="add-tabs">
            {context.length || props.contextTab ? "＋" : "＋ Add tabs"}
          </button>
          <span className="spacer" />
          <button className="model" onClick={() => setMenu(menu === "model" ? null : "model")} data-testid="model">
            {props.model ? `${shortModel(props.model)} · your plan` : "No model"}
          </button>
          {props.working ? (
            <button className="go stop" onClick={props.onStop} data-testid="stop">
              Stop
            </button>
          ) : (
            <button className="go" disabled={!text.trim() || !props.model} onClick={send} data-testid="send">
              Ask ↩
            </button>
          )}
        </div>
        {menu === "tabs" && (
          <div className="menu" style={{ left: 0 }}>
            <div className="heading">Add tabs to this chat</div>
            {tabs.length === 0 && <div className="heading">No other tabs</div>}
            {tabs.map((t) => {
              const on = tags.some((x) => x.id === t.id) || (useThisTab && props.contextTab?.id === t.id);
              return (
                <button
                  key={t.id}
                  className="item"
                  onClick={() => {
                    if (props.contextTab?.id === t.id) return setUseThisTab(!useThisTab);
                    setTags(on ? tags.filter((x) => x.id !== t.id) : [...tags, { id: t.id, title: t.title || t.url, url: t.url }]);
                  }}
                >
                  <span className="check">{on ? Icon.check : null}</span>
                  <Favicon src={t.favicon} url={t.url} title={t.title} />
                  <span className="label">{t.title || t.url}</span>
                  {t.inChatGroup && <span className="sub">In this chat</span>}
                </button>
              );
            })}
          </div>
        )}
        {menu === "model" && (
          <div className="menu" style={{ right: 0 }}>
            <div className="heading">Runs on your own plan</div>
            {props.models.map((m) => (
              <button
                key={`${m.instanceId}:${m.slug}`}
                className="item"
                onClick={() => {
                  props.onModel(m);
                  setMenu(null);
                }}
              >
                <span className="check">{props.model?.slug === m.slug ? Icon.check : null}</span>
                <span className="label">{m.label}</span>
                <span className="sub">{m.signedIn ? m.plan.replace("your ", "") : "Not signed in"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
