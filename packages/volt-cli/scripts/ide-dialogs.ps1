#Requires -Version 5.1
# WHAT `ide.ps1 up` SAYS about a TwinCAT XAE's modal dialog it does not answer, and about an XAE that exits before a
# worker attached. Pure: no window or process access, so `test/unit/ide-dialogs.test.ts` proves it offline. `ide.ps1`
# dot-sources this file and feeds it what it read from the windows (Watch-XaeDialogs). The release matrix quotes these
# lines in a red cell's verdict (`upFailure`), so a fault is named by what the dialog SAID and a green rerun cannot
# erase it.

# One line per dialog: its title, its message (every child that is not a button and shows text, in window order) and
# its buttons. `$Kids` are objects with `Class` and `Text`.
function Format-XaeDialog([int]$Xae, [string]$Title, $Kids) {
    $flat = { param($t) (($t -split "\r?\n") | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join " " }
    $message = @($Kids | Where-Object { $_.Class -ne "Button" -and $_.Text } | ForEach-Object { & $flat $_.Text } | Where-Object { $_ })
    $buttons = @($Kids | Where-Object { $_.Class -eq "Button" -and $_.Text } | ForEach-Object { $_.Text })
    $said = if ($message.Count) { $message -join " | " } else { "(no readable message)" }
    "XAE $Xae shows a modal dialog '$Title': $said (buttons: $($buttons -join ', ')) - not one ide.ps1 answers; left as is"
}

# The XAE is gone before any worker attached: nothing more to wait for, and the dialogs it showed are why.
function Format-XaeExit([int]$Xae, [string[]]$Dialogs) {
    $shown = @($Dialogs | Where-Object { $_ })
    if ($shown.Count) { "XAE $Xae exited before a worker attached; it showed: $($shown -join ' | ')" }
    else { "XAE $Xae exited before a worker attached; it showed no dialog" }
}
