## 1. Measure

- [x] 1.1 Live, CODESYS SP21 and TwinCAT 4024, asked directly (no Volt gate): rename an item onto a name held (a) in the
      same folder, (b) in another folder of the same application; move an item into a folder that holds its name, where
      the IDE lets that state exist. For each: refused (exception type and sentence), clash-renamed (`X_1`), or two
      objects? Does part of the op land? Which kinds share the name scope (FB vs DUT vs GVL; FB vs visualization)?
      Today's push answer for each. Record in `DIALECT.md`.

## 2. Tests red

- [x] 2.1 FakeIde: rename `…/FB_A.pou` onto `…/FB_B.pou` in the same folder → one `ITEM_EXISTS` on `…/FB_A.pou` naming
      `…/FB_B.pou`; nothing of the batch applied (an earlier op in the batch is not applied either). Today: the gate
      passes it.
- [x] 2.2 FakeIde: move onto a path the walk holds → `ITEM_EXISTS`, nothing applied.
- [x] 2.3 FakeIde: 2.1 with `force: true` and no lease (a pure move and a rename) → still `ITEM_EXISTS`, `currentVersion` the
      version of the item at `to`.
- [x] 2.4 Only if 1.1 measures an application-wide scope: rename onto a name held in another folder of the application
      → `ITEM_EXISTS`.
- [x] 2.5 Pins: a case-only rename applies; a move beside a same-named `.visualization` applies; a create onto an
      existing path stays `ITEM_EXISTS`; `deleteItem <to>` + `set … to: <to>` in one push stays `BAD_REQUEST`.

## 3. Implement

- [x] 3.1 `PushService` (`:46-49`): a `relocating` flag (any `set` whose `to` differs from `name` ignoring case) joins
      `needVersions`; `renaming` alone keeps driving `textsBefore`. Pre-flight: for each such `set`, refuse
      `ITEM_EXISTS` with `currentVersion` = the version at `to` if `currentVersions.Keys` (a set built once with
      `OrdinalIgnoreCase`) holds `to`. No full name is derived anywhere else. Collect every refusal; the batch stays
      all-or-nothing.
- [x] 3.2 Only if 1.1 measures it: key by (folder or application, bare name) for the kinds 1.1 shows sharing a name
      scope (POU vs DUT vs GVL), with a FakeIde test per measured pair; one sentence matcher per vendor for a measured
      vendor refusal that still reaches `ConflictFor`.
      **Built (2026-10-18):** 1.1 measured an application-wide scope shared by FB, program, DUT and GVL on both vendors
      (DIALECT C38), so `PushService.NameScopeKinds` keys a rename by (application, bare name) for those kinds. No
      sentence matcher: every measured refusal is now caught by the pre-flight, none reaches `ConflictFor`.

## 4. Docs

- [x] 4.1 `wire.html`: the `ITEM_EXISTS` row reads "A `set` lands on a path the IDE holds: a create (`ifVersion: null`,
      gate only, so a forced create overwrites), or a rename or move's `to` (pre-flight, force or not). `currentVersion`
      is the version of the item there." Remedy: "A create: fetch its version and push an update, or pick another name.
      A `to`: pick another `to`, or free it in an earlier push." The gate-codes intro says `ITEM_EXISTS` also comes from
      the pre-flight. `ConflictCodes.ItemExists` summary says the same. The one-op-per-item note says freeing `to` is an
      earlier push.
