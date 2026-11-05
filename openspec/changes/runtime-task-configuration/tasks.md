## 1. Format

- [ ] 1.1 `readTask` / `writeTask` in `volt-lsp-iec`, ported from `TaskDescriptorFormat.cs` (labels, pad, watchdog spelling, members, refusals)
- [ ] 1.2 Test: corpus round trip, byte-equal with the C# writer; the refusals by line
- [ ] 1.3 Export them in the bundle surface Sim-Assist builds (`scripts/build-volt.mjs` there lists named exports)

## 2. Diagnostics

- [ ] 2.1 Unknown field, `Calls:` not a PROGRAM, interval not a TIME (errors); a PROGRAM in two tasks (warning)
- [ ] 2.2 Tests per diagnostic, each able to fail

## 3. Runtime

- [ ] 3.1 Build result carries task facts (type, interval ns, priority, watchdog, calls)
- [ ] 3.2 `runTask(name)` entry per task; implicit task when there is no `.task`
- [ ] 3.3 Tests: two tasks run only their own calls in order; shared globals; the no-task fallback equals today's main entry
