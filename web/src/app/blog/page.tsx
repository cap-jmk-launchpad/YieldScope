import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Notes on scattered crypto rewards, CeFi earn ledgers, and Monad attestation.",
  openGraph: {
    title: "Blog — YieldScope",
    description:
      "Notes on scattered crypto rewards, CeFi earn ledgers, and Monad attestation.",
    url: "/blog",
    siteName: "YieldScope",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "YieldScope — Solving scattered rewards",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog — YieldScope",
    description:
      "Notes on scattered crypto rewards, CeFi earn ledgers, and Monad attestation.",
    images: ["/twitter-image"],
  },
};

export default function BlogIndexPage() {
  const posts = listBlogPosts();

  return (
    <main className="blog-page">
      <header className="blog-top">
        <Link href="/" className="blog-top-mark">
          YieldScope
        </Link>
        <nav className="blog-top-nav">
          <Link href="/">Home</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/register">Get started</Link>
        </nav>
      </header>

      <section className="blog-hero">
        <h1>Blog</h1>
        <p>
          Scattered rewards, earn-only ledgers, and onchain checkpoints — written
          in YieldScope’s voice.
        </p>
      </section>

      <ul className="blog-list">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`}>
              <span className="blog-list-title">{post.title}</span>
              {post.description ? (
                <span className="blog-list-desc">{post.description}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
