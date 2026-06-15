// Citation popup. Two modes:
//  - hover: quick local preview of the reference entry text (auto-hides)
//  - click: pinned card, like the Google Scholar reader — title linking to
//    the paper, byline, abstract snippet, cited-by, and actions ([PDF], Cite
//    → BibTeX, Related, Google Scholar, DOI), with a pager when one in-text
//    citation resolves to several entries. Clicking a citation never scrolls
//    the PDF to the bibliography. Dismissed by ✕, Escape, or clicking outside.

import { fetchScholarPreview, fetchScholarBibtex, scholarSearchUrl } from "./scholar.mjs";

/** A minimal BibTeX entry from the locally parsed reference — the fallback
 *  when Scholar's own BibTeX can't be fetched. */
function entryBibtex(entry, preview) {
  const surname = (entry.surname || "ref").replace(/[^A-Za-z]/g, "") || "ref";
  const key = (surname + (entry.year || "")).toLowerCase();
  const clean = (s) => String(s).replace(/[{}]/g, "").trim();
  const out = [`@misc{${key},`];
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

    if (this.#pinned) {
      body.append(this.#loadingNode());
      const shownIndex = this.#index;
      fetchScholarPreview(entry.title).then((preview) => {
        if (this.#el.hidden || this.#index !== shownIndex || !body.isConnected) return;
        body.replaceChildren(preview ? this.#scholarCard(preview) : this.#rawEntry(entry));
        this.#position();
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
    d.textContent = "Looking up on Google Scholar…";
    return d;
  }

  #rawEntry(entry) {
    const d = document.createElement("div");
    d.textContent = entry.raw.length > 360 ? entry.raw.slice(0, 360) + "…" : entry.raw;
    return d;
  }

  #scholarCard(preview) {
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
    if (preview.snippet) {
      const snippet = document.createElement("div");
      snippet.className = "fx-scholar-snippet";
      snippet.textContent = preview.snippet;
      card.append(snippet);
    }
    if (preview.citedBy) {
      const cited = document.createElement(preview.citedByUrl ? "a" : "span");
      cited.className = "fx-scholar-cited";
      cited.textContent = preview.citedBy;
      if (preview.citedByUrl) {
        cited.href = preview.citedByUrl;
        cited.target = "_blank";
        cited.rel = "noopener noreferrer";
      }
      card.append(cited);
    }
    return card;
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

      // [PDF] (prepended, primary) and Related fill in once the preview lands.
      fetchScholarPreview(entry.title).then((preview) => {
        if (!actions.isConnected) return;
        if (preview?.pdfUrl) {
          actions.prepend(this.#linkPill(`[PDF] ${preview.pdfHost}`, preview.pdfUrl, "fx-pill-primary"));
        }
        if (preview?.relatedUrl) {
          actions.append(this.#linkPill("Related", preview.relatedUrl));
        }
      });
    }

    actions.append(this.#linkPill("Google Scholar", scholarSearchUrl(entry.title)));

    if (entry.doi) {
      actions.append(
        this.#linkPill("DOI", `https://doi.org/${encodeURIComponent(entry.doi).replaceAll("%2F", "/")}`),
      );
    }
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

    fetchScholarPreview(entry.title).then((preview) =>
      fetchScholarBibtex(preview?.cid).then((bib) => {
        if (!panel.isConnected) return;
        ta.value = bib || entryBibtex(entry, preview);
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
