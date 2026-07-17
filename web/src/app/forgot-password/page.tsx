import { Suspense } from "react";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import "@/app/app.css";

export default function ForgotPasswordPage() {
  return (
    <div className="auth-shell">
      <Link href="/" className="auth-brand">
        YieldScope
      </Link>
      <Suspense fallback={<p className="lede">Loading…</p>}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
