import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogPost, listBlogPosts } from "@/lib/blog";
import { renderBlogMarkdown } from "@/lib/blog-markdown";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return listBlogPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post — YieldScope" };
  return {
    title: `${post.title} — YieldScope`,
    description: post.description,
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
