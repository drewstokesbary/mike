import { checkProjectAccess } from "./access";
import type { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type MoveChatResult =
  | { ok: true; chat: { id: string; project_id: string | null } }
  | { ok: false; status: 404; detail: string }
  | { ok: false; status: 500; detail: string };

/**
 * Move a creator-owned chat to another accessible project, or back to the
 * general assistant. Keeping this rule here prevents route/UI callers from
 * independently reimplementing the visibility boundary.
 */
export async function moveOwnedChat(
  chatId: string,
  projectId: string | null,
  userId: string,
  userEmail: string | null | undefined,
  db: Db,
): Promise<MoveChatResult> {
  const { data: chat, error: chatError } = await db
    .from("chats")
    .select("id, user_id, project_id")
    .eq("id", chatId)
    .maybeSingle();

  if (chatError) return { ok: false, status: 500, detail: chatError.message };
  if (!chat || chat.user_id !== userId) {
    return { ok: false, status: 404, detail: "Chat not found" };
  }

  if (projectId) {
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok) {
      return { ok: false, status: 404, detail: "Project not found" };
    }
  }

  const { data: updated, error: updateError } = await db
    .from("chats")
    .update({ project_id: projectId })
    .eq("id", chatId)
    .eq("user_id", userId)
    .select("id, project_id")
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, detail: updateError.message };
  }
  if (!updated) return { ok: false, status: 404, detail: "Chat not found" };

  return {
    ok: true,
    chat: { id: updated.id as string, project_id: updated.project_id ?? null },
  };
}
