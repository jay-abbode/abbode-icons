"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { addComment } from "@/lib/comments";

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
