# -*- coding: utf-8 -*-
"""
Stop Volt (CODESYS Script Command / Execute Script File)

Aborts the connection started by start_volt_codesys.py: calls PipeHost.Stop(),
which closes the named pipe and drops the driver's change-event handlers.

start_volt_codesys.py already loaded the Volt.Cli.Ide.Codesys assembly into this
CODESYS process (from a temp copy), so the import below resolves it. If it is NOT
loaded, nothing was started — so we report that and exit WITHOUT loading the DLL:
loading it here would needlessly file-lock the install-dir copy (which is exactly
what blocks in-place updates) for zero work.
"""
from __future__ import print_function

try:
    import clr  # the .NET runtime bridge; the Volt namespace is already registered if start_volt_codesys.py ran
    from Volt.Cli.Ide.Codesys import PipeHost
except Exception:
    print("Volt: bridge not running in this CODESYS — nothing to stop")
else:
    try:
        print(PipeHost.Stop())
    except Exception as e:
        print("Volt: stop failed: %s" % str(e))
