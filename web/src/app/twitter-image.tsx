import { OG_CONTENT_TYPE, OG_SIZE, yieldScopeOgImage } from "@/lib/og-image";

export const alt = "YieldScope — Solving scattered rewards";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function TwitterImage() {
  return yieldScopeOgImage();
}
