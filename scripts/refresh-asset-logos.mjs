#!/usr/bin/env node
/**
 * Refresh vendored token logos under web/public/assets/tokens/.
 *
 * Primary source: spothq/cryptocurrency-icons @ 0.18.1 (CC0) via jsDelivr.
 * Fallbacks: cryptologos.cc for BUSD / FDUSD / USDE.
 * Custom: MON / LUNC / USTC (inline SVG — not on cryptocurrency-icons).
 *
 * Usage (repo root):
 *   node scripts/refresh-asset-logos.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "web", "public", "assets", "tokens");

const CDN =
  "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

/** @type {Record<string, string[]>} slug → candidate URLs (first success wins) */
const SOURCES = {
  btc: [`${CDN}/btc.svg`],
  eth: [`${CDN}/eth.svg`],
  usdt: [`${CDN}/usdt.svg`],
  usdc: [`${CDN}/usdc.svg`],
  dai: [`${CDN}/dai.svg`],
  tusd: [`${CDN}/tusd.svg`],
  usd: [`${CDN}/usd.svg`],
  eur: [`${CDN}/eur.svg`],
  gbp: [`${CDN}/gbp.svg`],
  jpy: [`${CDN}/jpy.svg`],
  bnb: [`${CDN}/bnb.svg`],
  sol: [`${CDN}/sol.svg`],
  xrp: [`${CDN}/xrp.svg`],
  ada: [`${CDN}/ada.svg`],
  doge: [`${CDN}/doge.svg`],
  link: [`${CDN}/link.svg`],
  avax: [`${CDN}/avax.svg`],
  dot: [`${CDN}/dot.svg`],
  atom: [`${CDN}/atom.svg`],
  trx: [`${CDN}/trx.svg`],
  matic: [`${CDN}/matic.svg`],
  generic: [`${CDN}/generic.svg`],
  busd: [
    "https://cryptologos.cc/logos/binance-usd-busd-logo.svg",
  ],
  fdusd: [
    "https://cryptologos.cc/logos/first-digital-usd-fdusd-logo.svg",
  ],
  usde: [
    "https://cryptologos.cc/logos/ethena-usde-usde-logo.svg",
  ],
};

const CUSTOM = {
  mon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#836EF9"/><path fill="#fff" d="M9.2 21.5V10.5h2.4l3.2 7.1 3.2-7.1h2.4v11H18v-7.2l-2.6 5.6h-1.6L11.2 14.3v7.2H9.2z"/></svg>`,
  lunc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#172852"/><path fill="#F4D03F" d="M16 6.5c.4 3.2 2.3 5.8 5.2 7.5-2.9 1.7-4.8 4.3-5.2 7.5-.4-3.2-2.3-5.8-5.2-7.5 2.9-1.7 4.8-4.3 5.2-7.5z"/><circle cx="16" cy="16" r="2.2" fill="#F4D03F"/></svg>`,
  ustc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#5493F7"/><path fill="#fff" d="M10 11.2h12v2.2h-4.7V22h-2.6V13.4H10v-2.2z"/></svg>`,
};

async function fetchSvg(url) {
  const res = await fetch(url, {
    headers: { Accept: "image/svg+xml,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("<svg")) throw new Error("not SVG");
  if (text.length < 80) throw new Error("too small");
  return text;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let ok = 0;
  let fail = 0;

  for (const [slug, urls] of Object.entries(SOURCES)) {
    let written = false;
    for (const url of urls) {
      try {
        const svg = await fetchSvg(url);
        await writeFile(path.join(OUT, `${slug}.svg`), svg, "utf8");
        console.log(`  ok  ${slug}.svg  (${svg.length} B)  ← ${url}`);
        ok += 1;
        written = true;
        break;
      } catch (err) {
        console.warn(`  miss ${slug} @ ${url}: ${err.message}`);
      }
    }
    if (!written) fail += 1;
  }

  for (const [slug, svg] of Object.entries(CUSTOM)) {
    await writeFile(path.join(OUT, `${slug}.svg`), svg, "utf8");
    console.log(`  ok  ${slug}.svg  (${svg.length} B)  ← custom`);
    ok += 1;
  }

  console.log(`\nDone — ${ok} written, ${fail} failed → ${OUT}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
