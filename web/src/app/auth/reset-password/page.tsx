import { Suspense } from "react";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import "@/app/app.css";

export default function ResetPasswordPage() {
  return (
    <div className="auth-shell">
      <Link href="/" className="auth-brand">
        YieldScope
      </Link>
      <Suspense fallback={<p className="lede">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
