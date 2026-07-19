# Brand icons (Connect / source strip)

Favicon-style marks for Phase 1 venues. Served from Supabase Storage when available,
with a local fallback under `web/public/brands/`.

## Slugs

| Slug | Brand | Section | Source |
|------|-------|---------|--------|
| `binance` | Binance | Exchanges | [Simple Icons — Binance](https://simpleicons.org/icons/binance) (`#F0B90B`) |
| `okx` | OKX | Exchanges | [Simple Icons — OKX](https://simpleicons.org/icons/okx) (white on ink) |
| `monad` | Monad | Wallets | Monad brand purple `#836EF9` ([brand kit](https://www.monad.xyz/brand-and-media-kit)) |
| `terra` | Terra Classic / LUNC | Wallets | Terra Classic gold moon (same mark as token `lunc`) |

## Public URLs (Supabase)

Bucket: `brand-icons`  
Base: `https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/brand-icons/{slug}.svg`

Examples:

- https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/brand-icons/binance.svg
- https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/brand-icons/okx.svg
- https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/brand-icons/monad.svg
- https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/brand-icons/terra.svg

Local fallback: `/brands/{slug}.svg`

## Upload

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"
bash deploy/scripts/upload-brand-icons.sh
```
