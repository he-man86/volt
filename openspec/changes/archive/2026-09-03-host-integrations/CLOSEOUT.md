# Close-out — closed to be restarted simpler

Closed 2026-09-03 at 12 of 42, by decision. The direction it was built on has not changed; the SIZE has. What
ships, when it ships, is meant to be two things:

- **Extensions reach users through the marketplace.** Not sideloaded, not installed by Volt into someone else's
  editor — published, and installed the way every other extension is.
- **The CLI reaches users through an installer that is easier to implement than today's.**

That is all. This change spans seven sections, five hosts and three delivery mechanisms, and closing it is
cheaper than shrinking it in place: the restart should be written against the simple shape rather than inherited
from an elaborate one with most of its boxes unticked.

## What shipped, and stays shipped

- **§0 — opencode removed, entirely.** All four tasks ticked, and verified again today: no `opencode-config/`,
  no `OPENCODE_CONFIG_DIR` (the installer retires a stale one on upgrade, and `test-install.ts` FAILS if it
  survives), no bundled agent, no launcher. `volt-desktop` is standalone with `recent.ts` as its
  which-workspace signal. Every remaining mention in the repo is either a "do not re-add this" note or that
  active migration code.
- **The Claude Code plugin** — `.claude-plugin/marketplace.json` at the repo root.
- **The extension, as a sideload** — `Volt.iss` installs the `.vsix` into VS Code, Cursor and Windsurf, one
  `[Run]` entry each, offered only when that editor's launcher is on PATH.

## What the restart should not have to re-derive

The research is the part worth keeping; it is cheap to lose and was not cheap to do.

- **One `.vsix` covers the whole VS Code family.** Open VSX is the registry Cursor proxies and the one
  marketplace.windsurf.com *is*, so publishing to the VS Code Marketplace **and** Open VSX reaches VS Code,
  Cursor, Windsurf and VSCodium from a single build — no fork-specific packaging.
- **`release.yml` already stamps the extension version and stops.** It runs no `vsce publish` and no
  `ovsx publish`. The build is done; only the publish step and its two registry secrets are missing.
- **The `.vsix` version is 3-part on purpose** (`<maj>.<min>.<count>`) — `vsce` rejects a 4-part version, while
  the installer and connector carry the full 4-part build. That asymmetry is deliberate and will bite anyone who
  tries to unify it.
- **A plugin is Claude Code's only LSP mechanism.** No settings key, no env var. And the marketplace POINTER
  necessarily lands in the user's global `~/.claude/settings.json` — `extraKnownMarketplaces` is user-scope-only
  by design, so a repo cannot self-register a plugin source. Enablement can be project-scoped and committed.
- **Claude Desktop has no terminal and no editor**, so MCP is its only door.

## The one decision left standing

**The sideload and the marketplace are alternatives, not layers.** Once the extension is published, the
installer's `[Run]` entries stop being the delivery route and become a second, silent one that can install an
older build over a newer registry-managed install. §3 existed to retire them, and whatever the restart looks
like still has to answer that — it is the point where "integrated via the marketplace" either becomes true or
quietly does not.

Nothing else here is owed. The invariant this change was protecting is already recorded where it will be read:
CLAUDE.md states that Volt writes into no other vendor's configuration, ships no agent, and delivers host wiring
as a published artifact or a documented snippet — never a file Volt writes into someone's config.
