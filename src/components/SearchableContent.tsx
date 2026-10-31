import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ResultContent from "./ResultContent";

export default function SearchableContent({ text = "", children }: { text?: string; children?: ReactNode }) {
  const [query, setQuery] = useState(""), [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null), selected = useRef<HTMLElement>(null);
  const matches = useMemo(() => {
    if (!query) return [];
    const hay = text.toLocaleLowerCase("tr-TR"), needle = query.toLocaleLowerCase("tr-TR"), result: number[] = [];
    let at = hay.indexOf(needle); while (at >= 0 && result.length < 10000) { result.push(at); at = hay.indexOf(needle, at + needle.length); } return result;
  }, [query, text]);
  useEffect(() => { setIndex(0); }, [query, text]);
  useEffect(() => { selected.current?.scrollIntoView({ block: "nearest" }); }, [index, query]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (input.current?.getClientRects().length && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); input.current?.focus(); input.current?.select(); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const current = Math.min(index, Math.max(0, matches.length - 1));
  return <div className="searchable-content"><div className="find-bar"><input ref={input} aria-label="İçinde bul" placeholder="İçinde bul…" value={query} onChange={(event) => setQuery(event.target.value)} /><span aria-live="polite">{matches.length ? current + 1 : 0}/{matches.length}</span><button aria-label="Önceki eşleşme" disabled={!matches.length} onClick={() => setIndex((current + matches.length - 1) % matches.length)}>↑</button><button aria-label="Sonraki eşleşme" disabled={!matches.length} onClick={() => setIndex((current + 1) % matches.length)}>↓</button></div>
    {query ? <pre className="found-text">{matches.length ? matches.map((at, i) => <span key={at}>{text.slice(i ? matches[i - 1] + query.length : 0, at)}<mark ref={i === current ? selected : undefined} className={i === current ? "current-match" : ""}>{text.slice(at, at + query.length)}</mark>{i === matches.length - 1 ? text.slice(at + query.length) : ""}</span>) : text}</pre> : children || <ResultContent text={text} />}
  </div>;
}
