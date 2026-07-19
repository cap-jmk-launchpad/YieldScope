import { getBlogPost } from "@/lib/blog";
import { OG_CONTENT_TYPE, OG_SIZE, yieldScopeOgImage } from "@/lib/og-image";

export const alt = "YieldScope blog";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

type Props = { params: Promise<{ slug: string }> };

export default async function BlogOpenGraphImage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) {
    return yieldScopeOgImage();
  }
  return yieldScopeOgImage({
    title: "YieldScope",
    eyebrow: "Blog",
    subtitle: post.title,
  });
}
