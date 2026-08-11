import { redirect } from "next/navigation";

/** The workbench is back home at /machines — this route only forwards. */
export default function LegacyConfigPage() {
  redirect("/machines");
}
