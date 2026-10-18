## 1. Measure

- [ ] 1.1 Live, CODESYS SP21 and TwinCAT 4024, asked directly (no Volt gate): rename an item onto a name held (a) in the
      same folder, (b) in another folder of the same application; move an item into a folder that holds its name, where
      the IDE lets that state exist. For each: refused (exception type and sentence), clash-renamed (`X_1`), or two
      objects? Does part of the op land? Which kinds share the name scope (FB vs DUT vs GVL; FB vs visualization)?
      Today's push answer for each. Record in `DIALECT.md`.

## 2. Tests red

- [ ] 2.1 FakeIde: rename `…/FB_A.pou` onto `…/FB_B.pou` in the same folder → one `ITEM_EXISTS` on `…/FB_A.pou` naming
      `…/FB_B.pou`; nothing of the batch applied (an earlier op in the batch is not applied either). Today: the gate
      passes it.
- [ ] 2.2 FakeIde: move onto a path the walk holds → `ITEM_EXISTS`, nothing applied.
- [ ] 2.3 FakeIde: 2.1 with `force: true` and no lease (a pure move and a rename) → still `ITEM_EXISTS`.
- [ ] 2.4 Only if 1.1 measures an application-wide scope: rename onto a name held in another folder of the application
      → `ITEM_EXISTS`.
- [ ] 2.5 Pins: a case-only rename applies; a move beside a same-named `.visualization` applies; a create onto an
      existing path stays `ITEM_EXISTS`; `deleteItem <to>` + `set … to: <to>` in one push stays `BAD_REQUEST`.

## 3. Implement

- [ ] 3.1 `PushService` pre-flight: for each `set` whose `to` differs from its `name` ignoring case, refuse `ITEM_EXISTS`
      if the walk's identity set (built once from `walk.Items`, plus the full-path `unreadable` items once
      `unreadable-name-carries-kind` lands) holds `to` ignoring case. Collect every refusal; the batch stays
      all-or-nothing.
- [ ] 3.2 Only if 1.1 measures it: key by (application via `ItemPath.ApplicationOf`, bare name) for the measured kinds;
      one sentence matcher per vendor for a measured vendor refusal that still reaches `ConflictFor`.

## 4. Docs

- [ ] 4.1 `wire.html`: the `ITEM_EXISTS` row reads "A `set` lands on a path the IDE holds: a create (`ifVersion: null`),
      or a rename or move's `to` (force or not)". The one-op-per-item note says freeing `to` is an earlier push.
