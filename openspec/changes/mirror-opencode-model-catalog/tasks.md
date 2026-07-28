> Read `proposal.md` first — "Where this stands right now" lists what already shipped, the files involved, and the
> one human dependency (a subscriber API key) that blocks section 3 onward.
>
> Reproduce the two facts this rests on before trusting them; both take a minute:
> ```bash
> grep -a -o -E '.{60}models\.dev.{100}' "$(which opencode)"        # OPENCODE_MODELS_URL || https://models.dev
> curl -s https://volt-ai.dev/v1/models                              # the gateway's live model list
> ```

## 1. Understand opencode's own gateway integration (no code yet)

- [ ] 1.1 Read `sst/opencode` for how its gateway provider is registered client-side: is it a models.dev catalog
      entry, a built-in provider in the binary, or config it writes at login? Record the exact mechanism + file.
- [ ] 1.2 Trace `opencode auth login` → gateway: where the credential is stored, which header it ends up in, and
      how the provider's `options` receive it. Compare with `opencode-config/plugins/volt-auth.ts`.
- [ ] 1.3 Determine whether the client enumerates a gateway's models dynamically (`/v1/models`) or only from the
      catalog. Prove it live (a request log against a scratch gateway URL beats reading minified code).
- [ ] 1.4 Establish exactly what `OPENCODE_MODELS_URL` replaces (whole catalog vs merge) and what the client does
      when it is unreachable — a gateway outage must not leave the user with no models at all.
- [ ] 1.5 Check whether models.dev itself carries an entry for opencode's gateway (and what shape it has) — that
      answers "is mirroring them a catalog entry or code?" more directly than reading the binary.
- [ ] 1.6 Write the findings into this change as `design.md`, with citations (file/line or a live request), the way
      `desktop-connection-flow/observations.md` records the binding wire. No conclusions without evidence.
      That file also carries a worked example of the failure mode to avoid: a documented observation that had gone
      stale and was believed for months until it was re-verified live.

## 2. Decide

- [ ] 2.1 Pick between catalog piggyback / per-format providers / generated config, against: metadata quality,
      drift risk, ongoing obligation (do we now run a catalog?), blast radius of a Volt outage, and reversibility
      on uninstall.
- [ ] 2.2 Record the rejected options and why, in `design.md` — including the two non-goals already ruled out.

## 3. Implement

- [ ] 3.1 Land ONE source of truth for "which models does Volt serve": the picker entry, the gateway's served list
      and the billing catalog derive from it rather than agreeing by convention.
- [ ] 3.2 Add the check that makes drift impossible — `check-wiring` already asserts the config's shape; extend it
      to assert picker ids == `models.json` `zenModels` ids == what `/v1/models` answers.
- [ ] 3.3 If per-format providers are chosen: split Claude onto `@ai-sdk/anthropic`, extend `volt-auth.ts` to both
      provider ids, and verify a real completion through `/v1/messages` with a subscriber key.
- [ ] 3.4 If catalog piggyback is chosen: serve the catalog, point `OPENCODE_MODELS_URL` from the installer, and
      make uninstall revert it (the env-var contract already exists for `OPENCODE_CONFIG_DIR` — mirror it exactly).

## 4. Verify live

- [ ] 4.1 A real completion through the Volt gateway from the desktop, with the model chosen in the picker — the
      one path that has never been exercised end to end (`volt-auth.ts` has no test at all today).
- [ ] 4.2 The picker shows Volt's models with the same metadata quality as the built-ins (name, context, output).
- [ ] 4.3 A user with NO Volt subscription sees a sane picker (either no Volt rows, or rows that fail with a clear
      message — decide which, and assert it).
- [ ] 4.4 Uninstall reverts every global change (config dir, and the models URL if used); opencode returns to vanilla.
