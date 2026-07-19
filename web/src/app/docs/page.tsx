import type { Metadata } from "next";
import Link from "next/link";
import { DocsChrome } from "@/components/docs-chrome";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Guides for connecting exchanges and wallets, syncing earn history, and using YieldScope.",
  openGraph: {
    title: "Docs — YieldScope",
    description:
      "Guides for connecting exchanges and wallets, syncing earn history, and using YieldScope.",
    url: "/docs",
    siteName: "YieldScope",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Docs — YieldScope",
    description:
      "Guides for connecting exchanges and wallets, syncing earn history, and using YieldScope.",
  },
};

const GUIDES = [
  {
    href: "/docs/connect",
    title: "Connect wallets and exchanges",
    description:
      "Binance and OKX read-only keys, Phantom on Monad mainnet, Terra Classic addresses, sync modes, and fail-closed status.",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <DocsChrome active="index">
      <section className="docs-hero">
        <p className="docs-kicker">Guides</p>
        <h1>Docs</h1>
        <p className="docs-lead">
          How to connect Phase 1 sources and sync earn-only rewards into one
          ledger — without inventing rows when something fails.
        </p>
      </section>

      <ul className="docs-guide-list">
        {GUIDES.map((g) => (
          <li key={g.href}>
            <Link href={g.href}>
              <span className="docs-guide-title">{g.title}</span>
              <span className="docs-guide-desc">{g.description}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="docs-aside-band">
        <p>
          Live app:{" "}
          <a href="https://yieldscope.d3bu7.com">yieldscope.d3bu7.com</a>
          . Phase 1 covers Binance Simple Earn, OKX savings, Monad staking, and
          LUNC — not every chain yet.
        </p>
      </section>
    </DocsChrome>
  );
}
