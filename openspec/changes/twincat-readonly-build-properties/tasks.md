# Tasks

- [ ] 1 Reproduce on TwinCAT 4024: logged in (download / run / stop / no download), which build properties turn
      `readonly`; does a push work while logged in.
      - 2026-10-28 (open, not ticked): offline states measured NOT to set `readonly` (read-only files on disk, live and
        at solution open) — DIALECT C40. Online states unmeasured: Hyper-V blocks the real-time runtime; the user-mode
        runtime (`C:\TwinCAT.1\Runtimes`) is reachable but its trial licence needs a person to type the security code.
- [ ] 2 Read: accept a readonly build property's value when the IDE is online (or whatever state step 1 finds).
- [ ] 3 Write: refuse by name with the remedy ("log out of the PLC"), under a code PLC Assist can map.
- [ ] 4 DIALECT C40 amended; a regression test per state.
- [ ] 5 Tell PLC Assist the code and wording; it maps it in `volt-error-map.ts`.
