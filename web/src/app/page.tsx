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
          <Link href="/blog">Blog</Link>
          <Link href="/register">Register</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-pulse" aria-hidden />
        <div className="landing-hero-plane" aria-hidden />
        <div className="landing-hero-copy">
          <h1 className="landing-brand">YieldScope</h1>
          <p className="landing-headline">Solving scattered rewards.</p>
          <p className="landing-support">
            Track all your crypto rewards in one place — Binance Simple Earn,
            OKX savings, Monad staking, and LUNC. Attest a checkpoint on Monad
            so the number is portable.
          </p>
          <div className="landing-ctas">
            <Link href="/register" className="btn-cta landing-cta">
              Track my rewards
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
          Sign in, connect read-only exchange keys and your wallet, sync reward
          history into one earn-only ledger, then optionally attest a checkpoint
          on Monad so explorers can verify the sync window — proof, not
          screenshots.
        </p>
      </section>

      <section className="landing-section" id="sources">
        <h2>Sources</h2>
        <ul className="landing-sources">
          <li>
            <span>Binance</span> Simple Earn rewards
          </li>
          <li>
            <span>OKX</span> Savings / earn history
          </li>
          <li>
            <span>Monad</span> Staking rewards
          </li>
          <li>
            <span>LUNC</span> Terra Classic pending stake rewards
          </li>
        </ul>
        <p className="landing-note">
          Phase 1 is depth over breadth. More chains later — not a full DeFi
          portfolio tracker, not a tax suite.
        </p>
      </section>

      <section className="landing-section" id="checkpoint">
        <h2>Onchain checkpoint</h2>
        <p>
          After you sync, attest a Merkle-style root of your earnings window on
          Monad. The total becomes explorer-verifiable — a portable checkpoint
          for what you actually earned.
        </p>
      </section>

      <footer className="landing-foot">
        <span>yieldscope.d3bu7.com</span>
        <Link href="/blog">Blog</Link>
      </footer>
    </main>
  );
}
