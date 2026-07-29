> ## SUPERSEDED — 2026-07-29
>
> Superseded by `volt-console`, which drops the AI gateway entirely in favour of a flat subscription for the
> PLC toolchain. Most of the secrets it is about — ZEN_MODELS1..30, the upstream provider keys, ZEN_LIMITS, Upstash — disappear with the gateway. Its central FINDING still stands and is worth keeping: a CI runner cannot read SST secrets set from a dev machine, which is why deploy.yml provisions them in-job.
>
> Archived unfinished on purpose: the work is not abandoned so much as no longer applicable. See
> `openspec/changes/archive/2026-07-29-volt-console/` (or `openspec/changes/volt-console/` while in flight).

## Why

`deploy.yml` says it out loud, at the top of the file:

```
#   PREREQUISITES (not done here — opencode also sets secrets out of band):
```

...and then does the opposite. Every deploy runs `deploy-secrets.ts --apply` inside the job, re-provisioning
~50 SST secrets from ~25 GitHub environment secrets before `sst deploy`. opencode sets its secrets **once, out
of band**, and its deploy workflow touches none of them.

That deviation was not a design choice. It was a workaround for one observation — a CI runner could not see
secrets set from a dev machine (`deploy.yml`: *"proven: CI saw 0/48"*) — and everything downstream grew from
it:

- `volt-scripts/deploy-secrets.ts` (~75 lines) exists solely to expand `.env` into every declared secret.
- ~52 lines of `deploy.yml` are `NAME: ${{ secrets.NAME }}` plumbing, one per secret, hand-maintained.
- A `DEFAULTS` table hard-codes a valid-shaped `ZEN_LIMITS` because a `PLACEHOLDER_UNSET` would make
  `JSON.parse(Resource.ZEN_LIMITS.value)` throw on every console page (`core/src/subscription.ts:45`).
- `volt-scripts/update-models.ts` had to be written at all: opencode's `core/script/update-models.ts` edits
  the **deployed** SST secret, which is useless if the deployed state is one a dev machine cannot reach.

Each piece is individually justified and each one is drift. This change removes the root cause so the branch
above can be deleted, and Volt manages secrets the way opencode does.

## Where this stands right now (measured 2026-07-28)

The symptom is real and reproducible:

```
$ bunx sst secret list --stage dev            # from the dev machine
46 secrets | real: 7 | placeholder: 39
real: ZEN_SESSION_SECRET, HONEYCOMB_API_KEY, GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID_CONSOLE,
      STRIPE_PUBLISHABLE_KEY, GITHUB_CLIENT_SECRET_CONSOLE, STRIPE_SECRET_KEY

$ gh secret list --env dev                    # what CI provisions from
… ZEN_LIMITS, CONSOLE_DEV_EMAILS, SUPPORT_API_KEY, DISCORD_INCIDENT_WEBHOOK_URL,
  DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, PLANETSCALE_*, UPSTASHREDIS* …
```

**`ZEN_LIMITS`, `CONSOLE_DEV_EMAILS`, `SUPPORT_API_KEY` and `DISCORD_INCIDENT_WEBHOOK_URL` all exist as GitHub
secrets and are passed on every deploy, yet all four read as `PLACEHOLDER_UNSET` locally.** CI's writes are
invisible from the dev machine. The 7 that are real are exactly the ones also present in local `.env`, i.e.
plausibly set from here.

**But the stated mechanism does not match SST's own documentation**, and that contradiction is the first thing
to resolve. `deploy-secrets.ts` says *"state is local + cloud-backed, passphrase-encrypted"*, implying a
per-machine passphrase. SST's platform source says the passphrase lives **in the state backend**
(`.sst/platform/src/config.ts:322` — `sst remove` deletes "the state files, secrets, update history, event
logs, snapshots **and the encryption passphrase**"). The app uses `home: "cloudflare"`, so the backend is
shared by definition. A shared backend holding the passphrase should mean a shared, decryptable state.

Competing explanations, none yet eliminated:

1. CI authenticates with a `CLOUDFLARE_API_TOKEN` for a **different account**, so it is a different state store.
2. The passphrase is per-machine after all, and the docs describe a different backend's behaviour.
3. No successful deploy has run since those GitHub secrets were added, so CI never wrote them.

**Explanation 3 would mean there is no drift to undo** — the workaround would be unnecessary and this change
collapses to "delete it". That is why Task 1 is diagnosis, not implementation.

## What this change is

Restore opencode's model: **secrets are set once, out of band, and the deploy reads them.** Concretely, once
the root cause in Task 1 is known, make the SST state reachable from both the dev machine and CI — most likely
by sharing the state credentials/passphrase — then delete the machinery that existed to work around it.

## Definition of done

- A secret set from the dev machine is visible to a CI deploy, demonstrated by a real deploy, not inferred.
- `deploy.yml` no longer provisions secrets. The ~52 `NAME: ${{ secrets.NAME }}` lines and the
  "Load SST secrets into this run's state" step are gone.
- `volt-scripts/deploy-secrets.ts` is deleted, or reduced to a one-time bootstrap that no workflow calls.
- `volt-scripts/update-models.ts` is deleted in favour of opencode's `core/script/update-models.ts`, with at
  most the two narrow `VOLT:`-marked value-edits it needs (the hardcoded `--stage frank`, and `vim` → `$EDITOR`
  for Windows).
- The `DEFAULTS` / `ZEN_LIMITS` shim is gone, because no deploy writes a placeholder over a real secret.
- A documented, durable answer to "where is the passphrase, and who holds it" — losing it makes every secret
  and every state version unrecoverable (SST's own caution), so this must not live only on one laptop.
- Deploys still work, on `dev` and `production`.

## Open questions (answer before implementing)

- Which of the three explanations above is true? Compare the Cloudflare account behind CI's
  `CLOUDFLARE_API_TOKEN` with the local one, and check whether a deploy has actually run since 2026-07-15.
- Where does SST store the passphrase for `home: "cloudflare"`, and is it per-app, per-stage, or per-machine?
- If sharing is required: what is the safest carrier — an `SST_PASSPHRASE` GitHub secret, or granting CI the
  same Cloudflare state credentials?
- Does CI still need `deploy-secrets` for **bootstrapping a brand-new stage**, or is `sst secret load` from a
  dev machine sufficient (as it is for opencode)?

## Risks

- **Lockout.** If the passphrase is lost or rotated, secrets and all state versions become unrecoverable. Any
  design here needs a durable store for it before the workaround is removed.
- **Blast radius.** CI gaining decrypt access to the whole state is a real increase in what a compromised
  runner can read — though marginal, since CI is already handed every secret individually today.
- **Sequencing.** Removing `deploy-secrets` before secrets are reachable leaves a stage with placeholders and a
  broken gateway. The gateway catalog in particular throws on `JSON.parse` of a placeholder join.

## Non-goals

- Changing what the secrets *are*, or the model catalog's contents. `mirror-opencode-model-catalog` owns that;
  this change only moves where secrets live and who writes them.
- Editing vendored `packages/console/**` beyond the two narrow value-edits named above.
