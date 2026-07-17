import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <div className="landing-grain" aria-hidden />
      <div className="landing-scan" aria-hidden />

      <header className="landing-top">
        <span className="landing-top-mark">YieldScope</span>
        <nav className="landing-top-nav">
          <a href="#how">How</a>
          <a href="#sources">Sources</a>
          <Link href="/register">Register</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-pulse" aria-hidden />
        <div className="landing-hero-plane" aria-hidden />
        <div className="landing-hero-copy">
          <h1 className="landing-brand">YieldScope</h1>
          <p className="landing-headline">
            What you actually earned — one ledger.
          </p>
          <p className="landing-support">
            Sync Binance Simple Earn, OKX savings, Monad staking, and LUNC
            stake rewards. Attest a checkpoint on Monad so the number is portable.
          </p>
          <div className="landing-ctas">
            <Link href="/register" className="btn-cta landing-cta">
              Get started
            </Link>
            <Link href="/login" className="btn-ghost landing-cta-ghost">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-section" id="how">
        <h2>How it works</h2>
        <p>
          Sign in, paste read-only exchange keys, connect a Monad wallet, sync
          real reward history, then post a Merkle root to{" "}
          <code>EarningsCheckpoint</code> on Monad testnet. Broken sources show
          error — never placeholder rows.
        </p>
      </section>

      <section className="landing-section" id="sources">
        <h2>Phase 1 sources</h2>
        <ul className="landing-sources">
          <li>
            <span>Binance</span> Simple Earn rewards
          </li>
          <li>
            <span>OKX</span> Savings / earn history
          </li>
          <li>
            <span>Monad</span> Staking via precompile 0x1000
          </li>
          <li>
            <span>LUNC</span> Terra Classic pending stake rewards
          </li>
        </ul>
        <p className="landing-note">
          More chains (ETH, Lido, Base, …) are Phase 2 — not claimed here.
        </p>
      </section>

      <section className="landing-section" id="checkpoint">
        <h2>Onchain checkpoint</h2>
        <p>
          After a sync window, attest the ledger root so explorers can verify
          the commitment — proof, not screenshots.
        </p>
      </section>

      <footer className="landing-foot">
        <span>yieldscope.d3bu7.com</span>
        <span>Built test-first for Spark</span>
      </footer>
    </main>
  );
}
