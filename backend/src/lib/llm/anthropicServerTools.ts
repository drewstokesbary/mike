import type {
  ContentBlock,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";

export type WebCitation = {
  type: "citation_data";
  kind: "web";
  ref: number;
  title: string;
  url: string;
  cited_text: string;
};

export const ANTHROPIC_WEB_TOOLS: ToolUnion[] = [
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 8,
    user_location: {
      type: "approximate",
      region: "Washington",
      country: "US",
      timezone: "America/Los_Angeles",
    },
  },
  {
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: 8,
    max_content_tokens: 50_000,
    citations: { enabled: true },
  },
];

export function serverToolName(block: ContentBlock): "web_search" | "web_fetch" | null {
  if (block.type !== "server_tool_use") return null;
  if (block.name === "web_search" || block.name === "web_fetch") return block.name;
  return null;
}

export function extractWebCitations(
  blocks: ContentBlock[],
  existing: WebCitation[] = [],
): WebCitation[] {
  const bySource = new Map(existing.map((citation) => [citation.url, citation]));
  for (const block of blocks) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location") continue;
      const prior = bySource.get(citation.url);
      if (prior) {
        if (!prior.cited_text && citation.cited_text) prior.cited_text = citation.cited_text;
        continue;
      }
      bySource.set(citation.url, {
        type: "citation_data",
        kind: "web",
        ref: bySource.size + 1,
        title: citation.title?.trim() || new URL(citation.url).hostname,
        url: citation.url,
        cited_text: citation.cited_text,
      });
    }
  }
  return Array.from(bySource.values());
}
