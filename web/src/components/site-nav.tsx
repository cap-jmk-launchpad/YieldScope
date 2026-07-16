import Link from "next/link";

export function SiteNav() {
  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav-brand">
        YieldScope
      </Link>
      <div className="site-nav-links">
        <Link href="/app">Dashboard</Link>
        <Link href="/app/connect">Connect</Link>
        <Link href="/app/attest">Attest</Link>
      </div>
    </nav>
  );
}
