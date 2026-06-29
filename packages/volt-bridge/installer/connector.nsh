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
!macroend

!macro customUnInstall
  ; Leave nothing running or auto-starting: stop the connector and drop its login item.
  nsExec::Exec 'taskkill /F /IM VoltConnector.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoltConnector"
  ; Remove `volt` from PATH (customUnInstall runs before electron-builder deletes the install files).
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\volt\bin\volt-path.ps1" remove "$INSTDIR\resources\volt\bin"'
!macroend
