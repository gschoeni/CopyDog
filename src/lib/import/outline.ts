import { parse, HTMLElement as ParsedElement } from "node-html-parser";

/**
 * A structural outline of a fetched page, band by band.
 *
 * A URL reference is the one case where we should NOT reach for vision. We
 * have the document itself, and the DOM says what a screenshot can only
 * imply: how many items are in that row, whether the picture comes before or
 * after the text, how the bands nest. Passing that as text is both more
 * precise and far cheaper than rendering the page and looking at it.
 *
 * What we cannot know without CSS is the visual geometry — column widths,
 * which side a float lands on. So the outline reports what the markup
 * genuinely supports (counts, order, repetition) and stays quiet about the
 * rest rather than guessing.
 */

const MAX_BANDS = 14;
/** Below this, repeated siblings are a coincidence rather than a grid. */
const MIN_REPEATS = 2;

export function outlineHtmlStructure(html: string): string {
  const root = parse(html, { comment: false });
  for (const tag of ["script", "style", "noscript", "svg", "template"]) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }

  const scope = root.querySelector("main") ?? root.querySelector("body") ?? root;
  // A band earns its place by having content, and content is not only prose:
  // a logo strip carries two words and six images, and dropping it would
  // renumber every band below it — which is exactly what the layout has to
  // line up against.
  const bands = scope
    .querySelectorAll("section")
    .filter(
      (el) =>
        !hasAncestor(el, "section") &&
        ((el.textContent ?? "").trim().length > 20 || el.querySelectorAll("img, picture, video, figure").length >= 2),
    );

  const source = bands.length >= 2 ? bands : topLevelBlocks(scope);
  if (source.length === 0) return "";

  const lines = source.slice(0, MAX_BANDS).map((band, index) => `${index + 1}. ${describeBand(band)}`);
  return [
    "Structure of that page, band by band (from its markup — use it the way you would use a screenshot):",
    ...lines,
  ].join("\n");
}

function describeBand(band: ParsedElement): string {
  const heading = band.querySelector("h1, h2, h3");
  const parts: string[] = [];

  const level = heading?.rawTagName?.toLowerCase();
  if (level) parts.push(`${level} heading`);

  const paragraphs = band.querySelectorAll("p").length;
  if (paragraphs) parts.push(`${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}`);

  const repeat = repeatedGroup(band);
  if (repeat) parts.push(`a row of ${repeat.count} repeated items${repeat.withImage ? ", each with an image" : ""}`);

  const images = band.querySelectorAll("img, picture, video, figure").length;
  if (images) {
    const where = imageComesFirst(band) ? "before" : "after";
    parts.push(`${images} image${images === 1 ? "" : "s"} (first one ${where} the text)`);
  }

  const links = band.querySelectorAll("a").length;
  if (links) parts.push(`${links} link${links === 1 ? "" : "s"}`);

  const lists = band.querySelectorAll("ul, ol").length;
  if (lists) parts.push(`${lists} list${lists === 1 ? "" : "s"}`);

  return parts.length ? parts.join(", ") : "text only";
}

/**
 * The largest set of same-shaped sibling elements in the band — a card grid,
 * a logo row, a stats strip. Shape is the tag plus its first class, which is
 * what template loops produce.
 */
function repeatedGroup(band: ParsedElement): { count: number; withImage: boolean } | null {
  let best: { count: number; withImage: boolean } | null = null;

  const visit = (node: ParsedElement) => {
    const groups = new Map<string, ParsedElement[]>();
    for (const child of node.childNodes) {
      if (!(child instanceof ParsedElement)) continue;
      const tag = child.rawTagName?.toLowerCase();
      if (!tag) continue;
      const signature = `${tag}.${(child.getAttribute("class") ?? "").split(/\s+/)[0] ?? ""}`;
      (groups.get(signature) ?? groups.set(signature, []).get(signature)!).push(child);
      visit(child);
    }
    for (const siblings of groups.values()) {
      if (siblings.length < MIN_REPEATS) continue;
      // a run of bare <p> or <a> is prose, not a grid
      const tag = siblings[0]!.rawTagName?.toLowerCase();
      if (tag === "p" || tag === "a" || tag === "span" || tag === "br") continue;
      if (!best || siblings.length > best.count) {
        best = {
          count: siblings.length,
          withImage: siblings.every((s) => s.querySelectorAll("img, picture, svg, figure").length > 0),
        };
      }
    }
  };
  visit(band);
  return best;
}

/** Does the band's first image precede its first heading or paragraph? */
function imageComesFirst(band: ParsedElement): boolean {
  const order: string[] = [];
  const walk = (node: ParsedElement) => {
    for (const child of node.childNodes) {
      if (!(child instanceof ParsedElement)) continue;
      const tag = child.rawTagName?.toLowerCase() ?? "";
      if (["img", "picture", "video", "figure"].includes(tag)) order.push("image");
      else if (/^h[1-6]$/.test(tag) || tag === "p") order.push("text");
      else walk(child);
    }
  };
  walk(band);
  return order[0] === "image";
}

/** Fallback banding when the page has no <section> elements to speak of. */
function topLevelBlocks(scope: ParsedElement): ParsedElement[] {
  return scope.childNodes
    .filter((node): node is ParsedElement => node instanceof ParsedElement)
    .filter((el) => (el.textContent ?? "").trim().length > 40);
}

function hasAncestor(el: ParsedElement, tag: string): boolean {
  let parent = el.parentNode;
  while (parent) {
    if (parent.rawTagName?.toLowerCase() === tag) return true;
    parent = parent.parentNode;
  }
  return false;
}
