@echo off
REM Volt CLI wrapper for Windows.
REM
REM bun on Windows does not create node_modules\.bin symlinks for private
REM workspace packages, so the bare bin name `volt` (declared in
REM packages\volt-git\package.json) does not resolve from cmd / PowerShell.
REM This wrapper bridges the gap: drop %~dp0 (this directory) on your PATH
REM and `volt <verb>` works from any cwd, exactly like a published CLI.
bun "%~dp0..\packages\volt-git\dist\bin.js" %*
