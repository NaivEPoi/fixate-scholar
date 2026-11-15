// The public test corpus, in ONE place, and a local copy of it.
//
// Every harness used to carry its own PAPERS map and fetch each PDF from its
// host on every run: a sweep of N harnesses over M papers was N x M downloads,
// each a chance for a slow host to turn into a "document never loaded". Here
// the corpus is listed once, downloaded once into test/out/corpus/ (git-ignored)
// and served from 127.0.0.1 under its short id — so a run measures the engine,
// not the network, and a paper's id is what names its logs and captures.
//
// `set` says where a paper came from:
//   core ...... the twelve the release gate has always swept
//   regress ... arXiv papers kept for one past defect each (console.mjs)
//   wide ...... other publishers' layouts, added to find what the first two
//               sets cannot show: CVPR/ICCV, ICML, ICLR, AAAI, LNCS, IEEE
//               Computer Society, Physical Review Letters, JMLR, amsart, a whitepaper.
import { createServer } from "node:http";
import { createReadStream, existsSync, openSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { outDir } from "./env.mjs";

export const PUBLIC = [
  { id: "usenix-base", set: "core", label: "USENIX (baseline)", url: "https://yilud.me/usenixsecurity25-dong-yilu.pdf" },
  { id: "usenix-code", set: "core", label: "USENIX (code + algorithms)", url: "https://yilud.me/usenixsecurity24-tu.pdf" },
  { id: "usenix-nocover", set: "core", label: "USENIX (no cover page)", url: "https://yilud.me/AFC_Attacks_NSDI.pdf" },
  { id: "acm-full", set: "core", label: "ACM acmart (full)", url: "https://yilud.me/Proteus-ccs24.pdf" },
  { id: "acm-short", set: "core", label: "ACM acmart (short)", url: "https://yilud.me/SIB-Auth.pdf" },
  { id: "ieee-conf", set: "core", label: "IEEE conference (stamped)", url: "https://yilud.me/a33-dong%20stamped.pdf" },
  { id: "ieee-journal", set: "core", label: "IEEE journal", url: "https://arxiv.org/pdf/2502.04915" },
  { id: "neurips", set: "core", label: "NeurIPS", url: "https://arxiv.org/pdf/1706.03762" },
  { id: "article-cm", set: "core", label: "LaTeX article (CM)", url: "https://arxiv.org/pdf/quant-ph/9508027" },
  { id: "5gcverif", set: "core", label: "5GCVerif", url: "https://yilud.me/5GCVerif-ccs23.pdf" },
  { id: "5gshield", set: "core", label: "5GShield", url: "https://yilud.me/5GShield.pdf" },
  { id: "afc-diss", set: "core", label: "AFC-Diss", url: "https://yilud.me/afc_testing_DISS.pdf" },
  { id: "acl", set: "core", label: "ACL", url: "https://yilud.me/2026.acl-long.2136.pdf" },
  { id: "uc-scheme", set: "core", label: "UC-Scheme", url: "https://yilud.me/UC_Scheme.pdf" },

  { id: "reg-2510.27394", set: "regress", label: "Regression 2510.27394", url: "https://arxiv.org/pdf/2510.27394" },
  { id: "reg-2603.06158", set: "regress", label: "Regression 2603.06158", url: "https://arxiv.org/pdf/2603.06158" },
  { id: "reg-2511.09227", set: "regress", label: "Regression 2511.09227", url: "https://arxiv.org/pdf/2511.09227" },
  { id: "reg-2511.00919", set: "regress", label: "Regression 2511.00919", url: "https://arxiv.org/pdf/2511.00919" },

  { id: "cvpr", set: "wide", label: "CVPR two-column", url: "https://arxiv.org/pdf/1512.03385" },
  { id: "icml15", set: "wide", label: "ICML 2015 two-column", url: "https://arxiv.org/pdf/1502.03167" },
  { id: "icml19", set: "wide", label: "ICML 2019 two-column", url: "https://arxiv.org/pdf/1905.11946" },
  { id: "iclr15", set: "wide", label: "ICLR single column", url: "https://arxiv.org/pdf/1412.6980" },
  { id: "iclr14", set: "wide", label: "ICLR single column (math-dense)", url: "https://arxiv.org/pdf/1312.6114" },
  { id: "lncs", set: "wide", label: "Springer LNCS", url: "https://arxiv.org/pdf/1505.04597" },
  { id: "aaai", set: "wide", label: "AAAI two-column", url: "https://arxiv.org/pdf/1509.06461" },
  { id: "ieee-cs", set: "wide", label: "IEEE Computer Society conference", url: "https://arxiv.org/pdf/1801.01203" },
  { id: "prl", set: "wide", label: "Physical Review Letters (APS)", url: "https://arxiv.org/pdf/1602.03837" },
  { id: "naacl", set: "wide", label: "NAACL two-column", url: "https://arxiv.org/pdf/1810.04805" },
  { id: "neurips20", set: "wide", label: "NeurIPS 2020 (long appendix)", url: "https://arxiv.org/pdf/2006.11239" },
  { id: "tpami", set: "wide", label: "IEEE Computer Society journal", url: "https://arxiv.org/pdf/1206.5538" },
  { id: "whitepaper", set: "wide", label: "Two-column whitepaper", url: "https://arxiv.org/pdf/1603.04467" },
  { id: "jmlr", set: "wide", label: "JMLR single column", url: "https://arxiv.org/pdf/1502.05767" },
  { id: "amsart", set: "wide", label: "Mathematics article", url: "https://arxiv.org/pdf/math/0211159" },
  { id: "iccv", set: "wide", label: "ICCV two-column", url: "https://arxiv.org/pdf/1708.02002" },
];

/** The papers a `--filter` / `--set` pair selects (label or id substring; set name or "all"). */
export function select({ filter = "", set = "all" } = {}) {
  const sets = set.split(",");
  return PUBLIC.filter((p) => (set === "all" || sets.includes(p.set)) &&
    (!filter || filter.split(",").some((f) => p.id.includes(f) || p.label.includes(f))));
}

const cacheDir = () => outDir("corpus");
export const cachePath = (p) => join(cacheDir(), `${p.id}.pdf`);

function isPdf(path) {
  try {
    if (statSync(path).size < 1024) return false;
    const fd = openSync(path, "r");
    const b = Buffer.alloc(5);
    readSync(fd, b, 0, 5, 0);
    closeSync(fd);
    return b.toString("latin1") === "%PDF-";
  } catch { return false; }
}

/**
 * Download what is missing. Sequential and paced: a preprint server asks
 * automated clients for one request every few seconds, and a refusal is
 * reported, not retried in a loop. Returns the papers that are now on disk.
 */
export async function ensureCached(papers, { log = () => {}, gapMs = 3500 } = {}) {
  const have = [];
  let fetched = 0;
  for (const p of papers) {
    const path = cachePath(p);
    if (existsSync(path) && isPdf(path)) { have.push(p); continue; }
    if (fetched++) await new Promise((r) => setTimeout(r, gapMs));
    try {
      const res = await fetch(p.url, { headers: { "User-Agent": "pdf-test-corpus-fetch/1.0" }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
      writeFileSync(path, buf);
      log(`fetched ${p.id} (${(buf.length / 1024).toFixed(0)} KB)`);
      have.push(p);
    } catch (e) {
      log(`MISSING ${p.id}: ${e.message || e} — ${p.url}`);
    }
  }
  return have;
}

/**
 * Serve the cached corpus on 127.0.0.1 under `<id>.pdf`. Byte ranges are
 * answered, so PDF.js loads a document here the way it does from a real host.
 */
export async function serveCorpus() {
  const byId = new Map(PUBLIC.map((p) => [p.id, p]));
  const server = createServer((req, res) => {
    const id = decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, "").replace(/\.pdf$/i, ""));
    const p = byId.get(id);
    const path = p && cachePath(p);
    if (!path || !existsSync(path)) { res.writeHead(404).end("no"); return; }
    const size = statSync(path).size;
    const head = { "Content-Type": "application/pdf", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(size - 1, parseInt(m[2], 10)) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") { res.end(); return; }
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, "Content-Length": size });
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(path).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { port, urlFor: (p) => `http://127.0.0.1:${port}/${p.id}.pdf`, close: () => server.close() };
}
