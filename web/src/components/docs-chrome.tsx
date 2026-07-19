import Link from "next/link";
import type { ReactNode } from "react";

export function DocsChrome({
  children,
  active = "index",
}: {
  children: ReactNode;
  active?: "index" | "connect";
}) {
  return (
    <main className="docs-page">
      <div className="docs-grain" aria-hidden />
      <header className="docs-top">
        <Link href="/" className="docs-top-mark">
          <img
            src="/yieldscope-mark.svg"
            alt=""
            width={22}
            height={22}
            className="landing-mark-icon"
          />
          YieldScope
        </Link>
        <nav className="docs-top-nav" aria-label="Docs">
          <Link
            href="/docs"
            className={active === "index" ? "docs-nav-active" : undefined}
          >
            Docs
          </Link>
          <Link
            href="/docs/connect"
            className={active === "connect" ? "docs-nav-active" : undefined}
          >
            Connect
          </Link>
          <Link href="/blog">Blog</Link>
          <Link href="/register" className="docs-top-cta">
            Get started
          </Link>
        </nav>
      </header>
      {children}
      <footer className="docs-foot">
        <span>yieldscope.d3bu7.com</span>
        <nav className="docs-foot-nav" aria-label="Footer">
          <Link href="/">Home</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/app/connect">Connect sources</Link>
        </nav>
      </footer>
    </main>
  );
}
