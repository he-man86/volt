## Context

After catching up to `upstream/dev`, Volt's build looked rougher than opencode's downloadable app.
Root cause: the two builds are on different **UI channels**, not different code.

## The v1/v2 architecture (so it isn't mistaken for a fork)

```
                         OPENCODE_CHANNEL  (build-time env)
                         ┌──────────────────┐
                         │  === "prod" ?     │
                         └────────┬──────────┘
                       false ◀────┴────▶ true
            newLayoutDesigns=true        newLayoutDesigns=false
                   │                            │
   packages/app → NewHome / new layout   packages/app → LegacyHome / legacy layout
   (uses ui/src/v2, in-progress)         (stable, polished — the download)
```

- **One package, one flag.** `packages/app/src/app.tsx` renders `LegacyHome`/`LegacyLayout` vs the new
  shell based on `settings.general.newLayoutDesigns()`. `ui/src/v2` holds the new components; the legacy
  ones still exist. So this is a runtime toggle, not two packages — nothing to fork or vendor.
- **The default is channel-derived.** `newLayoutDesignsDefault = OPENCODE_CHANNEL !== "prod"`. The user
  can also override per-install (`settings.v3` → `general.newLayoutDesigns`), but the *default* a
  packaged build ships with is set entirely by `OPENCODE_CHANNEL`.
- **opencode's own release rule:** `.github/workflows/publish.yml` builds downloads with
  `OPENCODE_CHANNEL = ref == 'beta' ? 'beta' : 'prod'` → stable = v1, beta channel = v2.

## Decisions

- **Pin `OPENCODE_CHANNEL=prod` in Volt's packaging.** One env var fixes layout (v1), app name (`Volt`,
  not `Volt Dev`), and icons to a real release shape — matching opencode's stable download.
- **Auto-follow, don't hardcode v1.** We pin the *channel*, not the layout. When opencode flips its prod
  default to v2 (their call, on release), Volt's next prod build renders v2 with no Volt change. "Move
  to v2 when they release" = inherit their prod default.
- **Channel ⟂ cadence.** Sync *code* from `upstream/dev` (latest), but *build* the `prod` channel
  (stable UX). Independent of `tighten-upstream-cadence`.

## Risks / Trade-offs

- [Pinning prod hides v2 during development] → fine: devs can flip `newLayoutDesigns` per-install, or run
  an unset/beta build, to preview v2 before opencode promotes it.
- [We lag v2's polish while it bakes] → that's the point — opencode's stable is more polished than its
  in-flight redesign; we ride stable until they say otherwise.

## Open Questions

- Home for the env var: an interim `OPENCODE_CHANNEL=prod` on the build command vs baked into the
  `distribution` release pipeline. (Bake it in when that pipeline lands; use the command meanwhile.)
