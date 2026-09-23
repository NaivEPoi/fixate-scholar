// One Chrome DevTools Protocol connection, for every harness.
//
// Every harness used to carry its own five-line `send`, and every copy had the
// same hole: a call settled only when a reply with its id arrived. If the
// browser went away mid-run — a crash, a wedged renderer, the watchdog, memory
// pressure at eight lanes — the reply never came, the promise never settled, and
// Node exited 13, "unsettled top-level await": no error, no page number, no
// stack. The last gate lost seven documents across refcolor, citepoint, fontkeep
// and tables to exactly that, and the sweep reported them as product failures.
//
// So here every call has a DEADLINE, a closed socket REJECTS every call still
// waiting on it, and a socket that errors before it opens rejects `ready`. A
// hang now fails in bounded time with a message naming the method and the
// expression it was waiting on — which is what tells a stuck `chrome.storage`
// call from a stuck page probe. (console.mjs grew this first, after UC-Scheme.)
//
// `socket` lets a unit test pass a fake WebSocket; harnesses leave it out.

const DEFAULT_MS = 30000;

/**
 * @param wsUrl   the target's webSocketDebuggerUrl
 * @param where   label for error messages ("viewer", "service-worker")
 * @param onEvent receives every CDP event (messages without an id)
 * @param timeoutMs default deadline per call; a call may pass its own
 */
export function connect(wsUrl, { where = "cdp", onEvent = () => {}, timeoutMs = DEFAULT_MS, socket } = {}) {
  const ws = socket ?? new WebSocket(wsUrl);
  let nextId = 0;
  let closed = false;
  const pending = new Map();
  let failOpen = () => {};
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${where}: socket did not open within ${timeoutMs}ms`)), timeoutMs);
    failOpen = (why) => { clearTimeout(timer); reject(new Error(`${where}: ${why}`)); };
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (e) => failOpen(`socket error before open${e?.message ? `: ${e.message}` : ""}`);
  });
  ready.catch(() => {}); // a caller that never awaits `ready` must not crash the process
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); return; }
    if (m.method) onEvent(m);
  };
  ws.onclose = () => {
    closed = true;
    // A target that goes away before the socket ever opens (no error event
    // either) must not leave `ready` waiting out the whole deadline. Once
    // opened, `ready` has settled and this is a no-op.
    failOpen("socket closed before open");
    for (const settle of [...pending.values()]) settle({ error: { message: `${where}: socket closed` } });
  };

  const send = (method, params = {}, ms = timeoutMs, what = method) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error(`${where}: ${what}: socket closed`)); return; }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${where}: ${what} timed out after ${ms}ms`));
    }, ms);
    pending.set(id, (m) => {
      clearTimeout(timer);
      pending.delete(id);
      m.error ? reject(new Error(`${where}: ${what}: ${m.error.message}`)) : resolve(m.result);
    });
    try { ws.send(JSON.stringify({ id, method, params })); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });

  /** Evaluate in the page and return the value; a thrown exception rejects. */
  const ev = async (expression, { ms = timeoutMs } = {}) => {
    // The first line of the expression names what was being waited on, so a
    // timeout reads "Runtime.evaluate [chrome.storage.sync.set(...)]" rather
    // than an anonymous 30 s gap.
    const head = expression.trim().split("\n")[0].slice(0, 60);
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ms, `Runtime.evaluate [${head}]`);
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || "").slice(0, 400));
    }
    return r.result?.value;
  };

  const close = () => { try { ws.close(); } catch { /* already closed */ } };
  return { ws, ready, send, ev, close };
}
