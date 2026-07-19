import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogPost, listBlogPosts } from "@/lib/blog";
import { renderBlogMarkdown } from "@/lib/blog-markdown";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return listBlogPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post" };

  const title = post.title;
  const description =
    post.description ||
    "Solving scattered rewards. Track all your crypto rewards in one place";
  const url = `/blog/${slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "YieldScope",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const html = renderBlogMarkdown(post.body);

  return (
    <main className="blog-page">
      <header className="blog-top">
        <Link href="/" className="blog-top-mark">
          YieldScope
        </Link>
        <nav className="blog-top-nav">
          <Link href="/blog">Blog</Link>
          <Link href="/register">Get started</Link>
        </nav>
      </header>

      <article className="blog-article">
        <p className="blog-kicker">
          <Link href="/blog">← Blog</Link>
        </p>
        <div
          className="blog-prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </main>
  );
}
