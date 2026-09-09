// Turning a parsed bibliography entry into a lookup, and deciding whether what
// comes back IS that entry. No network, no DOM — every source in sources.mjs
// runs its results through these, and so can a unit test.
//
// The verification is the load-bearing part of the whole feature. Searching a
// title and trusting hit #1 is what made three different citations show the
// same card (R24): a short or generic title ("Applied pi calculus") ranks a
// longer, better-cited paper that merely contains those words ("Simulation
// based security in the applied pi calculus") above the work actually cited.
// So `bestMatch` scores every candidate against the reference and returns
// nothing unless one is convincingly it — and BECAUSE it does, a query is free
// to widen when a precise one comes back empty.
//
// What goes in is the paper's own identity: TITLE + FIRST AUTHOR + YEAR. Not
// the venue — a paper is indexed under its title and authors, and where it
// appeared only competes for terms.

/**
 * The search query for a parsed reference: its title, plus the first author's
 * surname and the year when the title does not already carry them. The extra
 * two terms are what separate a work from the better-cited papers that quote
 * its subject in their own titles.
 *
 * @param ref a parsed entry ({title, surname, year, raw}) or a plain string.
 */
export function referenceQuery(ref) {
  // A bare string gets the same normalization as a parsed title — a caller
  // with nothing but text is the caller most likely to be handing over an
  // entry with a link in it.
  if (typeof ref === "string") return queryText(ref);
  const title = queryText(ref?.title || ref?.raw || "");
  const terms = [title];
  const lower = title.toLowerCase();
  const surname = queryText(ref?.surname || "");
  if (surname.length >= 2 && !lower.includes(surname.toLowerCase())) terms.push(surname);
  if (ref?.year && !title.includes(ref.year)) terms.push(String(ref.year).slice(0, 4));
  return terms.join(" ").trim();
}

/** A bare URL or DOI in an entry ("… https://github.com/x/y", "… (2005).
 *  https://doi.org/10.1007/z"): part of the reference, never part of a search
 *  for it. As query terms they are noise Scholar has to AND against, and the
 *  title regexes cannot always keep them out of `title`. */
const LINK = /\b(?:https?:\/\/|doi:|www\.)\S*/gi;
const DOI = /\b10\.\d{4,9}\/\S+/gi;

/**
 * Where a title ends and the venue begins, for a parsed title that still
 * carries a tail ("Specification for DNS over TLS. RFC 7858, May 2016").
 *
 * A paper is indexed under its title and authors; where it appeared is not
 * part of finding it, and as query terms a venue's words only compete with
 * the title's. Anchored on a sentence end so a title containing one of these
 * words ("In search of an understandable consensus algorithm", "Proceedings
 * of the Royal Society") is not cut short.
 */
const VENUE_TAIL =
  /[.,]\s+(?:In[:\s]|Proc\.|Proceedings\b|Technical\s+(?:Report|Specification)\b|RFC\s*\d|IEEE\s+Std\b|arXiv[:\s]|\[Online\]|Available:|(?:Master'?s?|PhD|Doctoral)\s+thesis)/i;

/** A PDF text layer leaves TeX accent composition behind as loose spacing
 *  accents ("Mart´ın", "C´edric"); they are noise in a search query. */
export function queryText(s) {
  const text = String(s);
  const tail = VENUE_TAIL.exec(text);
  return (tail ? text.slice(0, tail.index) : text)
    .replace(/[´`ˆ˜¨˚ˇ]/g, "")
    .replace(LINK, " ")
    .replace(DOI, " ")
    // BibTeX casing braces printed verbatim by some styles ("{DoLTEst}:
    // In-depth downlink negative testing for {LTE} devices"). They are
    // typesetting instructions, not part of the words.
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

/**
 * Is there anything here to look up?
 *
 * An entry that is a name and a link — "Amarisoft. https://www.amarisoft.com/."
 * — is a tool or a website, not a paper. Scholar answers it with either
 * nothing or ten unrelated 5G papers, and every such query spends part of a
 * budget Scholar enforces harshly (measured: a few dozen searches in a few
 * minutes and it answers 429 + captcha for a while, which costs the NEXT
 * citation the user clicks its card). So these go straight to the document's
 * own bibliography entry, which was always the honest answer for them.
 *
 * Only entries that carry a link are judged: a short title with no link
 * ("Applied cryptography") is a real, findable work.
 */
export function isSearchable(ref) {
  const text = typeof ref === "string" ? ref : ref?.title || ref?.raw || "";
  if (!/(?:https?:\/\/|www\.)/i.test(text)) return true;
  const words = queryText(text).match(/\p{L}{2,}/gu) ?? [];
  return words.length >= 4;
}

/**
 * The queries to try for one reference, most specific first.
 *
 * 1. title + first author + year — precise, and it ranks the cited work first
 *    on a search that ranks by citation count.
 * 2. the title alone — what a person would type, and what still finds the
 *    paper when one of those extra terms was wrong: a year that differs from
 *    the one the source indexed (preprint vs journal), an author spelled
 *    differently, a title the text layer mangled.
 *
 * Collapses to one when the reference has nothing to add.
 */
export function queryVariants(ref) {
  const strict = referenceQuery(ref);
  const bare = queryText(typeof ref === "string" ? ref : ref?.title || ref?.raw || "");
  return [strict, ...(bare && bare !== strict ? [bare] : [])];
}

/** Diacritics dropped, punctuation to spaces, case-folded — so "Martín" and
 *  the text layer's "Mart´ın" compare equal, as do "TLS 1.3" and "TLS 1·3". */
export function fold(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (s) => fold(s).split(" ").filter(Boolean);
const tokens = (s) => new Set(words(s));

/** The f-ligatures, longest first. Some PDFs have no mapping for the glyph at
 *  all, so the text layer drops it and leaves a GAP: "Certified email" comes
 *  out as "Certi ed email", "efficient" as "e cient". */
const LIGATURES = ["ffi", "ffl", "ff", "fi", "fl"];

/**
 * `list`, with a fragment pair rejoined wherever a dropped ligature explains
 * the gap and `known` has the word that results ("certi" + "ed" → "certified"
 * when the other title says "certified").
 *
 * Only a word the OTHER side actually contains can be reconstructed, so this
 * cannot invent a match: it can only stop a text-layer defect from destroying
 * one. Without it a mangled title scores ~0.4 against its own paper — under
 * the floor — and the reference is reported as not found on Scholar.
 */
function healLigatureGaps(list, known) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1];
    const joined = next && LIGATURES.map((l) => list[i] + l + next).find((w) => known.has(w));
    if (joined) {
      out.push(joined);
      i++;
    } else {
      out.push(list[i]);
    }
  }
  return out;
}

/** A source may print a long title truncated ("Automated verification of
 *  selected equivalences for security…"). Dice would then charge us for the
 *  words it chose not to print, so both sides are cut to the shorter one's
 *  length. */
const TRUNCATED = /[…]|\.\.\.$/;

/** Words the shorter title must lead with before it counts as that title's
 *  registered short form. Below this, "Applied pi calculus" would be the short
 *  form of every paper starting with those words. */
const PREFIX_MIN = 3;

/**
 * Is `short` the beginning of `long`, word for word, and meaningfully shorter?
 *
 * This is the shape a registered SHORT TITLE has: OpenAlex holds "Breaking and
 * Fixing VoLTE" for a paper the bibliography calls "Breaking and fixing volte:
 * Exploiting hidden data channels and misimplementations". Being a prefix is
 * much stronger evidence than R24-1's containment trap (which matched a title
 * quoted in the MIDDLE of a longer one) — but it is still not proof, so
 * `scoreResult` caps what a prefix match alone can earn.
 */
function isTitlePrefix(short, long) {
  if (short.length < PREFIX_MIN || long.length - short.length < 2) return false;
  return short.every((w, i) => w === long[i]);
}

/** Dice coefficient over word sets: 1 = same words, 0 = disjoint. Symmetric,
 *  unlike containment — which scores a SUPERSET title ("Simulation based
 *  security in the applied pi calculus" over "Applied pi calculus") a perfect
 *  1.0 and is exactly how the wrong paper got through. */
export function titleScore(a, b) {
  return titleMatch(a, b).dice;
}

/**
 * `titleScore`, plus how it got there: `prefix` is true when the two agreed
 * only because the shorter title is the longer one's opening words. The caller
 * limits what that can earn — see `scoreResult`.
 */
export function titleMatch(a, b) {
  let A = words(a);
  let B = words(b);
  if (!A.length || !B.length) return { dice: 0, prefix: false };
  A = healLigatureGaps(A, new Set(B));
  B = healLigatureGaps(B, new Set(A));
  // A truncation is a prefix, so comparing prefixes keeps the test symmetric —
  // and the floor still applies, on fewer words. `prefix` records that the two
  // agreed on FEWER words than one of them has, whichever side was short.
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const truncated =
    short.length !== long.length &&
    (TRUNCATED.test(a) || TRUNCATED.test(b) || isTitlePrefix(short, long));
  if (truncated) {
    A = short;
    B = long.slice(0, short.length);
  }
  const sa = new Set(A);
  const sb = new Set(B);
  let hit = 0;
  for (const t of sa) if (sb.has(t)) hit++;
  return { dice: (2 * hit) / (sa.size + sb.size), prefix: truncated };
}

const TITLE_FLOOR = 0.45; // below this the titles are simply different works
const ACCEPT = 0.85; // title score plus the author/year bonuses
// What a title agreement worth of PREFIX ONLY can contribute: enough to be
// accepted with both bonuses (0.7 + 0.25 + 0.15), never without them.
const PREFIX_CAP = 0.7;

/**
 * The best-scoring result that is convincingly the cited work, or null.
 *
 * Score = title similarity + 0.25 if the first author appears in the byline
 * + 0.15 if the year matches within a year (Scholar dates a cluster by its
 * earliest version, so a journal reprint is often a year or two off).
 * A title match alone has to be near-exact; a middling one needs corroboration.
 */
export function bestMatch(results, ref) {
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const { score } = scoreResult(r, ref);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= ACCEPT ? best : null;
}

/**
 * One candidate against the reference: title similarity, the two corroborating
 * signals, and the total. A title below the floor scores 0 — the signals can
 * corroborate a match, never promote a different work.
 *
 * Exported for the same reason as `readResults`: a rejection is only
 * actionable if you can see WHICH term fell short.
 */
export function scoreResult(result, ref) {
  const wanted = typeof ref === "string" ? { title: ref } : ref || {};
  const refTitle = wanted.title || wanted.raw || "";
  // A hyphenated surname folds to two words ("Ben-Or" -> "ben or"), so the
  // byline test is per word, not on the joined string.
  const surnameWords = fold(wanted.surname || "").split(" ").filter((w) => w.length >= 2);
  const year = parseInt(wanted.year, 10);
  const { dice, prefix } = titleMatch(refTitle, result.title);
  // A source that returns structured metadata (Crossref, OpenAlex, arXiv) says
  // exactly who the authors are and what year it is; a scraped byline has to be
  // read for both. Prefer the structured fields when they are there — matching
  // "ryan" against an author list cannot be fooled by a venue word, and a
  // record's own year cannot be confused with a year in the venue's name.
  const bylineWords = [
    ...(result.authors?.length ? result.authors.flatMap((a) => [...tokens(a)]) : tokens(result.byline)),
  ];
  // Prefix, not equality: TeX accent composition truncates a surname in the
  // text layer at the accented letter ("Fiterău-Broştean" → "Bro"), and the
  // author bonus was then lost on exactly the papers whose authors have
  // accented names. A prefix cannot promote a mismatched title on its own —
  // the floor plus this bonus is still under the acceptance threshold.
  // (Three letters minimum on the prefix side, or every initial in the byline
  // would "match" every surname starting with that letter.)
  const near = (w, b) =>
    b === w || (w.length >= 3 && b.startsWith(w)) || (b.length >= 4 && w.startsWith(b));
  const authorOk =
    surnameWords.length > 0 && surnameWords.every((w) => bylineWords.some((b) => near(w, b)));
  // ANY year in the byline, not the last one: a venue name can carry its own
  // ("2019 IEEE Symposium on Security and Privacy, 2019" — and reprints put
  // the two years the other way round).
  const resultYears = Number.isFinite(parseInt(result.year, 10))
    ? [parseInt(result.year, 10)]
    : (fold(result.byline).match(/\b(?:19|20)\d{2}\b/g) ?? []).map((y) => parseInt(y, 10));
  const yearOk =
    Number.isFinite(year) && resultYears.some((y) => Math.abs(year - y) <= 1);
  // A prefix agreement is capped: a registered short title ("Breaking and
  // Fixing VoLTE" for a paper whose entry runs on past the colon) is a real
  // match, but so is the opening of a DIFFERENT paper, so it may only be
  // accepted WITH both corroborating signals. PREFIX_CAP + author + year
  // clears the bar; the prefix alone never does.
  const base = prefix ? Math.min(dice, PREFIX_CAP) : dice;
  const score = dice < TITLE_FLOOR ? 0 : base + (authorOk ? 0.25 : 0) + (yearOk ? 0.15 : 0);
  return { dice, prefix, authorOk, yearOk, score, accepted: score >= ACCEPT };
}
