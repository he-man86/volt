@echo off
REM Volt CLI wrapper for Windows.
REM
REM bun on Windows does not create node_modules\.bin symlinks for private
REM workspace packages, so the bare bin name `volt` (declared in
REM packages\volt-cli\package.json) does not resolve from cmd / PowerShell.
REM This wrapper bridges the gap: drop %~dp0 (this directory) on your PATH
REM and `volt <verb>` works from any cwd, exactly like a published CLI.
REM
REM We invoke the TypeScript source directly via `bun` — no build step
REM required, and bun resolves workspace imports natively.
bun "%~dp0..\packages\volt-cli\dist\bin.js" %*
