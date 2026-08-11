import { redirect } from "next/navigation";

/** The board moved to /machines — this route only forwards old links. */
export default function LegacyRoutingPage() {
  redirect("/machines");
}
