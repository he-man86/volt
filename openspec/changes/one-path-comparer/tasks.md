## 1. Tests red

- [ ] 1.1 `Volt.Engine.Tests` (FakeIde): the IDE holds `Device/Plc Logic/Application/FB_Motor.pou`; `fetch { onlyItems:
      ["device/plc logic/application/fb_motor.pou"] }` → `items` and `changed` hold it, named
      `Device/Plc Logic/Application/FB_Motor.pou`. Today: empty.
- [ ] 1.2 Pin (green before and after), `Volt.Engine.Tests`: `knownItems` holds `…/Calc.pou`, the IDE renames it `calc` →
      `refs` and `fetch` answer `removed: ["…/Calc.pou"]` and `…/calc.pou` in `items`.
- [ ] 1.3 Pin (green before and after), `Volt.Cli.Tests`: the same rename through `volt pull` → `refs/remotes/volt/ide`
      and the work tree hold exactly one file, `…/calc.pou`.

## 2. Implement

- [ ] 2.1 `FetchService.cs:40`: `new HashSet<string>(request.OnlyItems, StringComparer.OrdinalIgnoreCase)`.

## 3. Docs

- [ ] 3.1 `wire.html` identity section: the address-vs-held-key sentence (proposal). The one-op-per-item note at
      `:110-111` refers to it instead of stating case itself. Regenerate OpenRPC if the description is pinned.
