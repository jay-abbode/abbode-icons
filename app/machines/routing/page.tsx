import { redirect } from "next/navigation";

/** The Webster board lives at /webster now — this route only forwards. */
export default function LegacyRoutingPage() {
  redirect("/webster");
}
