; Volt connector lifecycle — included into the desktop NSIS installer via electron-builder `nsis.include`
; (electron-builder.config.ts). The connector is the background system-tray gateway that bridges the agent
; to the live PLC IDEs; it ships inside the desktop install at resources\volt\connector\VoltConnector.exe
; and self-registers a per-user start-at-login item on first run.

!macro customInstall
  ; Put `volt` on PATH (idempotent) so a desktop user can also use the terminal CLI + the VS Code extension.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\volt\bin\volt-path.ps1" add "$INSTDIR\resources\volt\bin"'
  ; Launch the bundled connector once — it shows the tray + registers its start-at-login item, so it comes
  ; back on every login as the background gateway. Runs in the installing user's session (perMachine:false).
  ExecShell "" "$INSTDIR\resources\volt\connector\VoltConnector.exe"
  ; Sideload the Volt VS Code extension into any editor found (VS Code / Windsurf / Cursor / VSCodium), so one
  ; install carries the editor integration too. Best-effort — no editor = skipped.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\volt\bin\volt-extension.ps1" install "$INSTDIR\resources\volt\volt-vscode.vsix"'
!macroend

!macro customUnInstall
  ; Stop the connector AND the bridge workers it spawns (e.g. Volt.Bridge.Beckhoff.exe) — killing only the
  ; connector leaves a worker running, holding the install dir open so it can't be fully removed. /T kills the
  ; process tree; the explicit worker kill catches any detached one.
  nsExec::Exec 'taskkill /F /T /IM VoltConnector.exe'
  nsExec::Exec 'taskkill /F /IM Volt.Bridge.Beckhoff.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoltConnector"
  ; Remove `volt` from PATH (customUnInstall runs before electron-builder deletes the install files).
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\volt\bin\volt-path.ps1" remove "$INSTDIR\resources\volt\bin"'
  ; Drop the volt:// protocol handler the app registers at runtime (setAsDefaultProtocolClient) — the NSIS
  ; uninstaller doesn't track runtime registry writes, so it would otherwise linger as a dangling handler.
  DeleteRegKey HKCU "Software\Classes\volt"
  ; Remove the Volt VS Code extension from the user's editors (matches the install-time sideload).
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\volt\bin\volt-extension.ps1" uninstall'
  ; Let the killed processes release their handles before the tree is removed.
  Sleep 2000
!macroend

!macro customRemoveFiles
  ; Remove the whole install tree. electron-builder's default RMDir can strand an empty root dir when a
  ; transient external handle (Windows Search indexer / AV) is open on it — /REBOOTOK guarantees it's gone on
  ; the next reboot if still locked, so nothing is left behind.
  RMDir /r /REBOOTOK "$INSTDIR"
!macroend
