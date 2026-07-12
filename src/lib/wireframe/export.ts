import { escapeHtml } from "@/lib/copy/html";

import { WIREFRAME_CSS } from "./design-system-css";
import { injectCopy, type SectionCopy } from "./inject";

/**
 * A page as a standalone HTML document: wireframe + active copy + the
 * design system inlined. Opens anywhere, hands off to any tool.
 */
export function exportPageHtml(options: { title: string; wireframeHtml: string; sections: SectionCopy[] }): string {
  const body = injectCopy(options.wireframeHtml, options.sections);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="generator" content="CopyDog">
<style>
:root { --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
* { margin: 0; padding: 0; box-sizing: border-box; }
${WIREFRAME_CSS}
</style>
</head>
<body class="wf-root">
${body}
</body>
</html>
`;
}
