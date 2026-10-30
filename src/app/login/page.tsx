import type { Metadata } from "next";
import { Suspense } from "react";
import LoginView from "@/components/login/LoginView";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // The view reads ?next= from the URL
  return (
    <Suspense fallback={null}>
      <LoginView />
    </Suspense>
  );
}
