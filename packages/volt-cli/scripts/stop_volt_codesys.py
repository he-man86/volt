# -*- coding: utf-8 -*-
"""
Stop Volt (CODESYS Script Command / Execute Script File)

Aborts the connection started by start_volt_codesys.py: calls PipeHost.Stop(),
which closes the named pipe and drops the driver's change-event handlers. The
Volt.Cli.Ide.Codesys assembly is already loaded in this CODESYS process (start
loaded it), so the direct import normally succeeds; the DLL fallback is only for
running this stand-alone in a fresh IDE (where there is nothing to stop anyway).
"""
from __future__ import print_function
import os

_DLL_NAME = "Volt.Cli.Ide.Codesys.dll"
_INSTALL_SUBDIR = ("Programs", "Volt", "codesys-scriptcommands")
_REPO_BIN = r"C:\Users\marce\Github\volt\packages\volt-cli\src\Volt.Cli.Ide.Codesys\bin"


def _find_dll():
    out = []
    env = os.environ.get("VOLT_BRIDGE_DLL")
    if env:
        out.append(env)
    try:
        out.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), _DLL_NAME))
    except Exception:
        pass
    local = os.environ.get("LOCALAPPDATA")
    if local:
        # IronPython 2.7 (CODESYS scripting) rejects f(a, *b, c) at PARSE time — keep the *-unpack trailing.
        out.append(os.path.join(local, *(_INSTALL_SUBDIR + (_DLL_NAME,))))
    out.append(os.path.join(_REPO_BIN, "Release", "net48", _DLL_NAME))
    out.append(os.path.join(_REPO_BIN, "Debug", "net48", _DLL_NAME))
    for c in out:
        if c and os.path.exists(c):
            return c
    return None


try:
    import clr
    try:
        from Volt.Cli.Ide.Codesys import PipeHost  # already loaded by start_volt_codesys.py
    except Exception:
        dll = _find_dll()
        if not dll:
            print("Volt: bridge DLL not found — nothing to stop")
            raise SystemExit
        clr.AddReferenceToFileAndPath(dll)
        from Volt.Cli.Ide.Codesys import PipeHost
    print(PipeHost.Stop())
except SystemExit:
    pass
except Exception as e:
    print("Volt: stop failed: %s" % str(e))
