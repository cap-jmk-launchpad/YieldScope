---
title: "Fail-closed source chips: why broken adapters must not invent rows"
description: "ok, error, and not_connected — the status model that keeps a rewards ledger trustworthy."
primaryKeyword: "fail-closed crypto earn sync"
source: "brand-pipeline"
---

# Fail-closed source chips: why broken adapters must not invent rows

## The failure mode that destroys trust

A rewards dashboard that shows `$0 earned` when the API timed out teaches users the wrong lesson. Silent zeros look like “I earned nothing.” They are often “we could not read the venue.”

## YieldScope’s three states

| Chip | Meaning |
|------|---------|
| `ok` | Sync completed; rows reflect what the adapter could prove |
| `error` | Sync failed or streams contradict (e.g. OKX principal with empty interest streams) |
| `not_connected` | No credentials / wallet / address for that source |

Broken adapters **never invent** earn rows. Empty history after a successful read is different from an error — and the UI must not conflate them.

## Why this fits scattered rewards

When rewards are already hard to see across Binance, OKX, Monad, and LUNC, the ledger’s job is to be a checkpoint of truth — not a soothing fiction. Fail-closed chips are part of the Sage/Everyman voice: direct, trustworthy, slightly technical.

## Operator habit

If a chip is `error`, fix keys or re-download history before attesting. Checkpointing a bad window only proves a bad window.
