"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
  /** Optional case-insensitive substring to wrap in <mark> inside text nodes. */
  highlightQuery?: string;
  className?: string;
};

function highlightText(text: string, q: string): ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let idx = lower.indexOf(n, start);
  let key = 0;
  while (idx >= 0) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(
      <mark key={key++} className="hl">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    start = idx + needle.length;
    idx = lower.indexOf(n, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : parts;
}

function highlightNodes(node: ReactNode, q: string): ReactNode {
  if (!q.trim()) return node;
  return Children.map(node, (child) => {
    if (typeof child === "string") return highlightText(child, q);
    if (typeof child === "number") return child;
    if (!isValidElement(child)) return child;
    const el = child as ReactElement<{ children?: ReactNode }>;
    if (el.props.children == null) return el;
    return cloneElement(el, {
      children: highlightNodes(el.props.children, q),
    });
  });
}

function buildComponents(q: string): Components {
  const text = (children: ReactNode) => highlightNodes(children, q);
  return {
    p: ({ children }) => <p>{text(children)}</p>,
    li: ({ children }) => <li>{text(children)}</li>,
    td: ({ children }) => <td>{text(children)}</td>,
    th: ({ children }) => <th>{text(children)}</th>,
    h1: ({ children }) => <h1>{text(children)}</h1>,
    h2: ({ children }) => <h2>{text(children)}</h2>,
    h3: ({ children }) => <h3>{text(children)}</h3>,
    h4: ({ children }) => <h4>{text(children)}</h4>,
    h5: ({ children }) => <h5>{text(children)}</h5>,
    h6: ({ children }) => <h6>{text(children)}</h6>,
    strong: ({ children }) => <strong>{text(children)}</strong>,
    em: ({ children }) => <em>{text(children)}</em>,
    blockquote: ({ children }) => <blockquote>{text(children)}</blockquote>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {text(children)}
      </a>
    ),
    code: ({ className, children }) => {
      const content = text(children);
      if (!className) return <code>{content}</code>;
      return <code className={className}>{content}</code>;
    },
  };
}

export function MarkdownBody({ text, highlightQuery, className }: Props) {
  const q = highlightQuery?.trim() ?? "";
  const components = useMemo(() => buildComponents(q), [q]);

  return (
    <div className={className ? `md-body ${className}` : "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
