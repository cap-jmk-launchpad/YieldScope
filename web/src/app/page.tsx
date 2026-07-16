import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <header className="top">
        <span className="wordmark">YieldScope</span>
        <Link href="/app" className="top-link">
          Open app
        </Link>
      </header>

      <section className="hero">
        <div className="atmosphere" aria-hidden />
        <div className="hero-copy">
          <h1 className="brand">YieldScope</h1>
          <p className="headline">What you actually earned — one ledger.</p>
          <p className="support">
            Sync Binance Simple Earn, OKX savings, and Monad staking. Attest a
            checkpoint on Monad so the number is portable.
          </p>
          <div className="ctas">
            <Link href="/app/connect" className="btn-cta">
              Connect sources
            </Link>
            <Link href="/app" className="btn-ghost">
              View ledger
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <h2>How it works</h2>
        <p>
          Connect earn venues, sync real reward history, then post a Merkle root
          to <code>EarningsCheckpoint</code> on Monad testnet. Broken sources
          show error — never placeholder rows.
        </p>
      </section>

      <section className="section" id="sources">
        <h2>Phase 1 sources</h2>
        <ul>
          <li>Binance Simple Earn</li>
          <li>OKX savings / earn history</li>
          <li>Monad staking precompile (0x1000)</li>
        </ul>
        <p className="note">
          More chains (ETH, Lido, Base, …) are Phase 2 — not claimed here.
        </p>
      </section>

      <section className="section" id="checkpoint">
        <h2>Onchain checkpoint</h2>
        <p>
          After a sync window, attest the ledger root so explorers can verify
          the commitment — proof, not screenshots.
        </p>
        <Link href="/app/attest" className="btn-ghost">
          Attest
        </Link>
      </section>

      <footer className="foot">
        <span>yieldscope.d3bu7.com</span>
        <span>Built test-first for Spark</span>
      </footer>

      <style>{`
        .landing {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(165deg, #05080f 0%, #0c1524 55%, #071018 100%);
          position: relative;
        }
        .landing::before {
          content: "";
          pointer-events: none;
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(232, 238, 246, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(232, 238, 246, 0.03) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: linear-gradient(to bottom, black 0%, transparent 70%);
          opacity: 0.5;
        }
        .top {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.75rem;
        }
        .wordmark {
          font-family: var(--font-display);
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .top-link {
          color: var(--muted);
          text-decoration: none;
          font-size: 0.9rem;
        }
        .top-link:hover {
          color: var(--mint);
        }
        .hero {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - 4rem);
          display: flex;
          align-items: center;
          padding: 2rem 1.75rem 4rem;
        }
        .atmosphere {
          position: absolute;
          width: min(70vw, 520px);
          height: min(70vw, 520px);
          left: 50%;
          top: 42%;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(61, 255, 168, 0.18) 0%, transparent 68%);
          animation: pulse 8s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.9; transform: translate(-50%, -50%) scale(1.06); }
        }
        .hero-copy {
          position: relative;
          max-width: 40rem;
        }
        .brand {
          font-family: var(--font-display);
          font-size: clamp(3rem, 10vw, 5.5rem);
          line-height: 0.95;
          letter-spacing: -0.04em;
          margin: 0 0 1rem;
          animation: rise 0.65s ease-out both;
        }
        .headline {
          font-family: var(--font-display);
          font-size: clamp(1.25rem, 3vw, 1.75rem);
          font-weight: 600;
          margin: 0 0 0.75rem;
          color: var(--paper);
          animation: rise 0.65s ease-out 0.08s both;
        }
        .support {
          color: var(--muted);
          font-size: 1.05rem;
          line-height: 1.55;
          margin: 0 0 1.75rem;
          max-width: 34rem;
          animation: rise 0.65s ease-out 0.14s both;
        }
        .ctas {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          animation: rise 0.65s ease-out 0.2s both;
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .section {
          position: relative;
          z-index: 1;
          padding: 3.5rem 1.75rem;
          border-top: 1px solid color-mix(in oklab, var(--muted) 22%, transparent);
          max-width: 42rem;
        }
        .section h2 {
          font-family: var(--font-display);
          font-size: 1.5rem;
          margin: 0 0 0.75rem;
        }
        .section p,
        .section li {
          color: var(--muted);
          line-height: 1.55;
        }
        .section ul {
          margin: 0 0 1rem;
          padding-left: 1.1rem;
        }
        .note {
          font-size: 0.9rem;
        }
        code {
          font-family: var(--font-mono);
          font-size: 0.9em;
          color: var(--mint);
        }
        .foot {
          position: relative;
          z-index: 1;
          margin-top: auto;
          padding: 1.5rem 1.75rem;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          color: var(--muted);
          font-size: 0.8rem;
          border-top: 1px solid color-mix(in oklab, var(--muted) 22%, transparent);
        }
      `}</style>
    </main>
  );
}
