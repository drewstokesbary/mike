import { describe, expect, it } from "vitest";
import {
  endsWithUnperformedToolIntent,
  incompleteResponseReason,
} from "./claude";

describe("Claude stalled tool-intent detection", () => {
  it.each([
    "I'll conduct the final review now. Let me read the v2.5 PDF in full.",
    "Let me search CourtListener for that case.",
    "I will now inspect the attached agreement",
  ])("detects an announced action that terminates the response: %s", (text) => {
    expect(endsWithUnperformedToolIntent(text)).toBe(true);
  });

  it.each([
    "I reviewed the agreement and found three inconsistencies.",
    "You can ask me to review the agreement later.",
    "Let me know if you want a more detailed analysis.",
    "First I will review the definitions. Then I will summarize the conflicts and provide recommendations.",
  ])("does not continue an ordinary response: %s", (text) => {
    expect(endsWithUnperformedToolIntent(text)).toBe(false);
  });
});

describe("Claude incomplete response detection", () => {
  it("continues when adaptive thinking exhausts the output allowance", () => {
    expect(
      incompleteResponseReason({
        stopReason: "max_tokens",
        turnText: "",
        completedToolRounds: 1,
      }),
    ).toBe("max_tokens");
  });

  it("continues an empty end_turn after a tool result", () => {
    expect(
      incompleteResponseReason({
        stopReason: "end_turn",
        turnText: "",
        completedToolRounds: 1,
      }),
    ).toBe("empty_after_tools");
  });

  it.each([
    {
      stopReason: "end_turn",
      turnText: "Final answer",
      completedToolRounds: 1,
    },
    { stopReason: "end_turn", turnText: "", completedToolRounds: 0 },
    { stopReason: "tool_use", turnText: "", completedToolRounds: 1 },
  ])("accepts a complete or still-active turn: %o", (args) => {
    expect(incompleteResponseReason(args)).toBeNull();
  });
});
