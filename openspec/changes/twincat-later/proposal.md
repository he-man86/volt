## Why

Deferred by the owner on 2026-10-14 ("we will do more TC later", "VMs are ok for now") so `environment-dependency-audit` and
`twincat-x64-solution-explorer-marshaling` can close for the release. Everything here was measured as open, nothing is
dropped:

- **TwinCAT 64-bit XAE shell (3.1.4026, TcXaeShell64):** never measured. The worker picks its hierarchy reader by the XAE's
  bitness and reads a 64-bit shell in-process with that shell's own amd64 msenvp manifest — tested offline only (from
  `environment-dependency-audit` 2.3 and `twincat-x64-solution-explorer-marshaling` 1.4). TwinCAT 4026 downloads only with
  a myBeckhoff login and installs elevated.
- **32-bit CODESYS beyond SP21:** 32-bit SP18 and SP22 are not installed (only 32-bit 3.5.21.60 ran, green) — from
  `environment-dependency-audit` 2.6.
- **The VM cells** of the checklist in `scripts/README.md`: a TwinCAT-only 4024 machine, a tr-TR/ru-RU system locale with the
  real IDEs, Windows 10 LTSC 2019 (.NET Framework 4.7.2), a non-admin user with a Cyrillic name, no git on PATH, a CPU
  without AVX2 — from `environment-dependency-audit` 3.2. The dev machine has no Hyper-V; VirtualBox is installed.

## What Changes

Install what each check needs (owner allows installs), run it, record the result in DIALECT and the release matrix, and fix
what fails — test-first, under the same one-to-one and plain-machine rules.

## Impact

`packages/volt-cli` (TwinCAT driver, ide.ps1, the release matrix), DIALECT V-rows, `scripts/README.md`. No change unless a
check fails.
