import {
  $applyNodeReplacement,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export type SerializedSectionNode = Spread<{ slug: string; pinned: boolean }, SerializedElementNode>;

/**
 * A copy section as a container inside the page's single editor. Children
 * are the section's blocks; the slug ties the node to its version files in
 * Oxen and its metadata (title, versions, notes) in doc.json.
 *
 * The node reserves headroom (CSS) where the React header overlay (title ·
 * version pill · notes · handle) is positioned.
 */
export class SectionNode extends ElementNode {
  __slug: string;
  /** pinned sections were grouped deliberately — auto-splitting skips them */
  __pinned: boolean;

  constructor(slug: string, pinned = false, key?: string) {
    super(key);
    this.__slug = slug;
    this.__pinned = pinned;
  }

  static getType(): string {
    return "copy-section";
  }

  static clone(node: SectionNode): SectionNode {
    return new SectionNode(node.__slug, node.__pinned, node.__key);
  }

  static importJSON(json: SerializedSectionNode): SectionNode {
    return $createSectionNode(json.slug, json.pinned);
  }

  exportJSON(): SerializedSectionNode {
    return { ...super.exportJSON(), type: "copy-section", slug: this.__slug, pinned: this.__pinned, version: 1 };
  }

  getSlug(): string {
    return this.getLatest().__slug;
  }

  setSlug(slug: string): this {
    const writable = this.getWritable();
    writable.__slug = slug;
    return writable;
  }

  isPinned(): boolean {
    return this.getLatest().__pinned;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "doc-section";
    dom.setAttribute("data-section-slug", this.__slug);
    return dom;
  }

  updateDOM(prevNode: SectionNode, dom: HTMLElement): boolean {
    if (prevNode.__slug !== this.__slug) {
      dom.setAttribute("data-section-slug", this.__slug);
    }
    return false;
  }

  // emptiness is managed by the section transforms (dissolve vs. keep-one),
  // not by Lexical's auto-removal
  canBeEmpty(): boolean {
    return true;
  }

  // shadow root: section children count as "top-level blocks", which is
  // what makes markdown shortcuts, $setBlocksType, and friends work
  // inside sections
  isShadowRoot(): boolean {
    return true;
  }
}

export function $createSectionNode(slug: string, pinned = false): SectionNode {
  return $applyNodeReplacement(new SectionNode(slug, pinned));
}

export function $isSectionNode(node: LexicalNode | null | undefined): node is SectionNode {
  return node instanceof SectionNode;
}
