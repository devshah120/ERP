import { redirect } from "next/navigation";

/** The workspace is the front door; an unauthenticated visit is sent on to sign-in from there. */
export default function RootPage() {
  redirect("/dashboard");
}
