import { redirect } from "next/navigation";

/** Default (app) route redirects to /books. */
export default function AppRoot() {
  redirect("/books");
}
