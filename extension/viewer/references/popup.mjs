// Citation popup. Two modes:
//  - hover: quick local preview of the reference entry text (auto-hides)
//  - click: pinned card — title linking to the paper, byline, abstract
//    snippet, cited-by, WHICH SOURCE answered, and actions ([PDF], Cite →
//    BibTeX, Google Scholar, DOI), with a pager when one in-text citation
//    resolves to several entries. Clicking a citation never scrolls the PDF to
//    the bibliography. Dismissed by ✕, Escape, or clicking outside.
//
// The source line is not decoration: the card's contents come from arXiv,
// Crossref, OpenAlex or OpenAIRE (sources.mjs), the four know different
// things, and a reader judging whether to trust a card should be able to see
// which one it came from.
//
// A card renders as soon as the record verifies, and fills in afterwards: the
// abstract, the citation count and an open-access copy are one further request
// (`fetchDetails`), and the reader should not wait for them to see the paper.

import { bibAuthors } from "./parser.mjs";
import { referenceQuery } from "./matching.mjs";
import { fetchBibtex, fetchDetails, lookupReference, scholarSearchUrl } from "./sources.mjs";

/** A URL as a PDF prints it, line wrap and all. A wrapped link reaches the
 *  text layer with a space in it ("https://github. com/x/y") — the space is
 *  the page's, not the address's, so the LINK drops it while the text keeps
 *  showing what the document shows. Trailing sentence punctuation is not part
 *  of the address either. */
const ENTRY_URL = /\b(?:https?:\/\/|www\.)[^\s]*(?:\s(?=[^\s]*[/.][^\s]))?[^\s]*/gi;

/**
 * `text` split into plain runs and link runs: `[{text}, {text, href}, …]`.
 *
 * Exported for its unit test — the interesting cases (a wrapped URL, a URL
 * ending a sentence, a bare `www.`) are all string handling, and none of them
 * need a DOM to check.
 */
export function linkParts(text) {
  const parts = [];
  let at = 0;
  for (const m of String(text).matchAll(ENTRY_URL)) {
    const shown = m[0].replace(/[.,;)\]]+$/, "");
    if (!shown) continue;
    const href = shown.replace(/\s+/g, "");
    if (!/[a-z0-9]\.[a-z]{2}/i.test(href)) continue; // not a hostname after all
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: shown, href: /^www\./i.test(href) ? `https://${href}` : href });
    at = m.index + shown.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** A BibTeX entry built from the locally parsed reference — the fallback when
 *  there is no DOI to fetch the registered BibTeX for, which is the normal case
 *  for a reference no source had a record of. It has to stand on its own, so it
 *  carries the authors, title, year and DOI as parsed, with the entry verbatim
 *  in `note` so nothing is lost. */
function entryBibtex(entry, preview) {
  const surname = (entry.surname || "ref").replace(/[^A-Za-z]/g, "") || "ref";
  const key = (surname + (entry.year || "")).toLowerCase();
  const clean = (s) => String(s).replace(/[{}]/g, "").trim();
  const out = [`@misc{${key},`];
  const authors = bibAuthors(entry.authors);
  if (authors) out.push(`  author = {${clean(authors)}},`);
  const title = clean(entry.title || preview?.title || "");
  if (title) out.push(`  title = {${title}},`);
  if (entry.year) out.push(`  year = {${entry.year}},`);
  if (entry.doi) out.push(`  doi = {${clean(entry.doi)}},`);
  out.push(`  note = {${clean(entry.raw).slice(0, 300)}}`);
  out.push(`}`);
  return out.join("\n");
}

const SHOW_DELAY = 120;
const HIDE_DELAY = 250;

export class CitationPopup {
  #app;
  #el = null;
  #timer = null;
  #pinned = false;
  #entries = [];
  #index = 0;
  #anchor = null;

  constructor(app) {
    this.#app = app;
  }

  #ensure() {
    if (this.#el) return this.#el;
    const el = document.createElement("div");
    el.className = "fx-cite-popup";
    el.hidden = true;
    el.addEventListener("mouseenter", () => clearTimeout(this.#timer));
    el.addEventListener("mouseleave", () => {
      if (!this.#pinned) this.scheduleHide();
    });
    document.getElementById("viewerContainer").append(el);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.#pinned && !el.contains(e.target) && e.target !== this.#anchor) {
        this.hide();
      }
    });
    this.#el = el;
    return el;
  }

  scheduleShow(entries, anchor) {
    if (this.#pinned) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.showNow(entries, anchor), SHOW_DELAY);
  }

  scheduleHide() {
    if (this.#pinned) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.hide(), HIDE_DELAY);
  }

  hide() {
    if (this.#el) this.#el.hidden = true;
    this.#pinned = false;
  }

  showNow(entries, anchor, { pinned = false } = {}) {
    clearTimeout(this.#timer);
    this.#pinned = pinned;
    this.#entries = entries;
    this.#index = 0;
    this.#anchor = anchor;
    this.#render();
  }

  #render() {
    const el = this.#ensure();
    const entry = this.#entries[this.#index];
    el.replaceChildren();

    if (this.#pinned && this.#entries.length >= 1) {
      el.append(this.#header());
    }

    const body = document.createElement("div");
    body.className = "fx-cite-body";
    el.append(body, this.#actions(entry));

    if (entry.unresolved) {
      // The extractor couldn't parse this entry from the bibliography, so there
      // is nothing to look up — show an honest note. The card still exists (and
      // its hit-target neutralises the PDF link) so a click never scrolls to
      // the reference list.
      body.append(this.#unresolvedNode(entry));
    } else if (this.#pinned) {
      body.append(this.#loadingNode());
      const shownIndex = this.#index;
      lookupReference(entry).then((preview) => {
        if (this.#el.hidden || this.#index !== shownIndex || !body.isConnected) return;
        // Three outcomes, and the label has to tell them apart. A verified
        // match becomes a card. Otherwise the document's own entry is the
        // truthful thing to show — but "no source had a record that is this
        // reference" and "we could not reach them" are different statements,
        // and showing the first when the second happened is what makes the
        // feature look broken to someone who can see the paper themselves.
        const card = preview && !preview.unavailable ? this.#recordCard(preview) : null;
        body.replaceChildren(
          ...(card
            ? [card]
            : [
                this.#sourceNote(
                  preview?.unavailable
                    ? "Couldn't reach the reference sources — showing this document's entry"
                    : "From this document's bibliography",
                ),
                this.#rawEntry(entry),
              ]),
        );
        this.#position();
        // What the record arrived without — its abstract, its citation count,
        // an open-access copy. One more request, so it lands AFTER the card:
        // the reader has the paper, its authors and its links already, and the
        // rest fills in beneath.
        if (card) {
          fetchDetails(entry, preview).then((added) => {
            if (!added || !card.isConnected || this.#index !== shownIndex) return;
            card.replaceWith(this.#recordCard(preview));
            // The actions row was built before this request answered, so an
            // open-access copy found here still needs its pill.
            const actions = this.#el.querySelector(".fx-cite-actions");
            if (preview.pdfUrl && actions && !actions.querySelector(".fx-pill-primary")) {
              actions.prepend(
                this.#linkPill(`[PDF] ${preview.pdfHost}`, preview.pdfUrl, "fx-pill-primary"),
              );
            }
            this.#position();
          });
        }
      });
    } else {
      body.append(this.#rawEntry(entry));
    }

    el.hidden = false;
    this.#position();
  }

  #header() {
    const head = document.createElement("div");
    head.className = "fx-cite-head";
    const label = document.createElement("span");
    label.className = "fx-cite-label";
    label.textContent =
      this.#entries[this.#index].number !== null
        ? `[${this.#entries[this.#index].number}]`
        : this.#entries[this.#index].label ?? "";
    head.append(label);
    if (this.#entries.length > 1) {
      const pager = document.createElement("span");
      pager.className = "fx-cite-pager";
      const prev = this.#pagerButton("‹", -1);
      const next = this.#pagerButton("›", +1);
      const count = document.createElement("span");
      count.textContent = `${this.#index + 1} / ${this.#entries.length}`;
      pager.append(count, prev, next);
      head.append(pager);
    }
    const close = document.createElement("button");
    close.className = "fx-cite-close";
    close.type = "button";
    close.textContent = "✕";
    close.title = "Close";
    close.addEventListener("click", () => this.hide());
    head.append(close);
    return head;
  }

  #pagerButton(text, delta) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.disabled =
      (delta < 0 && this.#index === 0) ||
      (delta > 0 && this.#index === this.#entries.length - 1);
    b.addEventListener("click", () => {
      this.#index += delta;
      this.#render();
    });
    return b;
  }

  #loadingNode() {
    const d = document.createElement("div");
    d.className = "fx-cite-loading";
    d.textContent = "Looking this reference up…";
    return d;
  }

  /** The paper's abstract. One node, whether it came with the record or landed
   *  a moment later. */
  #snippetNode(text) {
    const snippet = document.createElement("div");
    snippet.className = "fx-scholar-snippet";
    snippet.textContent = text;
    return snippet;
  }

  #sourceNote(text) {
    const d = document.createElement("div");
    d.className = "fx-cite-source";
    d.textContent = text;
    return d;
  }

  #rawEntry(entry) {
    const d = document.createElement("div");
    const raw = entry.raw || "";
    // The entry as the document prints it — with its links live. An entry that
    // is a tool or a dataset ("Amarisoft. https://www.amarisoft.com/.") has no
    // paper to look up, so this text IS the answer, and its URL is the useful
    // part of it.
    for (const part of linkParts(raw.length > 360 ? raw.slice(0, 360) + "…" : raw)) {
      if (!part.href) {
        d.append(part.text);
        continue;
      }
      const a = document.createElement("a");
      a.textContent = part.text;
      a.href = part.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      d.append(a);
    }
    return d;
  }

  #unresolvedNode(entry) {
    const d = document.createElement("div");
    d.className = "fx-cite-unresolved";
    d.textContent = `Reference [${entry.label ?? entry.number}] could not be read from this document's bibliography.`;
    return d;
  }

  #recordCard(preview) {
    const card = document.createElement("div");
    card.className = "fx-scholar-card";
    const title = document.createElement(preview.url ? "a" : "div");
    title.className = "fx-scholar-title";
    title.textContent = preview.title;
    if (preview.url) {
      title.href = preview.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    card.append(title);
    if (preview.byline) {
      const byline = document.createElement("div");
      byline.className = "fx-scholar-byline";
      byline.textContent = preview.byline;
      card.append(byline);
    }
    if (preview.snippet) card.append(this.#snippetNode(preview.snippet));
    const foot = document.createElement("div");
    foot.className = "fx-scholar-foot";
    if (preview.citedBy) {
      const cited = document.createElement(preview.citedByUrl ? "a" : "span");
      cited.className = "fx-scholar-cited";
      cited.textContent = preview.citedBy;
      if (preview.citedByUrl) {
        cited.href = preview.citedByUrl;
        cited.target = "_blank";
        cited.rel = "noopener noreferrer";
      }
      foot.append(cited);
    }
    // Which service answered. The three sources know different things — the
    // registered metadata, the citation graph, the preprint — so this is part
    // of reading the card, not a credit line.
    if (preview.source) {
      const via = document.createElement(preview.sourceUrl ? "a" : "span");
      via.className = "fx-scholar-via";
      via.textContent = `via ${preview.source}`;
      via.title = `This record came from ${preview.source}`;
      if (preview.sourceUrl) {
        via.href = preview.sourceUrl;
        via.target = "_blank";
        via.rel = "noopener noreferrer";
      }
      foot.append(via);
    }
    if (foot.childElementCount) card.append(foot);
    return card;
  }

  /**
   * The paper's own page on whoever published it — `{host, url}` — or null.
   *
   * A record's landing URL is a doi.org redirect most of the time, and that is
   * already the DOI pill; what is worth its own button is the case where the
   * record points straight at the venue (USENIX and NDSS register no DOIs, so
   * OpenAIRE's link IS usenix.org), or at arXiv. The [PDF] pill is not a
   * substitute: a conference paper page is not a PDF, and it is where the
   * abstract, the slides and the artifact live.
   */
  #venueLink(preview) {
    if (!preview?.url || preview.url === preview.pdfUrl) return null;
    let host;
    try {
      host = new URL(preview.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
    if (host === "doi.org" || host === "dx.doi.org") return null;
    return { host, url: preview.url };
  }

  /** A DOI pill. The slashes stay readable: only the parts that need escaping
   *  are escaped, so the link reads as the DOI it is. */
  #doiPill(doi) {
    return this.#linkPill("DOI", `https://doi.org/${encodeURIComponent(doi).replaceAll("%2F", "/")}`);
  }

  #linkPill(text, href, extra = "") {
    const a = document.createElement("a");
    a.className = `${this.#pinned ? "fx-pill" : ""} ${extra}`.trim();
    a.textContent = text;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  #actions(entry) {
    const actions = document.createElement("div");
    actions.className = "fx-cite-actions";

    // A stub (unparsed) entry has no title/DOI/page — nothing to act on.
    if (entry.unresolved) return actions;

    if (this.#pinned) {
      // Cite → BibTeX panel (Scholar's own BibTeX, else a local fallback).
      const cite = document.createElement("button");
      cite.type = "button";
      cite.className = "fx-pill fx-pill-action";
      cite.textContent = "Cite";
      cite.addEventListener("click", (e) => {
        e.preventDefault();
        this.#toggleCite(entry);
      });
      actions.append(cite);

      // Jump to the entry in the bibliography (replaces the PDF's own citation
      // link, which we disable so a click opens this card instead of scrolling
      // away). The parsed entry carries its page and PDF-space y.
      if (entry.page && Number.isFinite(entry.y)) {
        const ref = document.createElement("button");
        ref.type = "button";
        ref.className = "fx-pill fx-pill-action";
        ref.textContent = "Reference ↓";
        ref.title = "Scroll to this entry in the references";
        ref.addEventListener("click", (e) => {
          e.preventDefault();
          this.#app.pdfViewer.scrollPageIntoView({
            pageNumber: entry.page,
            destArray: [null, { name: "XYZ" }, 0, entry.y + 24, null],
          });
        });
        actions.append(ref);
      }

      // [PDF] (prepended, primary) fills in once the lookup lands — an
      // open-access copy the record itself points at, not a guess. A DOI the
      // lookup found and the entry did not print is worth a pill too.
      lookupReference(entry).then((preview) => {
        if (!actions.isConnected || !preview || preview.unavailable) return;
        if (preview.pdfUrl) {
          actions.prepend(this.#linkPill(`[PDF] ${preview.pdfHost}`, preview.pdfUrl, "fx-pill-primary"));
        }
        // The page the paper actually lives on, when the record names one:
        // usenix.org/conference/…/presentation/… for a proceedings paper,
        // arxiv.org/abs/… for a preprint. Labelled by host, so it says where
        // it goes. A doi.org link is skipped — that is the DOI pill's job.
        const venue = this.#venueLink(preview);
        if (venue) actions.append(this.#linkPill(venue.host, venue.url, "fx-pill-venue"));
        if (preview.doi && !entry.doi) actions.append(this.#doiPill(preview.doi));
      });
    }

    actions.append(this.#linkPill("Google Scholar", scholarSearchUrl(referenceQuery(entry))));

    if (entry.doi) actions.append(this.#doiPill(entry.doi));
    return actions;
  }

  // Toggle a BibTeX panel under the card. Prefers Scholar's own BibTeX
  // (fetched via the cluster id), falling back to a BibTeX generated from the
  // locally parsed reference so "Cite" always yields something copyable.
  #toggleCite(entry) {
    const el = this.#el;
    const existing = el.querySelector(".fx-cite-bib");
    if (existing) {
      existing.remove();
      this.#position();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "fx-cite-bib";
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.rows = 7;
    ta.value = "Loading BibTeX…";
    const bar = document.createElement("div");
    bar.className = "fx-cite-bib-bar";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      ta.select();
      Promise.resolve(navigator.clipboard?.writeText(ta.value)).catch(() => {});
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy"), 1400);
    });
    bar.append(copy);
    panel.append(ta, bar);
    el.append(panel);
    this.#position();

    // The publisher's own registered BibTeX, via the DOI — the entry's if it
    // printed one, otherwise the DOI the lookup found. Falls back to a BibTeX
    // built from the parsed entry, so "Cite" always yields something copyable.
    lookupReference(entry).then((preview) =>
      fetchBibtex(
        entry.doi || (preview?.unavailable ? null : preview?.doi),
        preview?.unavailable ? null : preview,
      ).then((bib) => {
        if (!panel.isConnected) return;
        ta.value = bib || entryBibtex(entry, preview?.unavailable ? null : preview);
        this.#position();
      }),
    );
  }

  // Position near the anchor, clamped to the container, flipped above when
  // there is no room below.
  #position() {
    const el = this.#el;
    const container = document.getElementById("viewerContainer");
    const cRect = container.getBoundingClientRect();
    const aRect = this.#anchor.getBoundingClientRect();
    const pRect = el.getBoundingClientRect();
    let left = aRect.left - cRect.left + container.scrollLeft;
    left = Math.min(left, container.scrollWidth - pRect.width - 8);
    let top = aRect.bottom - cRect.top + container.scrollTop + 6;
    if (aRect.bottom + pRect.height + 12 > cRect.bottom) {
      top = aRect.top - cRect.top + container.scrollTop - pRect.height - 6;
    }
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }
}
