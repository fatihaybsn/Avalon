export function isBrainNoteLink(href: string): boolean;
export function createBrainLinkResolver(nodes: Array<{ id: string; title: string }>): (sourceId: string, href: string, wiki?: boolean) => string | null;
export function extractBrainLinks(markdown: string): Array<{ href: string; wiki: boolean }>;
