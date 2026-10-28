# Tasks

- [ ] 1 Reproduce on TwinCAT 4024: logged in (download / run / stop / no download), which build properties turn
      `readonly`; does a push work while logged in.
      - 2026-10-28 (open, not ticked): offline states measured NOT to set `readonly` (read-only files on disk, live and
        at solution open) — DIALECT C40. Online states unmeasured: Hyper-V blocks the real-time runtime; the user-mode
        runtime (`C:\TwinCAT.1\Runtimes`) is reachable but its trial licence needs a person to type the security code.
      - 2026-10-28, the read until step 1 measures: the refusal names EVERY read-only build property on the object
        (`AdditionalAllocation` checked too — it was not), so the next field log says which ones; a read-only `Exclude`
        is read as inherited only on a member of an excluded POU (C39's measurement) and refused by name anywhere else
        — read as inherited, an object whose OWN exclusion turned read-only would pull as built (DIALECT C39, C40).
- [ ] 2 Read: accept a readonly build property's value when the IDE is online (or whatever state step 1 finds).
- [ ] 3 Write: refuse by name with the remedy ("log out of the PLC"), under a code PLC Assist can map.
- [ ] 4 DIALECT C40 amended; a regression test per state.
- [ ] 5 Tell PLC Assist the code and wording; it maps it in `volt-error-map.ts`.
