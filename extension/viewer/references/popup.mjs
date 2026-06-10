// Hover/click popup for in-text citations: shows the resolved reference
// entries with "Find on Google Scholar" and "Jump to entry" actions.

const SHOW_DELAY = 120;
const HIDE_DELAY = 250;

export class CitationPopup {
  #app;
  #el = null;
  #timer = null;

  constructor(app) {
    this.#app = app;
  }

  #ensure() {
    if (this.#el) return this.#el;
    const el = document.createElement("div");
    el.className = "fx-cite-popup";
    el.hidden = true;
    el.addEventListener("mouseenter", () => clearTimeout(this.#timer));
    el.addEventListener("mouseleave", () => this.scheduleHide());
    document.getElementById("viewerContainer").append(el);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
    this.#el = el;
    return el;
  }

  scheduleShow(entries, anchor) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.showNow(entries, anchor), SHOW_DELAY);
  }

  scheduleHide() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.hide(), HIDE_DELAY);
  }

  hide() {
    if (this.#el) this.#el.hidden = true;
  }

  showNow(entries, anchor) {
    clearTimeout(this.#timer);
    const el = this.#ensure();
    el.replaceChildren();
    for (const entry of entries.slice(0, 4)) {
      const block = document.createElement("div");
      block.style.cssText = "margin-bottom:6px;";
      const text = document.createElement("div");
      text.textContent = entry.raw.length > 360 ? entry.raw.slice(0, 360) + "…" : entry.raw;
      const actions = document.createElement("div");
      actions.className = "fx-cite-actions";
      const scholar = document.createElement("a");
      scholar.textContent = "Find on Google Scholar";
      scholar.href = `https://scholar.google.com/scholar?q=${encodeURIComponent(entry.title)}`;
      scholar.target = "_blank";
      scholar.rel = "noopener noreferrer";
      if (entry.doi) {
        const doi = document.createElement("a");
        doi.textContent = "Open DOI";
        doi.href = `https://doi.org/${encodeURIComponent(entry.doi).replaceAll("%2F", "/")}`;
        doi.target = "_blank";
        doi.rel = "noopener noreferrer";
        actions.append(doi);
      }
      const jump = document.createElement("a");
      jump.textContent = "Jump to entry";
      jump.addEventListener("click", (e) => {
        e.preventDefault();
        this.hide();
        this.#app.pdfViewer.scrollPageIntoView({
          pageNumber: entry.page,
          destArray: [null, { name: "XYZ" }, 0, entry.y + 8, null],
        });
      });
      actions.append(scholar, jump);
      block.append(text, actions);
      el.append(block);
    }
    el.hidden = false;

    // Position near the anchor, clamped to the container, flipped above when
    // there is no room below.
    const container = document.getElementById("viewerContainer");
    const cRect = container.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
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
