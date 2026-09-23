// test/lib/cdp.mjs is what stops a harness hanging forever — Node's exit 13,
// "unsettled top-level await" — when its browser goes away. These pin the
// three ways a call used to wait for ever: no reply at all, a socket that
// closes with calls still waiting, and a socket that never opens.
import { test } from "node:test";
import assert from "node:assert/strict";

import { connect } from "../lib/cdp.mjs";

/** A WebSocket stand-in the test drives by hand. */
function fakeSocket() {
  const sock = {
    sent: [],
    send(data) {
      if (sock.dead) throw new Error("not open");
      sock.sent.push(JSON.parse(data));
    },
    close() { sock.dead = true; sock.onclose?.(); },
    reply(id, body) { sock.onmessage({ data: JSON.stringify({ id, ...body }) }); },
    event(method, params) { sock.onmessage({ data: JSON.stringify({ method, params }) }); },
  };
  return sock;
}

test("a reply settles its own call, by id", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s });
  s.onopen();
  await c.ready;
  const a = c.send("A.one");
  const b = c.send("B.two");
  s.reply(s.sent[1].id, { result: { v: 2 } });
  s.reply(s.sent[0].id, { result: { v: 1 } });
  assert.deepEqual(await a, { v: 1 });
  assert.deepEqual(await b, { v: 2 });
});

test("no reply: the call rejects at its deadline, naming the method", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s, where: "viewer", timeoutMs: 30 });
  s.onopen();
  await assert.rejects(c.send("Page.reload"), /viewer: Page\.reload timed out after 30ms/);
});

test("ev's timeout names the expression it was waiting on", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s, timeoutMs: 30 });
  s.onopen();
  await assert.rejects(
    c.ev("new Promise((r) => chrome.storage.sync.set({ enabled: true }, r))"),
    /Runtime\.evaluate \[new Promise\(\(r\) => chrome\.storage\.sync\.set/,
  );
});

test("a socket that closes rejects every call still waiting", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s, where: "viewer", timeoutMs: 60000 });
  s.onopen();
  const a = c.send("A");
  const b = c.ev("1 + 1");
  s.close();
  await assert.rejects(a, /viewer: A: viewer: socket closed/);
  await assert.rejects(b, /socket closed/);
  // …and a call made after the close fails at once rather than waiting.
  await assert.rejects(c.send("C"), /socket closed/);
});

test("a socket that errors before opening rejects ready", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s, where: "sw" });
  s.onerror({ message: "ECONNREFUSED" });
  await assert.rejects(c.ready, /sw: socket error before open: ECONNREFUSED/);
});

test("a socket that never opens rejects ready at the deadline", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s, timeoutMs: 30 });
  await assert.rejects(c.ready, /did not open within 30ms/);
});

test("ev returns the value, and a page exception rejects with its description", async () => {
  const s = fakeSocket();
  const c = connect("ws://x", { socket: s });
  s.onopen();
  const ok = c.ev("40 + 2");
  s.reply(s.sent[0].id, { result: { result: { value: 42 } } });
  assert.equal(await ok, 42);
  const bad = c.ev("boom()");
  s.reply(s.sent[1].id, { result: { exceptionDetails: { exception: { description: "ReferenceError: boom is not defined" } } } });
  await assert.rejects(bad, /ReferenceError: boom is not defined/);
});

test("a CDP error reply rejects; events go to onEvent, not to a caller", async () => {
  const s = fakeSocket();
  const events = [];
  const c = connect("ws://x", { socket: s, onEvent: (m) => events.push(m.method) });
  s.onopen();
  const call = c.send("Nope.method");
  s.event("Runtime.consoleAPICalled", { type: "warning" });
  s.reply(s.sent[0].id, { error: { message: "'Nope.method' wasn't found" } });
  await assert.rejects(call, /Nope\.method: 'Nope\.method' wasn't found/);
  assert.deepEqual(events, ["Runtime.consoleAPICalled"]);
});
