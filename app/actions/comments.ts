"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { addComment, deleteComment, getAllComments } from "@/lib/comments";

const STAFF_DOMAIN = (process.env.ALLOWED_DOMAIN || "shopabbode.com")
  .toLowerCase()
  .replace(/^@/, "");

export type CreateCommentInput = {
  iconSlug: string;
  iconName: string;
  iconCategory: string;
  text: string;
};

export type CreateCommentResult =
  | { ok: true }
  | { ok: false; error: string };

const MAX_LEN = 2000;

export async function createComment(
  input: CreateCommentInput
): Promise<CreateCommentResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, error: "You're not signed in." };
  }

  const text = (input.text || "").trim();
  if (!text) {
    return { ok: false, error: "Note can't be empty." };
  }
  if (text.length > MAX_LEN) {
    return { ok: false, error: `Note is too long (max ${MAX_LEN} characters).` };
  }
  if (!input.iconSlug || !input.iconName) {
    return { ok: false, error: "Missing icon details." };
  }

  try {
    await addComment({
      authorEmail: email.toLowerCase(),
      authorName: session.user?.name || email,
      iconSlug: input.iconSlug,
      iconName: input.iconName,
      iconCategory: input.iconCategory || "",
      text,
    });
  } catch (err) {
    console.error("Failed to save comment:", err);
    return {
      ok: false,
      error:
        "Couldn't save the note. The service account may not have edit access to the sheet — see setup notes.",
    };
  }

  // Tell the comments page to re-fetch next time it's loaded.
  revalidatePath("/comments");
  return { ok: true };
}

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Delete a single note. Allowed if the signed-in user is either the author
 * of the note, OR has an @<ALLOWED_DOMAIN> email (i.e. internal staff).
 */
export async function deleteCommentAction(
  timestamp: string
): Promise<DeleteCommentResult> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return { ok: false, error: "You're not signed in." };
  }
  if (!timestamp) {
    return { ok: false, error: "Missing note identifier." };
  }

  // Find the target note and verify the caller is allowed to delete it.
  let targetAuthor: string | null = null;
  try {
    const all = await getAllComments();
    const target = all.find((c) => c.timestamp === timestamp);
    if (!target) {
      return {
        ok: false,
        error: "Note not found — it may have already been deleted.",
      };
    }
    targetAuthor = (target.authorEmail || "").toLowerCase();
  } catch (err) {
    console.error("Failed to load comments for delete check:", err);
    return { ok: false, error: "Couldn't verify permissions. Try again." };
  }

  const isAuthor = targetAuthor !== null && targetAuthor === email;
  const isStaff = email.endsWith(`@${STAFF_DOMAIN}`);
  if (!isAuthor && !isStaff) {
    return {
      ok: false,
      error: "You can only delete notes you wrote yourself.",
    };
  }

  try {
    await deleteComment(timestamp);
  } catch (err) {
    console.error("Failed to delete comment:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }

  revalidatePath("/comments");
  return { ok: true };
}
