"use client";

import { useMemo } from "react";

import { parseChatMarkdown, type ChatBlock } from "@/lib/copy/chat-markdown";
import { parseInline } from "@/lib/copy/inline";

/**
 * Assistant replies rendered as formatted text instead of raw markdown.
 * Typography stays chat-scale: headings read as emphasized labels, not
 * page headings — the reply is a message, not a document.
 */
export function AssistantMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseChatMarkdown(markdown), [markdown]);
  return (
    <div className="space-y-2.5 text-sm leading-6 text-ink-secondary">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: ChatBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="whitespace-pre-wrap">
          <Inline text={block.text} />
        </p>
      );
    case "heading":
      return (
        <p className={`font-semibold text-ink ${block.level <= 2 ? "pt-1 text-sm" : "text-[13px]"}`}>
          <Inline text={block.text} />
        </p>
      );
    case "bullets":
      return (
        <ul className="space-y-1 pl-5">
          {block.items.map((item, index) => (
            <li key={index} className="list-disc marker:text-ink-tertiary">
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol className="space-y-1 pl-5">
          {block.items.map((item, index) => (
            <li key={index} className="list-decimal marker:text-ink-tertiary marker:tabular-nums">
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote className="whitespace-pre-wrap border-l-2 border-border-strong pl-3 text-ink-secondary">
          <Inline text={block.text} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg bg-surface-sunken px-3 py-2 font-mono text-xs leading-5 text-ink">
          {block.text}
        </pre>
      );
    case "hr":
      return <hr className="border-border" />;
  }
}

function Inline({ text }: { text: string }) {
  const runs = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {runs.map((run, index) => {
        if (run.link !== undefined) {
          return (
            <a
              key={index}
              href={run.link}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-accent underline underline-offset-2 hover:no-underline"
            >
              {run.text}
            </a>
          );
        }
        if (run.code) {
          return (
            <code key={index} className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em] text-ink">
              {run.text}
            </code>
          );
        }
        if (run.bold || run.italic) {
          return (
            <span key={index} className={`${run.bold ? "font-semibold text-ink" : ""} ${run.italic ? "italic" : ""}`}>
              {run.text}
            </span>
          );
        }
        return <span key={index}>{run.text}</span>;
      })}
    </>
  );
}
