# Close-out — closed on request; the plan is not being pursued

Closed 2026-09-03 at 9 of 43, by decision rather than by completion. Recorded here so the next reader knows it
was dropped rather than forgotten, and so the parts that DID land are accounted for.

## What is in the tree from this change

Very little, and none of it in the product:

- `packages/volt-web/app/config.js` — `COMING_SOON = true`, and a null checkout URL, so the download and buy CTAs
  render a disabled "Coming soon" control instead of a dead link. Its comments cite this change.
- The storefront copy in `volt-web`.

**There is no licensing code anywhere in `volt-cli`.** No licence key, no cached verdict, no bound-project
allowance, no Polar client — `grep` for any of it across `packages/volt-cli/src` returns nothing. The enforcement
half of the plan was never started, which is why closing it removes nothing and breaks nothing.

## What was decided along the way and is worth keeping

The architectural conclusion outlives the commercial plan, and it is already recorded in CLAUDE.md independently:
**Volt operates no backend.** No database, no auth system, no dashboard. That was settled when the AI-gateway
approach was dropped, and it is the reason a merchant-of-record was the shape being considered at all. Nothing
about closing this reopens that.

## What is now stale

- CLAUDE.md's two paragraphs describing a €19/month Polar subscription, and its pointer to this folder.
- `volt-web`'s storefront and the `COMING_SOON` flag, which exist to gate a checkout that is not coming.
- The three `legal.*` routes, already flagged in CLAUDE.md as known-stale (they still describe a hosted gateway,
  accounts and Stripe) — they were to be rewritten "before Volt takes money", which is no longer pending.

**None of that is removed here.** "Close the change" and "Volt is not going to be sold" are different statements,
and only the first was made. The storefront is left standing; a later decision can keep, repoint or delete it
without having to reconstruct what it was for.
