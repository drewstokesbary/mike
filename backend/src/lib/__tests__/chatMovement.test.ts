import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveOwnedChat } from "../chatMovement";
import { checkProjectAccess } from "../access";

vi.mock("../access", () => ({ checkProjectAccess: vi.fn() }));

function query(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  return chain;
}

function dbWith(...queries: ReturnType<typeof query>[]) {
  return {
    from: vi.fn(() => queries.shift()),
  } as never;
}

describe("moveOwnedChat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the creator's chat into an accessible project", async () => {
    vi.mocked(checkProjectAccess).mockResolvedValue({
      ok: true,
      isOwner: false,
      project: { id: "p2", user_id: "u2", shared_with: ["u1@test.local"] },
    });
    const db = dbWith(
      query({
        data: { id: "c1", user_id: "u1", project_id: null },
        error: null,
      }),
      query({ data: { id: "c1", project_id: "p2" }, error: null }),
    );

    const result = await moveOwnedChat("c1", "p2", "u1", "u1@test.local", db);

    expect(result).toEqual({ ok: true, chat: { id: "c1", project_id: "p2" } });
    expect(checkProjectAccess).toHaveBeenCalledWith(
      "p2",
      "u1",
      "u1@test.local",
      db,
    );
  });

  it("moves the creator's chat back to the general assistant", async () => {
    const db = dbWith(
      query({
        data: { id: "c1", user_id: "u1", project_id: "p1" },
        error: null,
      }),
      query({ data: { id: "c1", project_id: null }, error: null }),
    );

    const result = await moveOwnedChat("c1", null, "u1", null, db);

    expect(result).toEqual({ ok: true, chat: { id: "c1", project_id: null } });
    expect(checkProjectAccess).not.toHaveBeenCalled();
  });

  it("does not allow a collaborator to move somebody else's chat", async () => {
    const db = dbWith(
      query({
        data: { id: "c1", user_id: "u2", project_id: "p1" },
        error: null,
      }),
    );

    expect(await moveOwnedChat("c1", null, "u1", null, db)).toEqual({
      ok: false,
      status: 404,
      detail: "Chat not found",
    });
  });

  it("rejects a destination the creator cannot access", async () => {
    vi.mocked(checkProjectAccess).mockResolvedValue({ ok: false });
    const db = dbWith(
      query({
        data: { id: "c1", user_id: "u1", project_id: null },
        error: null,
      }),
    );

    expect(await moveOwnedChat("c1", "p2", "u1", null, db)).toEqual({
      ok: false,
      status: 404,
      detail: "Project not found",
    });
  });
});
