; Volt CLI installer — the "advanced user" channel (CLI + VS Code). Mirrors opencode's curl-installs-the-CLI
; as a Windows installer: puts `volt` on PATH and installs the bridge (connector) + LSP. SEPARATE from the
; desktop app (it installs to %USERPROFILE%\.volt, not Programs\Volt) and bows out if the desktop is present
; (the desktop is a superset). Built by volt-scripts/build-cli-installer.ts. Pass /DVERSION /DDIST /DOUTDIR.

Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0-dev"
!endif
!ifndef OUTDIR
  !define OUTDIR "."
!endif
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoltCLI"

Name "Volt CLI ${VERSION}"
OutFile "${OUTDIR}\Volt-CLI-Setup-${VERSION}-x64.exe"
InstallDir "$PROFILE\.volt"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; The desktop app already integrates the CLI + bridge — don't double-install (would collide on PATH/connector).
  ; Key off the desktop's bundled CLI (constant across the Volt/Volt Dev/Volt Beta channels), not the GUI exe.
  IfFileExists "$LOCALAPPDATA\Programs\Volt\resources\volt\bin\volt.exe" 0 notDesktop
    MessageBox MB_OK|MB_ICONINFORMATION "The Volt desktop app is already installed and includes the CLI + bridge.$\r$\nYou don't need the CLI installer." /SD IDOK
    Abort
  notDesktop:
FunctionEnd

Section "Volt CLI"
  ; --- the binaries (volt + the ST LSP) ---
  SetOutPath "$INSTDIR\bin"
  File "${DIST}\bin\volt.exe"
  File "${DIST}\bin\volt-lsp-codesys.exe"
  ; --- the self-contained bridge/connector ---
  SetOutPath "$INSTDIR\connector"
  File /r "${DIST}\connector\*"
  ; --- the PATH helper, kept for the uninstaller ---
  SetOutPath "$INSTDIR"
  File "${__FILEDIR__}\volt-path.ps1"

  ; Put `volt` on PATH (idempotent, per-user). volt-path.ps1 uses .NET SetEnvironmentVariable, which itself
  ; broadcasts WM_SETTINGCHANGE so new shells pick it up — no explicit SendMessage needed.
  DetailPrint "Adding volt to your PATH..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\volt-path.ps1" add "$INSTDIR\bin"'

  ; Start the background bridge connector — it shows the tray + self-registers its start-at-login item.
  DetailPrint "Starting the Volt bridge connector..."
  ExecShell "" "$INSTDIR\connector\VoltConnector.exe"

  ; Uninstaller + Add/Remove Programs entry.
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "Volt CLI"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "Volt"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify"        1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair"        1
SectionEnd

Section "Uninstall"
  ; Stop the connector + drop its start-at-login item (mirrors connector.nsh's customUnInstall).
  nsExec::Exec 'taskkill /F /IM VoltConnector.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VoltConnector"
  ; Remove `volt` from PATH (uses the installed helper, before it is deleted).
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\volt-path.ps1" remove "$INSTDIR\bin"'
  ; Wipe the install. The big payload (bin + connector) goes immediately; the running Uninstall.exe + the
  ; now-empty dir are scheduled for the next reboot (NSIS can't delete a running exe).
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\connector"
  Delete "$INSTDIR\volt-path.ps1"
  Delete /REBOOTOK "$INSTDIR\Uninstall.exe"
  RMDir /REBOOTOK "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
