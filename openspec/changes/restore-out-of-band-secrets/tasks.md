> Read `proposal.md` first. The headline: `deploy.yml`'s own comment says opencode sets secrets out of band,
> and Volt then does the opposite. Everything here is undoing that.
>
> Reproduce the symptom before trusting it — both take a minute, neither writes anything:
> ```bash
> bunx sst secret list --stage dev     # 46 secrets, 7 real, 39 PLACEHOLDER_UNSET (2026-07-28)
> gh secret list --env dev             # includes ZEN_LIMITS, SUPPORT_API_KEY, CONSOLE_DEV_EMAILS…
> ```
> Those four are passed on every deploy yet read as placeholders locally. That is the whole problem.

## 1. Diagnose — why can't the dev machine see CI's secrets?

- [x] 1.1 Resolve the contradiction in the proposal. **Answered (design.md §3): the mechanism objection is dead.**
      opencode's `sst.config.ts` uses `home: "cloudflare"` — the identical state backend — and their CI reads
      out-of-band secrets on every deploy. The backend is not the obstacle; this is a configuration problem.
- [ ] 1.2 **PRIME SUSPECT** — compare the Cloudflare account behind CI's `CLOUDFLARE_API_TOKEN` with the one the
      dev machine uses, and check its scopes. A different account, or a token that cannot read the state, is a
      different state store and explains everything with no passphrase involved.
- [ ] 1.3 Check whether a deploy has actually succeeded since the GitHub secrets were added (2026-07-15). If
      not, CI may simply never have written them — in which case there is no drift, and this change is just
      deletion. Rule this out explicitly; it is the cheapest possible outcome.
- [ ] 1.4 Determine where the passphrase for this app/stage is stored, and whether it is per-app, per-stage, or
      per-machine. Record how to retrieve it — losing it makes every secret and state version unrecoverable.
- [ ] 1.5 Write the answer into `design.md` with the commands that produced it. If 1.3 turns out to be the
      cause, stop here and skip to section 3.

## 2. Make the state reachable from both sides

- [ ] 2.1 Pick the carrier: a shared `SST_PASSPHRASE`, or giving CI the same Cloudflare state credentials.
      Record the rejected option and why.
- [ ] 2.2 Store the passphrase durably somewhere that is NOT one laptop and NOT only a GitHub secret (both are
      single points of loss). Document where.
- [ ] 2.3 Prove it end to end: set a uniquely-marked secret from the dev machine, run a real deploy, and
      confirm the deployed worker sees that value. Inference is not enough — this is the assumption the whole
      change rests on, and the current one was wrong for months.

## 3. Delete the workaround

> Scope is fixed by design.md §1: **do not touch `infra/`.** Its diff against opencode is branding and
> feature-removal (`monitoring.ts` is byte-identical), not drift. The target is `deploy.yml` + `volt-scripts/`.

- [ ] 3.1 Reduce `deploy.yml` (188 lines) to opencode's 48-line shape — one `sst deploy` step whose `env:`
      carries ONLY provider credentials, minus their AWS step and Sentry (Volt has neither), plus Volt's path
      filter and stage input. Expect ~35 lines. Drop `GOOGLE_CLIENT_SECRET` — design.md §4 shows nothing
      declares it. Update the PREREQUISITES comment to describe what the file now does.
- [ ] 3.2 Delete `volt-scripts/deploy-secrets.ts`, or reduce it to a one-time bootstrap no workflow calls.
      Remove the `DEFAULTS` / `ZEN_LIMITS` shim with it — it only existed to survive placeholder overwrites.
- [ ] 3.3 Delete `volt-scripts/update-models.ts` and use opencode's `core/script/update-models.ts`, with at
      most two `VOLT:`-marked value-edits (`--stage frank` → the real stage; `vim` → `$EDITOR` for Windows).
      Both are hand-merges on every opencode bump, so keep them to one line each.
- [ ] 3.4 Update `volt-scripts/README.md` and CLAUDE.md wherever they describe deploy-time secret provisioning.
- [ ] 3.5 Sweep for the assumption itself — the "SST secrets are per-runner / per-machine" claim is repeated in
      `deploy-secrets.ts`, `deploy.yml`, `volt-scripts/README.md` and archived OpenSpec notes. Correct the live
      ones rather than leaving a wrong explanation behind (archived changes stay as history).

## 4. Verify

- [ ] 4.1 A deploy to `dev` succeeds with no secret-provisioning step, and the console + gateway still work
      (`curl -s https://volt-ai.dev/v1/models` returns the expected ids).
- [ ] 4.2 The same for `production`.
- [ ] 4.3 `bun volt-scripts/check-wiring.ts` and `bun run compat` still pass.
- [ ] 4.4 Bootstrapping a brand-new stage is documented and tried once — that is the case `deploy-secrets` was
      genuinely useful for, and it must not become folklore.

## Ordering note

Section 3 must not land before 2.3 passes. Removing the provisioning step while CI still cannot read the
secrets leaves every stage on placeholders — and for the model catalog specifically, the gateway throws on
`JSON.parse` of a placeholder join rather than degrading quietly.

## Relationship to `mirror-opencode-model-catalog`

That change already moved the catalog to `ZEN_MODELS1..30` secrets + `volt-scripts/update-models.ts`, and its
`MIGRATION.md` step 2 (`--push dev` / `--push production`) is still outstanding. It works with the current
in-job provisioning. This change supersedes its transport: once secrets are set out of band, `--push` is
unnecessary and opencode's script replaces Volt's. Land that change first, then this one.
