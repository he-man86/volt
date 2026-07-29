> Read `proposal.md` first, then `design.md` — every finding below is recorded there with the command that
> produced it. All measurements are dated **2026-07-28** against opencode **1.18.3**; re-verify before trusting.
>
> Reproduce the two facts this rests on before trusting them; both take a minute:
> ```bash
> grep -a -o -E '.{60}models\.dev.{100}' "$(which opencode)"        # OPENCODE_MODELS_URL || https://models.dev
> curl -s https://volt-ai.dev/v1/models                              # the gateway's live model list
> ```
> Both reproduced ✔ (2026-07-28).

## 1. Understand opencode's own gateway integration (no code yet)

- [x] 1.1 Read `sst/opencode` for how its gateway provider is registered client-side: is it a models.dev catalog
      entry, a built-in provider in the binary, or config it writes at login? Record the exact mechanism + file.
      → **A models.dev catalog entry.** `opencode` (85 models, `https://opencode.ai/zen/v1`) and `opencode-go`
      (22 models), both `@ai-sdk/openai-compatible`, `env: ["OPENCODE_API_KEY"]`. Same JSON embedded in the
      binary as a cold-start fallback. design.md §1.
- [x] 1.2 Trace `opencode auth login` → gateway: where the credential is stored, which header it ends up in, and
      how the provider's `options` receive it. Compare with `opencode-config/plugins/volt-auth.ts`.
      → `~/.local/share/opencode/auth.json`, keyed by provider id, `{type:"api", key}`; the plugin's `loader()`
      returns it as `options.apiKey` and each SDK places it in its own header. Zen's own login is an API-key
      paste (`provider.connect.opencodeZen.visit.*`) — `volt-auth.ts` already mirrors it exactly. design.md §4.
      **Correction to the proposal:** an entry for `volt` already exists in `auth.json`, so login HAS run at
      least once. What has never run is a completion.
- [x] 1.3 Determine whether the client enumerates a gateway's models dynamically (`/v1/models`) or only from the
      catalog. Prove it live (a request log against a scratch gateway URL beats reading minified code).
      → **Catalog/config only.** A scratch config declaring `totally-bogus-model-xyz` (which the gateway has
      never heard of) lists it in `opencode models`. `/v1/models` is never consulted. design.md §2.
- [x] 1.4 Establish exactly what `OPENCODE_MODELS_URL` replaces (whole catalog vs merge) and what the client does
      when it is unreachable — a gateway outage must not leave the user with no models at all.
      → **Whole catalog.** A mini catalog took the list from 173 providers to 1 model. Down+cached → serves the
      cache; down+no cache → the binary's bundled 25 models, **with Volt absent entirely**. design.md §3.
- [x] 1.5 Check whether models.dev itself carries an entry for opencode's gateway (and what shape it has) — that
      answers "is mirroring them a catalog entry or code?" more directly than reading the binary.
      → Yes; see 1.1. Also surfaced the finding that decided the design: models.dev's `opencode` entry sets a
      **per-model** `provider.npm` (`@ai-sdk/anthropic` on the Claude rows) and that field is in the public
      config schema too. Proven at runtime against a path-logging probe server — one provider id serving
      `/v1/chat/completions` (Bearer) and `/v1/messages` (x-api-key). design.md §1.1.
- [x] 1.6 Write the findings into this change as `design.md`, with citations (file/line or a live request).
      → `design.md`, every claim with its command, dated, with an explicit re-verify warning at the top.

## 2. Decide

- [x] 2.1 Pick between catalog piggyback / per-format providers / generated config.
      → **Generated config + per-format models.** The §1.1 finding makes the per-format split free (no second
      provider row, no second auth id), so it folds into the generator rather than competing with it.
- [x] 2.2 Record the rejected options and why, in `design.md` — including the two non-goals already ruled out.
      → design.md §5: catalog piggyback rejected on the §3 measurements; upstreaming a `volt` entry to
      `sst/models.dev` recorded as the real long-term mirror but not shippable today; both proposal non-goals
      restated so the record is in one place.

## 3. Implement

- [x] 3.1 Land ONE source of truth for "which models does Volt serve".
      → `models.json` is it. `volt-scripts/gen-model-config.ts` derives the picker from it: Volt owns name +
      cost (× 1e6, $/token → $/M), `providers[0]` is the models.dev coordinate for limit/modalities/capability
      flags, and `providers.<id>.format` decides the per-model `provider.npm`. Unknown format or missing
      upstream model = hard failure, no guessing.
- [x] 3.2 Add the check that makes drift impossible.
      → `check-wiring.ts` gained a "Model catalog" section: picker ids == `zenModels` ids; per-model name, cost
      and `provider.npm` == what `models.json` implies (importing the generator's own format map, so the two
      cannot diverge); plus `/v1/models` ids == `zenModels` ids. **All three verified to fail on real drift**
      (dropped npm override, stale cost, model added to the gateway but not the picker — the last one correctly
      reported BOTH the stale picker and the stale deploy).
      `report()` also gained a third outcome: an unreachable gateway now prints `~ … SKIPPED` and counts as
      unverified instead of rendering a green tick.
- [x] 3.3 If per-format providers are chosen: split Claude onto `@ai-sdk/anthropic`.
      → Done via the per-model override inside the single `volt` provider — so `volt-auth.ts` needed **no**
      change (one provider id, one credential). Route verified against a probe server; a completion still
      needs 4.1's key.
- [~] 3.4 If catalog piggyback is chosen: … → **N/A**, rejected in 2.1.

## 4. Verify live

- [ ] 4.1 A real completion through the Volt gateway from the desktop, with the model chosen in the picker.
      → **BLOCKED — needs a real Volt subscriber API key** (the human dependency the proposal called out). The
      key currently in `auth.json` is invalid: both routes return `HTTP 401` (verified directly with curl), and
      opencode surfaces `Error: Invalid API key.` Everything up to the credential is verified; this is the one
      step a key gates.
- [x] 4.2 The picker shows Volt's models with the same metadata quality as the built-ins.
      → Both rows now carry family, release_date, attachment, reasoning, temperature, tool_call, modalities,
      limit and Volt's real per-million cost — all sourced from models.dev, same fields as the built-ins.
      `opencode models` lists both under the shipped config. This already fixed one stale value: `deepseek-chat`
      was hand-typed at 128k context / 8k output; upstream is 1M / 384k.
- [x] 4.3 A user with NO Volt subscription sees a sane picker — decide which, and assert it.
      → **Decided: the rows always show**, matching opencode's own Zen (whose 85 rows are in the catalog for
      everyone). Both wire formats fail identically and clearly — `Error: Invalid API key.` — verified live on
      the openai-compatible AND anthropic paths. Noted in design.md §7: the gateway's 401 body is empty, so a
      Volt-authored message ("no active subscription → volt-ai.dev/account") is a worthwhile console-side
      follow-up, out of scope here.
- [x] 4.4 Uninstall reverts every global change; opencode returns to vanilla.
      → The chosen design introduces **no new global state** — `OPENCODE_MODELS_URL` is deliberately not set
      (that was the rejected option). The `OPENCODE_CONFIG_DIR` + `PATH` uninstall contract is untouched and
      already covered by `bun run test:install`; nothing in this change alters the installer.

## Left for the follow-up

- 4.1 above, the moment a subscriber key exists.
- **Deploy the new rate card**: `bun volt-scripts/set-models.ts --apply <stage>` + redeploy. The cache/>200k
  rates added in design.md §8.3 are committed but not live until the `ZEN_MODELS` secrets are reloaded.
- Gateway-authored 401 bodies (design.md §7) — a `packages/console` change.
- Upstreaming a `volt` provider entry to `sst/models.dev` (design.md §5) — revisit once the gateway has
  customers.
- **`restore-out-of-band-secrets` supersedes this change's transport.** `volt-scripts/update-models.ts` and the
  `--push` step exist only because CI cannot read secrets set from a dev machine. If that is fixed, opencode's
  own `core/script/update-models.ts` replaces the Volt script and `--push` becomes unnecessary. Land this
  change first — it works with the pipeline as it stands today.
