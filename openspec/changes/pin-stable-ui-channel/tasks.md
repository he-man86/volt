## 1. Pin the channel

- [ ] 1.1 Set `OPENCODE_CHANNEL=prod` in Volt's desktop packaging — interim: the build command (`OPENCODE_CHANNEL=prod bun run package:win`); permanent: bake into the `desktop-distribution` release pipeline
- [ ] 1.2 Verify a prod build: app name `Volt` (not `Volt Dev`), prod icons, and the **v1** layout renders by default

## 2. Spec

- [x] 2.1 `upstream-sync`: "ships opencode's stable UI channel" requirement (+ auto-follow, + dev can preview v2)

## 3. Docs

- [ ] 3.1 CLAUDE.md note: from-source/`dev` builds default to **v2** (non-prod channel); Volt *releases* default to **v1** (`OPENCODE_CHANNEL=prod`) — by design, not a regression. Don't judge polish from `bun dev:desktop`.
