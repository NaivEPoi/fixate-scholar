// Any `--url=` harness over the public corpus, from a local copy, N at a time.
//
//   node test/sweep.mjs                                  # allprobes --all, every paper
//   node test/sweep.mjs --set=wide --par=2
//   node test/sweep.mjs --script=test/console.mjs --filter=usenix,acm -- --all
//   node test/sweep.mjs --fetch                          # only fill the cache
//
// Each paper is downloaded once into test/out/corpus/ and served from
// 127.0.0.1 (test/lib/corpus.mjs), each document gets its own browser (the
// harness's), and `--par` of them run side by side. A harness that exits 75
// ("not measured" — no verdict) is run once more; its log is kept either way
// under test/out/sweep/<run>/<id>.log. The last line of a harness's output is
// its own summary, and that is what the table shows: a verdict with no number
// beside it is how a vacuous pass goes unnoticed.
//
// Everything after `--` goes to the harness; with no `--` an allprobes run
// gets `--all`.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { root, outDir } from "./lib/env.mjs";
import { select, ensureCached, serveCorpus } from "./lib/corpus.mjs";

const argv = process.argv.slice(2);
const cut = argv.indexOf("--");
const own = cut < 0 ? argv : argv.slice(0, cut);
const arg = (n, d) => own.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const SCRIPT = arg("script", "test/allprobes.mjs");
const EXTRA = cut < 0 ? (SCRIPT.endsWith("allprobes.mjs") ? ["--all"] : []) : argv.slice(cut + 1);
const PAR = Math.max(1, parseInt(arg("par", "2"), 10));
const RUN = arg("run", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
const TIMEOUT = parseInt(arg("timeout", "40"), 10) * 60000;

const papers = await ensureCached(select({ filter: arg("filter", ""), set: arg("set", "all") }), { log: (l) => console.log(l) });
if (own.includes("--fetch")) { console.log(`${papers.length} paper(s) cached`); process.exit(0); }
if (!papers.length) { console.error("no paper selected"); process.exit(2); }

const srv = await serveCorpus();
const dir = outDir(join("sweep", RUN));
console.log(`${papers.length} paper(s), ${PAR} at a time: ${SCRIPT} ${EXTRA.join(" ")}  -> ${dir}`);

const run1 = (p) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [SCRIPT, `--url=${srv.urlFor(p)}`, `--label=${p.id}`, ...EXTRA], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => { out += `\n${p.id} sweep: no result after ${TIMEOUT / 60000} min — killed\n`; c.kill(); }, TIMEOUT);
  c.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, s: (Date.now() - t0) / 1000 }); });
});

const rows = [];
const queue = [...papers];
const t0 = Date.now();
await Promise.all(Array.from({ length: PAR }, async () => {
  for (let p; (p = queue.shift());) {
    let r = await run1(p);
    let log = r.out;
    if (r.code === 75) {
      const again = await run1(p);
      log += `\n=== retry (first run exited 75) ===\n${again.out}`;
      r = { ...again, s: r.s + again.s };
    }
    writeFileSync(join(dir, `${p.id}.log`), log);
    const last = r.out.trim().split(/\r?\n/).filter((l) => l.trim()).pop() ?? "";
    const verdict = r.code === 0 ? "PASS" : r.code === 75 ? "NOVERDICT" : "FAIL";
    rows.push({ p, verdict, last, s: r.s });
    console.log(`${verdict.padEnd(9)} ${String(Math.round(r.s)).padStart(4)}s  ${last.slice(0, 200)}`);
  }
}));
srv.close();

rows.sort((a, b) => papers.indexOf(a.p) - papers.indexOf(b.p));
const bad = rows.filter((r) => r.verdict !== "PASS");
const summary = [
  ...rows.map((r) => `${r.verdict.padEnd(9)} ${String(Math.round(r.s)).padStart(4)}s  ${r.last}`),
  `=== ${rows.length} documents: ${rows.length - bad.length} PASS, ${bad.length} not — ${((Date.now() - t0) / 60000).toFixed(1)} min, ${rows.reduce((a, r) => a + r.s, 0).toFixed(0)} s of harness time ===`,
];
writeFileSync(join(dir, "summary.txt"), summary.join("\n") + "\n");
console.log(summary.at(-1));
process.exit(bad.length ? 1 : 0);
