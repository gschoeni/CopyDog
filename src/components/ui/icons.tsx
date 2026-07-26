import type { SVGProps } from "react";

/**
 * The app's icon set: hand-rolled 24×24 stroke icons (no icon dependency).
 * Icons inherit `currentColor` and default to 16px so they sit correctly
 * inside `size="icon"` buttons. Toolbar actions render as icons, not text —
 * see "Design and Aesthetics" in CLAUDE.md.
 */
function Icon({ children, className = "size-4", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Arrow down into a tray — importing content into the doc. */
export function ImportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </Icon>
  );
}

/** Sparkles — the AI assistant. */
export function SparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </Icon>
  );
}

/** Clock with a circular arrow — browse prior conversations. */
export function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

/** Up arrow — submit a message from a compact composer. */
export function ArrowUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m6 12 6-6 6 6" />
      <path d="M12 18V6" />
    </Icon>
  );
}

/** Two sheets — copy text to the clipboard. */
export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  );
}

/** Check mark — transient confirmation after copying. */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m5 12 4 4L19 6" />
    </Icon>
  );
}

/** Down arrow — return to the newest message. */
export function ArrowDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** Circular arrows — pull the team's published copy into your draft. */
export function SyncIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Icon>
  );
}

/** Arrow up from a tray — publish your draft to your branch. */
export function PublishIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </Icon>
  );
}

/** Pull-request branches — propose your draft for main. */
export function ProposeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M6 9v12" />
    </Icon>
  );
}

/** Chain link — hyperlinks, and a section linked to the wireframe. */
export function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  );
}

/** Slashed chain — a section unlinked from the wireframe. */
export function UnlinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M4 4l16 16" />
    </Icon>
  );
}

/** Chevron pointing down — dropdown affordance. */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

/** Small X — dismiss or remove. */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

/** Speech bubble with a plus — attach the selection to the chat. */
export function AddToChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.9-.93L3 20l1.13-4.6A8.2 8.2 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3.2 8.38 8.38 0 0 1 21 11.5z" />
      <path d="M12.5 8.5v6" />
      <path d="M9.5 11.5h6" />
    </Icon>
  );
}

/** Lines of text — a text selection attachment. */
export function TextLinesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </Icon>
  );
}

/** Chevron pointing left — go back to the previous view. */
export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

/** Panel frame with the left edge marked — toggle a left sidebar. */
export function PanelLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Icon>
  );
}

/** Panel frame with the right edge marked — toggle a right side panel. */
export function PanelRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </Icon>
  );
}

/** Trash can — delete something for good. */
export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </Icon>
  );
}

/** Overlapping rectangles — duplicate an existing item. */
export function DuplicateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  );
}

/** Six-dot grip — a drag handle. */
export function GripIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="5.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18.5" r="1.15" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Plus — add something new. */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

/** Magic wand — regenerate the layout with AI. */
export function WandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m15 4 5 5" />
      <path d="M3 21 14 10" />
      <path d="M6.5 3.5 7 5l1.5.5L7 6l-.5 1.5L6 6l-1.5-.5L6 5z" />
      <path d="M19.5 12.5 20 14l1.5.5L20 15l-.5 1.5L19 15l-1.5-.5L19 14z" />
    </Icon>
  );
}

/** Arrow down onto a line — download / export a file. */
export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

/** Text lines — the copy-only view mode. */
export function CopyModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6h16" />
      <path d="M4 11h16" />
      <path d="M4 16h10" />
    </Icon>
  );
}

/** Two columns — the side-by-side view mode. */
export function SplitModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </Icon>
  );
}

/** Layout blocks — the wireframe view mode. */
export function WireframeModeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <rect x="3" y="13" width="8" height="7" rx="1" />
      <rect x="15" y="13" width="6" height="7" rx="1" />
    </Icon>
  );
}

/** Sliders — project settings. */
export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 7h9" />
      <path d="M19 7h1" />
      <circle cx="16" cy="7" r="2.25" />
      <path d="M4 17h1" />
      <path d="M11 17h9" />
      <circle cx="8" cy="17" r="2.25" />
    </Icon>
  );
}

/** Key — personal API keys for external agents. */
export function KeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3" />
      <path d="m17 6 3 3" />
      <path d="m14 9 2 2" />
    </Icon>
  );
}

/** Paperclip — attach reference material to the assistant. */
export function PaperclipIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20.5 11.5 12 20a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </Icon>
  );
}

/** Framed picture — an image reference. */
export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
      <path d="m14.5 15.5 1.7-1.7a2 2 0 0 1 2.8 0L21 16" />
    </Icon>
  );
}

/** Page with a folded corner — a PDF reference. */
export function DocumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </Icon>
  );
}

/** Globe — a reference fetched from the web. */
export function GlobeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17" />
      <path d="M3.5 15h17" />
      <path d="M12 3c2.4 2.4 3.6 5.4 3.6 9S14.4 18.6 12 21c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z" />
    </Icon>
  );
}

/** Paw print — CopyDog at work. */
export function PawIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon fill="currentColor" stroke="none" {...props}>
      <ellipse cx="7" cy="8.5" rx="2.1" ry="2.7" />
      <ellipse cx="12" cy="6.6" rx="2.1" ry="2.9" />
      <ellipse cx="17" cy="8.5" rx="2.1" ry="2.7" />
      <path d="M12 12c2.8 0 5.5 2 5.9 4.4.3 2-1.3 3.4-3.2 3.2-.9-.1-1.8-.4-2.7-.4s-1.8.3-2.7.4c-1.9.2-3.5-1.2-3.2-3.2C6.5 14 9.2 12 12 12Z" />
    </Icon>
  );
}
