import { redirect } from "next/navigation";

export default function VersionRedirectPage() {
  redirect("/v");
}
