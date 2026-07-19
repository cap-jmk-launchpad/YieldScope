import type { CSSProperties } from "react";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

const FEATURED_BLOG_SLUGS = [
  "why-earn-only-beats-balance-sheets-for-monthly-rewards-questions",
  "proof-not-screenshots-earningscheckpoint-on-monad",
  "phase-1-scope-honesty-binance-okx-monad-lunc-and-nothing-else-yet",
] as const;

const HOW_STEPS = [
  {
    n: "01",
    title: "Connect",
    body: "Sign in, add read-only Binance and OKX keys, connect a Monad wallet, and paste your Terra Classic address for LUNC — scoped credentials, not trading keys.",
  },
  {
    n: "02",
    title: "Sync",
    body: "Pull earn-only history into one ledger. Choose all-time or a custom window. Each source reports ok, error, or not connected — broken adapters never invent rows.",
  },
  {
    n: "03",
    title: "Attest",
    body: "Optionally post a Merkle-style root of the sync window to EarningsCheckpoint on Monad. Explorers can verify the hash — proof, not screenshots.",
  },
] as const;

const SOURCES = [
  {
    name: "Binance",
    detail: "Simple Earn rewards and interest history",
  },
  {
    name: "OKX",
    detail: "Savings / Simple Earn interest and Auto Earn streams",
  },
  {
    name: "Monad",
    detail: "Unclaimed rewards from validators you’re delegated to",
  },
  {
    name: "LUNC",
    detail: "Terra Classic claimed and pending stake rewards",
  },
] as const;

export default function HomePage() {
  const posts = listBlogPosts();
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const featured = FEATURED_BLOG_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (p): p is NonNullable<typeof p> => Boolean(p)
  );
  const blogFallback =
    featured.length > 0 ? featured : posts.slice(0, 3);

  return (
    <main className="landing">
      <div className="landing-grain" aria-hidden />
      <div className="landing-scan" aria-hidden />

      <header className="landing-top">
        <span className="landing-top-mark">
          <img
            src="/yieldscope-mark.svg"
            alt=""
            width={22}
            height={22}
            className="landing-mark-icon"
          />
          YieldScope
        </span>
        <nav className="landing-top-nav" aria-label="Primary">
          <a href="#problem">Problem</a>
          <a href="#how">How</a>
          <a href="#sources">Sources</a>
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/register" className="landing-top-cta">
            Register
          </Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-brand">
        <div className="landing-pulse" aria-hidden />
        <div className="landing-hero-plane" aria-hidden />
        <div className="landing-hero-copy">
          <h1 id="landing-brand" className="landing-brand">
            YieldScope
          </h1>
          <p className="landing-headline">Solving scattered rewards.</p>
          <p className="landing-support">
            Track all your crypto rewards in one place — Binance Simple Earn,
            OKX savings, Monad staking, and LUNC — then attest a checkpoint on
            Monad so the number is portable.
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

      <section
        className="landing-band landing-problem"
        id="problem"
        aria-labelledby="problem-heading"
      >
        <div className="landing-band-inner">
          <h2 id="problem-heading">Rewards live in four places.</h2>
          <p className="landing-lead">
            Binance Earn stays in Binance. OKX Earn stays in OKX. Monad staking
            rewards sit onchain. LUNC stake rewards sit somewhere else again.
            Answering “what did I make this month?” still means three apps and a
            spreadsheet — and a number nobody else can verify.
          </p>
          <p className="landing-aside">
            Portfolio apps show balances. Tax suites want every transfer. Neither
            answers the earn-only question with a ledger you can trust.
          </p>
        </div>
      </section>

      <section
        className="landing-band landing-how"
        id="how"
        aria-labelledby="how-heading"
      >
        <div className="landing-band-inner landing-band-wide">
          <h2 id="how-heading">How it works</h2>
          <p className="landing-lead">
            One path from scattered streams to a single earn-only ledger — and an
            optional onchain checkpoint.
          </p>
          <ol className="landing-how-list">
            {HOW_STEPS.map((step, i) => (
              <li
                key={step.n}
                className="landing-how-step"
                style={{ "--i": i } as CSSProperties}
              >
                <span className="landing-how-n" aria-hidden>
                  {step.n}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="landing-band landing-sources-band"
        id="sources"
        aria-labelledby="sources-heading"
      >
        <div className="landing-band-inner landing-band-wide">
          <h2 id="sources-heading">Phase 1 sources</h2>
          <p className="landing-lead">
            Depth over breadth. These four streams ship now — not every chain,
            not a DeFi portfolio tracker, not a tax suite.
          </p>
          <ul className="landing-sources">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <em>{s.detail}</em>
              </li>
            ))}
          </ul>
          <p className="landing-note">
            More chains later, after Phase 1 is green. Marketing may say
            “rewards”; the product stays earn-accurate.
          </p>
          <p className="landing-request-cta">
            <Link href="/app/connect#request-chain" className="landing-request-link">
              Request a chain
            </Link>
            <span>
              — tell us which network or earn source you want next (sign in
              required).
            </span>
          </p>
        </div>
      </section>

      <section
        className="landing-band landing-checkpoint"
        id="checkpoint"
        aria-labelledby="checkpoint-heading"
      >
        <div className="landing-band-inner landing-band-wide landing-checkpoint-grid">
          <div>
            <h2 id="checkpoint-heading">Proof on Monad</h2>
            <p className="landing-lead">
              After you sync, attest a Merkle-style root of your earnings window
              to <code>EarningsCheckpoint</code>. The total becomes
              explorer-verifiable — a portable checkpoint for what you actually
              earned.
            </p>
            <p className="landing-aside">
              Fail-closed by design: sources show ok, error, or not connected.
              Broken adapters never invent earn rows just to fill a chart.
            </p>
          </div>
          <figure className="landing-hash" aria-label="Example checkpoint hash">
            <figcaption>EarningsCheckpoint · sample root</figcaption>
            <code>
              0x7a3f…c91e
              <br />
              merkle · sync window
              <br />
              chain id 143
            </code>
          </figure>
        </div>
      </section>

      <section
        className="landing-band landing-blog"
        id="blog"
        aria-labelledby="blog-heading"
      >
        <div className="landing-band-inner landing-band-wide">
          <div className="landing-blog-head">
            <h2 id="blog-heading">From the ledger</h2>
            <Link href="/blog" className="landing-blog-all">
              All posts
            </Link>
          </div>
          <p className="landing-lead">
            Notes on scattered rewards, earn-only ledgers, and onchain
            checkpoints — written in YieldScope’s voice.
          </p>
          <ul className="landing-blog-list">
            {blogFallback.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`}>
                  <span className="landing-blog-title">{post.title}</span>
                  {post.description ? (
                    <span className="landing-blog-desc">{post.description}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="landing-band landing-close"
        aria-labelledby="close-heading"
      >
        <div className="landing-band-inner">
          <h2 id="close-heading">One place for what you earned.</h2>
          <p className="landing-lead">
            Sync the Phase 1 streams that work. Show only real data. Attest a
            root on Monad when you want the number to travel.
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

      <footer className="landing-foot">
        <span>yieldscope.d3bu7.com</span>
        <nav className="landing-foot-nav" aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <Link href="/docs/connect">Connect guide</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/app/connect#request-chain">Request a chain</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Register</Link>
        </nav>
      </footer>
    </main>
  );
}
