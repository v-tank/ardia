import type { ReactNode } from "react";

const SAFE_LINK = /^https?:\/\//i;

export type LinkRenderer = (href: string, label: string, key: string) => ReactNode;

function inline(text: string, key: string, link?: LinkRenderer): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("`")) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      out.push(SAFE_LINK.test(href) ? (link ? link(href, label, k) : <a key={k} href={href} target="_blank" rel="noreferrer noopener">{label}</a>) : label);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, link }: { text: string; link?: LinkRenderer }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={n++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const children = items.map((item, j) => <li key={j}>{inline(item, `${n}-${j}`, link)}</li>);
      blocks.push(ordered ? <ol key={n++}>{children}</ol> : <ul key={n++}>{children}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) para.push(lines[i++]!.replace(/^#+\s*/, ""));
    blocks.push(<p key={n++}>{inline(para.join(" "), String(n), link)}</p>);
  }
  return <>{blocks}</>;
}
