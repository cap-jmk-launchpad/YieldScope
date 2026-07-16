import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import "@/app/app.css";

export default function LoginPage() {
  return (
    <div className="auth-shell">
      <Link href="/" className="auth-brand">
        YieldScope
      </Link>
      <Suspense fallback={<p className="lede">Loading…</p>}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
