import { redirect } from "next/navigation";

// Team management lives in Settings now
export default function AdminPage() {
  redirect("/?settings=team");
}
