export type Ask = { id: string; chatId: string; kind: "read" | "act" | "close" | "group" | "open"; tool: string; tabTitle: string; origin: string | null; detail: string | null };
export type Values = Record<string, string | boolean>;
export type ChatEvents = { version: number; asks: Ask[]; stopped: boolean; values: Values };
export type TabSummary = { id: string; title: string; url: string; favicon: string | null; window: string; active: boolean; inChatGroup: boolean; inChatSplit: boolean; tagged: boolean; openedByYou: boolean };
export type ChatTabs = { chatTab: string | null; group: string | null; split: string | null; splitTabs: string[]; tabs: TabSummary[] };

export class ArdiaApi {
  private readonly bearer: string;

  constructor(bearer: string) {
    this.bearer = bearer;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = { method, headers: body === undefined ? { authorization: `Bearer ${this.bearer}` } : { authorization: `Bearer ${this.bearer}`, "content-type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;
    const response = await fetch(path, init);
    const json = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(json.error ?? `The assistant answered ${response.status}.`);
    return json;
  }

  info() {
    return this.request<{ appVersion: string; values: Values; workspaceRoot: string }>("GET", "/ardia/info");
  }

  tabs(chat: string) {
    return this.request<ChatTabs>("GET", `/ardia/tabs?chat=${encodeURIComponent(chat)}`);
  }

  send(chat: string, tabs: string[]) {
    return this.request<{ group: string | null }>("POST", "/ardia/send", { chat, tabs });
  }

  stop(chat: string) {
    return this.request<{ ok: true }>("POST", "/ardia/stop", { chat });
  }

  answer(chat: string, id: string, answer: "allow" | "always" | "deny") {
    return this.request<{ ok: true }>("POST", "/ardia/asks/answer", { chat, id, answer });
  }

  open(path: string, split = false) {
    return this.request<{ tabId: string }>("POST", "/ardia/open", { path, split });
  }

  setValue(key: string, value: string | boolean) {
    return this.request<{ ok: true }>("POST", "/ardia/settings", { key, value });
  }

  login(provider: "claude" | "codex") {
    return this.request<{ started: true }>("POST", "/ardia/login", { provider });
  }

  watch(chat: string, onChange: (events: ChatEvents) => void, onError: (error: unknown) => void): () => void {
    const controller = new AbortController();
    let since = -1;
    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const events = await this.request<ChatEvents>("GET", `/ardia/events?chat=${encodeURIComponent(chat)}&since=${since}`, undefined, controller.signal);
          since = events.version;
          onChange(events);
        } catch (error) {
          if (controller.signal.aborted) return;
          onError(error);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    void loop();
    return () => controller.abort();
  }
}
