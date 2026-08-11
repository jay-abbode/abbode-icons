import { redirect } from "next/navigation";

/** Room lists live at /webster/room/[id] now — this route only forwards. */
export default function LegacyRoomPage({ params }: { params: { id: string } }) {
  redirect(`/webster/room/${params.id}`);
}
