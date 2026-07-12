Consolidate the Volt layer's storage + update + lifecycle. Branding decided **B** (see design §5): the
functional toolchain via our installer is the firm bar (met); data-dir rebranding is nice-to-have. Backend model
is open (design §8) — the process inventory is NOT final. No opencode-core changes; all via fork seams.

## 0. Confirmed (this session)
- [x] Functional toolchain ships via our installer — config (`OPENCODE_CONFIG_DIR` → bundled `volt-config`) +
      LSP (`volt-lsp-iec.exe`) + `volt` CLI (on PATH). Verified on a fresh install; no separate opencode needed.
- [x] Branding decision: **B** — opencode-branded data dirs acceptable (esp. CLI); full redirect = nice-to-have.

## 1. Shared hygiene (do now — pure win, branding-independent)
- [ ] Collapse the two updater caches into one (drop the stale/orphan one).
- [ ] Uninstall + a maintenance step delete stale duplicates: `ai.opencode.desktop.dev` (~436 MB), `volt-bridge*`,
      the orphan updater cache — so per-channel/updater cruft never accumulates.

## 2. One update path (core)
- [ ] Disable opencode's in-sidecar self-updater for the installed CLI too (the desktop already silences it) — the
      whole bundle updates via electron-updater against Volt's feed.
- [ ] Confirm exactly one updater cache after an update cycle.

## 3. Tame + surface data growth (core — this is what ballooned to ~900 MB)
- [ ] `volt clean` (or `volt maintenance`): report per-store disk usage and prune opencode session/snapshot
      growth to a bound — reclaimable without hand-deleting SQLite files.

## 4. Document + guard (core)
- [ ] Land the two-worlds runtime model (design §1/§8, incl. the open backend/extra-connector fork) as the
      maintainable reference; link from CLAUDE.md / the bridge ARCHITECTURE.md.
- [ ] Test: no local frontend spawns a bridge directly (all reach it via connector port discovery).

## 5. Isolation — redirect `XDG_DATA_HOME` (decided YES; design §10) [core]
- [ ] CLI launcher (`volt-git/src/volt.ts`): set `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` under
      `%LocalAppData%\Volt\{data,state,cache}` — **before** opencode core loads (downside #1), `??=` semantics.
- [ ] Desktop (`main/index.ts`): same three vars, same Volt root, before spawning the sidecar → CLI + desktop
      share ONE Volt data root (one login / one session history across both).
- [ ] Startup assertion: the resolved opencode data dir is under the Volt root — fail loud on regression.
- [ ] Guard: confirm no opencode-core path reads `~/.local/share/opencode` bypassing XDG.
- [ ] Verify coexistence: install Volt + stock opencode, log into both → two separate `auth.json`, no clobber.
- [ ] Ship-time only: decide migration (move an existing `~/.local/share/opencode` → `Volt\data`) vs a one-time
      re-login (fine now — data was wiped).

## Cosmetic remainder (defer, decided B)
- [ ] Cache/state/`userData` full rebrand beyond isolation — leave until opencode-branded internals ever bite.

## Blocked-on
- [ ] Process-model lock waits on the backend decision (local-first vs cloud/web agent → possible extra tunnel
      connector, design §8). Everything above is backend-independent and safe to do first.
