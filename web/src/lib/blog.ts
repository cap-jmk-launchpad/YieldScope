import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export type BlogMeta = {
  slug: string;
  title: string;
  description: string;
  primaryKeyword?: string;
  source?: string;
  body: string;
};

const CONTENT_DIR = join(process.cwd(), "content", "blog");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val) as string;
      } catch {
        val = val.slice(1, -1);
      }
    }
    meta[key] = val;
  }
  return { meta, body };
}

export function listBlogPosts(): BlogMeta[] {
  const files = readdirSync(CONTENT_DIR).filter(
    (f) => f.endsWith(".md") && f !== "index.json"
  );
  const posts: BlogMeta[] = [];
  for (const file of files) {
    const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, "");
    posts.push({
      slug,
      title: meta.title || slug,
      description: meta.description || "",
      primaryKeyword: meta.primaryKeyword,
      source: meta.source,
      body,
    });
  }
  return posts.sort((a, b) => a.title.localeCompare(b.title));
}

export function getBlogPost(slug: string): BlogMeta | null {
  return listBlogPosts().find((p) => p.slug === slug) ?? null;
}
