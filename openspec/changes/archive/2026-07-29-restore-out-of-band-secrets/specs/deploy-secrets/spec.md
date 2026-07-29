## ADDED Requirements

### Requirement: Secrets are set out of band, not by the deploy

The deploy workflow SHALL NOT provision SST secrets. Secrets SHALL be set once from an authorised machine
(`sst secret load` / `sst secret set`) and read by `sst deploy` from the shared state, which is how opencode's
own deploy operates and what `deploy.yml`'s PREREQUISITES comment already claims.

Consequently the deploy workflow SHALL NOT carry a per-secret `NAME: ${{ secrets.NAME }}` list, and no script
SHALL expand `.env` into the full set of declared secrets at deploy time.

#### Scenario: a deploy does not touch secrets
- **WHEN** the deploy workflow runs for a stage
- **THEN** it performs no secret provisioning step, and the secrets already set for that stage are used unchanged

#### Scenario: adding a secret does not require a workflow edit
- **WHEN** a new `sst.Secret` is declared in `infra/` and its value is set out of band
- **THEN** the next deploy picks it up with no change to `deploy.yml`

### Requirement: SST state is reachable from both the dev machine and CI

A secret set from an authorised dev machine SHALL be readable by a CI deploy of the same stage. This is the
assumption the whole model rests on, and it SHALL be demonstrated by an actual deploy rather than inferred —
the previous assumption ("secrets set from a dev laptop are NOT visible to a CI deploy") shaped the deploy
pipeline for months on a single unverified observation.

Whatever credential makes this possible (a shared passphrase, or shared state credentials) SHALL be stored
durably in more than one place. Losing it makes every secret and every state version permanently unrecoverable.

#### Scenario: a locally-set secret reaches a deployed worker
- **WHEN** a uniquely-marked value is set for a stage from the dev machine and that stage is deployed by CI
- **THEN** the deployed worker serves that value, proving CI read what the dev machine wrote

#### Scenario: the recovery path is documented
- **WHEN** someone needs to recover access to a stage's secrets
- **THEN** the location and custodian of the passphrase (or state credential) are written down, and not held
  only on one laptop or only as a GitHub secret

### Requirement: No placeholder shims

Nothing SHALL substitute a stand-in value for an unset secret at deploy time. The `PLACEHOLDER_UNSET` stub and
the hard-coded valid-shaped `ZEN_LIMITS` default exist only because the deploy overwrote real secrets on every
run; with out-of-band secrets an unset secret SHALL fail loudly instead of being papered over.

#### Scenario: an unset secret is not silently replaced
- **WHEN** a declared secret has never been set for a stage
- **THEN** the deploy fails naming it, rather than deploying a placeholder that makes the app throw at runtime

#### Scenario: a real secret is never overwritten by a deploy
- **WHEN** a stage has real secrets and is deployed repeatedly
- **THEN** no deploy replaces any of them, including the `ZEN_MODELS` catalog chunks

### Requirement: The model catalog is edited with opencode's own script

Volt SHALL use `packages/console/core/script/update-models.ts` to edit the gateway model catalog, rather than
maintaining a parallel Volt script. Only narrow `VOLT:`-marked value-edits are permitted — the hardcoded stage
name, and the hardcoded `vim` (primary development is Windows) — each kept to a single line so upstream still
merges.

#### Scenario: the catalog is edited without a Volt-specific script
- **WHEN** a model or price needs changing
- **THEN** opencode's script reads the deployed catalog, opens it in an editor, validates it and writes it
  back, and `volt-scripts/update-models.ts` no longer exists

#### Scenario: the vendored edits stay minimal
- **WHEN** opencode is bumped
- **THEN** re-applying Volt's changes to that script is at most two single-line value-edits
