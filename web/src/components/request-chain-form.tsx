"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type PriorRequest = {
  id: string;
  chainName: string;
  why: string | null;
  createdAt: string;
};

/**
 * Authenticated form to request chains beyond Phase 1.
 * Prefills contact email from the signed-in session when available.
 */
export function RequestChainForm({
  variant = "panel",
}: {
  variant?: "panel" | "compact";
}) {
  const [chainName, setChainName] = useState("");
  const [why, setWhy] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [emailReady, setEmailReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prior, setPrior] = useState<PriorRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!isSupabaseConfigured()) {
        if (!cancelled) setEmailReady(true);
        return;
      }
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled && data.user?.email) {
          setContactEmail(data.user.email);
        }
      } catch {
        /* ignore — email stays empty */
      } finally {
        if (!cancelled) setEmailReady(true);
      }

      try {
        const res = await fetch("/api/chain-requests");
        const json = (await res.json()) as {
          requests?: PriorRequest[];
          error?: string;
        };
        if (cancelled || !res.ok) return;
        if (json.requests?.length) setPrior(json.requests.slice(0, 5));
      } catch {
        /* optional prior list — ignore */
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/chain-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainName,
          why: why.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        id?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not save your request.");
        return;
      }
      setMessage(json.message ?? "Thanks — we logged your chain request.");
      const submittedName = chainName.trim();
      setChainName("");
      setWhy("");
      setPrior((prev) => [
        {
          id: json.id ?? `local-${Date.now()}`,
          chainName: submittedName,
          why: why.trim() || null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 5));
    } catch {
      setError("Could not save your request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      id="request-chain"
      className={
        variant === "compact"
          ? "request-chain request-chain--compact"
          : "request-chain"
      }
      onSubmit={(e) => void onSubmit(e)}
      aria-labelledby="request-chain-heading"
    >
      <h2 id="request-chain-heading">Request a chain</h2>
      <p className="lede">
        Phase 1 covers Binance, OKX, Monad, and LUNC. Tell us which network or
        earn source you want next — we track requests; we do not promise a
        timeline.
      </p>

      <label>
        Chain or network name
        <input
          value={chainName}
          onChange={(e) => setChainName(e.target.value)}
          placeholder="e.g. Ethereum, Base, Solana"
          required
          maxLength={120}
          autoComplete="off"
          disabled={submitting}
        />
      </label>

      <label>
        Why / earn type{" "}
        <span className="optional">(optional)</span>
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Staking rewards, liquid restaking, CEX earn…"
          maxLength={1000}
          rows={3}
          disabled={submitting}
        />
      </label>

      <label>
        Contact email <span className="optional">(optional)</span>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={emailReady ? "you@example.com" : "Loading…"}
          maxLength={320}
          autoComplete="email"
          disabled={submitting}
        />
      </label>

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? "Sending…" : "Submit request"}
      </button>

      {message ? (
        <p className="ok" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="err" role="alert">
          {error}{" "}
          {error.toLowerCase().includes("sign in") ? (
            <Link href="/login?next=/app/connect%23request-chain">Sign in</Link>
          ) : null}
        </p>
      ) : null}

      {prior.length > 0 ? (
        <div className="request-chain-prior" aria-label="Your recent requests">
          <h3>Already requested</h3>
          <ul>
            {prior.map((r) => (
              <li key={r.id}>
                <span>{r.chainName}</span>
                <time dateTime={r.createdAt}>
                  {new Date(r.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
