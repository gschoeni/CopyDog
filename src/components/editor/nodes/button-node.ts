import {
  $applyNodeReplacement,
  $createParagraphNode,
  ElementNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type ParagraphNode,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from "lexical";

export type SerializedButtonNode = Spread<{ url: string }, SerializedElementNode>;

/**
 * Button / CTA — a link that stands alone as a block. Its text children are
 * the label; the destination URL is node state. Serialized to markdown as a
 * link-only paragraph: `[Label](url)`.
 */
export class ButtonNode extends ElementNode {
  __url: string;

  constructor(url = "#", key?: string) {
    super(key);
    this.__url = url;
  }

  static getType(): string {
    return "cta-button";
  }

  static clone(node: ButtonNode): ButtonNode {
    return new ButtonNode(node.__url, node.__key);
  }

  static importJSON(json: SerializedButtonNode): ButtonNode {
    return $createButtonNode(json.url);
  }

  exportJSON(): SerializedButtonNode {
    return { ...super.exportJSON(), type: "cta-button", url: this.__url, version: 1 };
  }

  getURL(): string {
    return this.getLatest().__url;
  }

  setURL(url: string): this {
    const writable = this.getWritable();
    writable.__url = url;
    return writable;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("p");
    dom.className = "editor-button";
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("p");
    element.className = "editor-button";
    return { element };
  }

  insertNewAfter(_selection: RangeSelection, restoreSelection = true): ParagraphNode {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  collapseAtStart(): boolean {
    const paragraph = $createParagraphNode();
    this.getChildren().forEach((child) => paragraph.append(child));
    this.replace(paragraph);
    return true;
  }
}

export function $createButtonNode(url = "#"): ButtonNode {
  return $applyNodeReplacement(new ButtonNode(url));
}

export function $isButtonNode(node: LexicalNode | null | undefined): node is ButtonNode {
  return node instanceof ButtonNode;
}
