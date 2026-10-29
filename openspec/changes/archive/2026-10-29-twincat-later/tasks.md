## 1. TwinCAT 64-bit shell

- [ ] 1.1 Install TwinCAT 3.1.4026 with TcXaeShell64 side by side (myBeckhoff login, elevated — the owner's step).
- [ ] 1.2 Live: the hierarchy read on the 64-bit XAE (does the shell ship an amd64 `Automation\msenvp.dll.manifest`? is a
      global 64-bit registration needed?), `bun run release:matrix --only twincat-64`, full TwinCAT e2e on 4026 with its own
      native fixture; fix test-first what fails; DIALECT row.

## 2. CODESYS 32-bit span

- [ ] 2.1 Install 32-bit SP18 and SP22; native fixtures (`scripts/author-version-fixture.py`); e2e on both.

## 3. VM cells

- [ ] 3.1 The VM checklist (`scripts/README.md`) on VirtualBox VMs: TwinCAT-only 4024, tr-TR and ru-RU system locale, Windows
      10 LTSC 2019, non-admin Cyrillic user, no git on PATH, no AVX2; results recorded; failures fixed test-first.

## Close-out (2026-10-29, owner: "close these for now") — closed unfinished

Nothing built. Parked on the owner's own steps (a runner machine with the IDE variants; TwinCAT 4026 / 32-bit SP installs
behind a myBeckhoff login and VM cells). Reopen as a new change when those exist; this file is the plan to start from.
