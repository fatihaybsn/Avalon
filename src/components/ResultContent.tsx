import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeMarkdown } from "../lib/tasks";

export default function ResultContent({ text }: { text?: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.iris.openExternal(href); }}>{children}</a> }}>{normalizeMarkdown(text)}</ReactMarkdown>;
}
