// Citation popup. Two modes:
//  - hover: quick local preview of the reference entry text (auto-hides)
//  - click: pinned card with a Google Scholar preview (title, byline,
//    snippet, cited-by, [PDF] button) and a pager when one in-text citation
//    resolves to several entries. Dismissed by ✕, Escape, or clicking
//    outside.

import { fetchScholarPreview, scholarSearchUrl } from "./scholar.mjs";

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

  #actions(entry) {
    const actions = document.createElement("div");
    actions.className = "fx-cite-actions";

    if (this.#pinned) {
      // Fill in the [PDF] pill once the preview arrives.
      fetchScholarPreview(entry.title).then((preview) => {
        if (!preview?.pdfUrl || !actions.isConnected) return;
        const pdf = document.createElement("a");
        pdf.className = "fx-pill fx-pill-primary";
        pdf.textContent = `[PDF] ${preview.pdfHost}`;
        pdf.href = preview.pdfUrl;
        pdf.target = "_blank";
        pdf.rel = "noopener noreferrer";
        actions.prepend(pdf);
      });
    }

    const refs = document.createElement("a");
    refs.className = this.#pinned ? "fx-pill" : "";
    refs.textContent = "See in References";
    refs.addEventListener("click", (e) => {
      e.preventDefault();
      this.hide();
      this.#app.pdfViewer.scrollPageIntoView({
        pageNumber: entry.page,
        destArray: [null, { name: "XYZ" }, 0, entry.y + 8, null],
      });
    });
    actions.append(refs);

    const scholar = document.createElement("a");
    scholar.className = this.#pinned ? "fx-pill" : "";
    scholar.textContent = "Google Scholar";
    scholar.href = scholarSearchUrl(entry.title);
    scholar.target = "_blank";
    scholar.rel = "noopener noreferrer";
    actions.append(scholar);

    if (entry.doi) {
      const doi = document.createElement("a");
      doi.className = this.#pinned ? "fx-pill" : "";
      doi.textContent = "DOI";
      doi.href = `https://doi.org/${encodeURIComponent(entry.doi).replaceAll("%2F", "/")}`;
      doi.target = "_blank";
      doi.rel = "noopener noreferrer";
      actions.append(doi);
    }
    return actions;
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
