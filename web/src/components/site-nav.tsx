"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NavWalletButton } from "@/components/nav-wallet-button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function SiteNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav-brand">
        YieldScope
      </Link>
      <div className="site-nav-links">
        <Link href="/app">Dashboard</Link>
        <Link href="/app/connect">Connect</Link>
        <Link href="/app/attest">Attest</Link>
        <div className="site-nav-wallet">
          <NavWalletButton />
        </div>
        {email ? (
          <button type="button" className="site-nav-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <>
            <Link href="/register">Register</Link>
            <Link href="/login">Sign in</Link>
          </>
        )}
      </div>
    </nav>
  );
}
