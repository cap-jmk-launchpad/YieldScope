# Asset token logos

Small SVG logos for YieldScope UI (`AssetIcon` / `CurrencyCell` / chart legends).

## Layout

| Path | Role |
|------|------|
| `web/public/assets/tokens/{slug}.svg` | Vendored logos (Next serves as `/assets/tokens/{slug}.svg`) |
| `web/src/lib/asset-icon.ts` | Slug aliases + URL helper |
| `scripts/refresh-asset-logos.mjs` | Re-download / regenerate logos |

Target size: **≈0.2–4 KB** per SVG (32×32 viewBox style marks).

## Deduped slugs

Aliases resolve before load (`WETH`→`eth`, `WBTC`/`BTCB`→`btc`, `LUNA`→`lunc`, `UST`→`ustc`, `POL`→`matic`).

| Slug | Tickers | Source |
|------|---------|--------|
| `btc` | BTC, WBTC, BTCB | [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) (CC0) |
| `eth` | ETH, WETH | cryptocurrency-icons |
| `usdt` | USDT | cryptocurrency-icons |
| `usdc` | USDC | cryptocurrency-icons |
| `busd` | BUSD | [cryptologos.cc](https://cryptologos.cc/coin/binance-usd/) |
| `dai` | DAI | cryptocurrency-icons |
| `tusd` | TUSD | cryptocurrency-icons |
| `fdusd` | FDUSD | cryptologos.cc |
| `usde` | USDE | cryptologos.cc |
| `usd` / `eur` / `gbp` / `jpy` | display fiats | cryptocurrency-icons |
| `bnb` `sol` `xrp` `ada` `doge` `link` `avax` `dot` `atom` `trx` `matic` | brand-palette alts | cryptocurrency-icons |
| `mon` | MON | YieldScope compact mark ([Monad brand](https://www.monad.xyz/brand-and-media-kit) colors) |
| `lunc` | LUNC, LUNA | YieldScope compact mark (Terra Classic gold moon) |
| `ustc` | USTC, UST | YieldScope compact mark |
| `generic` | unknown | cryptocurrency-icons |

## Refresh

```bash
node scripts/refresh-asset-logos.mjs
```

Optional: re-upload to Supabase Storage with `deploy/scripts/upload-asset-logos.sh` (uses these local files when present).

## Fallback

If a file is missing or fails to load, `AssetIcon` shows initials on a brand-color circle from `assetChartColor()`.
