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
} from "lexical";

export type SerializedEyebrowNode = SerializedElementNode;

/**
 * Eyebrow — the short overline above a heading ("NEW", "PRICING").
 * Serialized to markdown as an `<!--eyebrow-->`-annotated paragraph.
 */
export class EyebrowNode extends ElementNode {
  static getType(): string {
    return "eyebrow";
  }

  static clone(node: EyebrowNode): EyebrowNode {
    return new EyebrowNode(node.__key);
  }

  static importJSON(): EyebrowNode {
    return $createEyebrowNode();
  }

  exportJSON(): SerializedEyebrowNode {
    return { ...super.exportJSON(), type: "eyebrow", version: 1 };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("p");
    dom.className = "editor-eyebrow";
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("p");
    element.className = "editor-eyebrow";
    return { element };
  }

  /** Enter at the end of an eyebrow starts a fresh paragraph. */
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

export function $createEyebrowNode(): EyebrowNode {
  return $applyNodeReplacement(new EyebrowNode());
}

export function $isEyebrowNode(node: LexicalNode | null | undefined): node is EyebrowNode {
  return node instanceof EyebrowNode;
}
