import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../runtime/src/ardiaApi.ts";

const CHAT = "0b9e6c1e-2f4a-4c55-9d7e-1a2b3c4d5e6f";

function tab(id, url, over = {}) {
  return { type: "tab", id, url, title: id, group: null, split: null, ...over };
}

function deps({ split = false, grouped = false } = {}) {
  const chat = tab("chat", `ardia://ai/${CHAT}`, { active: true, split: split ? "s1" : null, group: grouped ? "g1" : null });
  const beside = tab("news", "https://news.example/a", { split: split ? "s1" : null });
  const other = tab("bank", "https://bank.example/home");
  const items = grouped ? [{ type: "group", id: "g1", items: [chat] }, beside, other] : [chat, beside, other];
  const calls = [];
  const counts = [];
  return {
    calls,
    counts,
    deps: {
      host: {
        workspace: async () => ({ windows: [{ id: "w1", spaces: [{ profile: "p", tabs: items }] }] }),
        groupWithChat: async (chatTabId, ids) => (calls.push(["group", chatTabId, ...ids]), { group: "g1" }),
        splitToGroup: async (chatTabId) => (calls.push(["splitToGroup", chatTabId]), { group: "g2" }),
      },
      state: { memory: { tag: () => {}, resume: () => {}, startOnce: () => false } },
      values: () => ({}),
      appVersion: "",
      workspaceRoot: "",
      count: (c) => counts.push(c),
    },
  };
}

const send = (d, tabs) => handleApi("POST", "/ardia/send", new URLSearchParams(), { chat: CHAT, tabs }, d);

test("sending with only the split's own tab keeps the Split View", async () => {
  const w = deps({ split: true });
  const r = await send(w.deps, ["news"]);
  assert.deepEqual(r.body, { group: null });
  assert.deepEqual(w.calls, []);
});

test("tagging a tab outside the split turns the split into a group headed by the chat, then adds the tab", async () => {
  const w = deps({ split: true });
  const r = await send(w.deps, ["news", "bank"]);
  assert.deepEqual(r.body, { group: "g2" });
  assert.deepEqual(w.calls, [["splitToGroup", "chat"], ["group", "chat", "bank"]]);
  assert.deepEqual(w.counts, ["tag_groups_created"]);
});

test("tagging a tab with no split or group makes a group headed by the chat", async () => {
  const w = deps();
  await send(w.deps, ["bank"]);
  assert.deepEqual(w.calls, [["group", "chat", "bank"]]);
  assert.deepEqual(w.counts, ["tag_groups_created"]);
});

test("a later tag joins the chat's group", async () => {
  const w = deps({ grouped: true });
  await send(w.deps, ["bank"]);
  assert.deepEqual(w.calls, [["group", "chat", "bank"]]);
  assert.deepEqual(w.counts, ["tag_groups_joined"]);
});
