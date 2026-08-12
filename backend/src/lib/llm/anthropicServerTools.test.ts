import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import { extractWebCitations, serverToolName } from "./anthropicServerTools";

describe("Anthropic server tools", () => {
  it("recognizes web server tool calls", () => {
    expect(serverToolName({ type: "server_tool_use", id: "1", name: "web_search", input: {}, caller: { type: "direct" } })).toBe("web_search");
  });

  it("extracts and deduplicates native web citations", () => {
    const blocks = [{
      type: "text",
      text: "Answer",
      citations: [{ type: "web_search_result_location", cited_text: "authority", encrypted_index: "x", title: "Official source", url: "https://example.gov/rule" }],
    }] as ContentBlock[];
    expect(extractWebCitations(blocks)).toEqual([{
      type: "citation_data",
      kind: "web",
      ref: 1,
      title: "Official source",
      url: "https://example.gov/rule",
      cited_text: "authority",
    }]);
    expect(extractWebCitations(blocks, extractWebCitations(blocks))).toHaveLength(1);
  });
});
