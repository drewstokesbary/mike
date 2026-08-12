import { describe, expect, it } from "vitest";

import {
  COURTLISTENER_TOOLS,
  COURTLISTENER_TOOL_NAMES,
} from "./courtlistenerTools.js";

describe("CourtListener tool registration", () => {
  it("presents every dispatched CourtListener tool to the model", () => {
    const registeredNames = COURTLISTENER_TOOLS.map(
      (tool) => tool.function.name,
    );

    expect(registeredNames).toEqual(
      expect.arrayContaining(Object.values(COURTLISTENER_TOOL_NAMES)),
    );
    expect(new Set(registeredNames).size).toBe(registeredNames.length);
  });

  it("requires a query and exposes the supported case-law search filters", () => {
    const searchTool = COURTLISTENER_TOOLS.find(
      (tool) => tool.function.name === COURTLISTENER_TOOL_NAMES.searchCaseLaw,
    );

    expect(searchTool?.function.parameters.required).toEqual(["query"]);
    expect(
      Object.keys(searchTool?.function.parameters.properties ?? {}),
    ).toEqual(
      expect.arrayContaining([
        "query",
        "court",
        "filedAfter",
        "filedBefore",
        "limit",
      ]),
    );
  });
});
