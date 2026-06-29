; Volt connector lifecycle — included into the desktop NSIS installer via electron-builder `nsis.include`
; (electron-builder.config.ts). The connector is the background system-tray gateway that bridges the agent
; to the live PLC IDEs; it ships inside the desktop install at resources\volt\connector\VoltConnector.exe
; and self-registers a per-user start-at-login item on first run.

!macro customInstall
  ; Launch the bundled connector once — it shows the tray + registers its start-at-login item, so it comes
  ; back on every login as the background gateway. Runs in the installing user's session (perMachine:false).
  ExecShell "" "$INSTDIR\resources\volt\connector\VoltConnector.exe"
!macroend

!macro customUnInstall
  ; Leave nothing running or auto-starting: stop the connector and drop its login item.
  nsExec::Exec 'taskkill /F /IM VoltConnector.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoltConnector"
!macroend
