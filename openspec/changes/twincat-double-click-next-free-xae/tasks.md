## 1. Tests red (offline: pid source, claim, caption, console and wait injected)

- [ ] 1.1 Candidate list with an injected claim: pids 1234 (claim fails) and 5678 → serves 5678; nothing is attached to
      or bound for 1234. Today: `found[0]` (`Program.cs:96`), attach, then exit 3.
- [ ] 1.2 Two free pids → serves the first; the console names it (pid + caption) and names the other.
- [ ] 1.3 Every claim fails → the console names each pid with its caption as already served by another Volt bridge,
      prints again only when the list changes, keeps scanning; a claim that later succeeds → serves that pid.
- [ ] 1.4 No pid for longer than 10 minutes (injected wait) → still scanning. Today: exit 2 (`:101-105`).
- [ ] 1.5 A failure after the claim (host start throws) and an exception before it → reason on the console, the start
      waits for Enter before it returns.
- [ ] 1.6 `--xae-pid` with a held name → exit 3, reason in the log, and the attach was never called.
- [ ] 1.7 ROT pid list (over `RotEntry` doubles that count their `Bind` calls): no entry whose name states a pid is
      bound; an entry whose name states no pid is bound, asked and released, as `PickWindow`'s test does.
- [ ] 1.8 `PipeServer` started under a claim taken before it serves that name; a second claim of the name fails while
      the first is held, and succeeds after it is released or abandoned (`PipeServer.cs:103-106`).

## 2. Implement

- [ ] 2.1 `PipeServer.TakeName` callable before `Start`, returning the claim the server then serves under (one
      `MutexName`; taken and released on the same thread, the mutex being thread-affine).
- [ ] 2.2 `RotInstances`: the pid list from display names (`PidInName`), binding only name-without-pid entries.
- [ ] 2.3 The no-argument start as a class: scan → claim → attach, or name the served windows and keep scanning; no
      deadline; every unrequested exit prints and waits for Enter. `--xae-pid` claims before attach. `Program.cs`
      calls it.

## 3. Live (stop gate: a result that contradicts the design stops the change and is reported, never guessed around)

- [ ] 3.1 TwinCAT 4024, two XAE windows: double-click twice → each copy serves its own window; a third copy names both
      as served and keeps scanning; stopping one bridge → the third serves that window. Record in DIALECT.
