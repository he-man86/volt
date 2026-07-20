# -*- coding: utf-8 -*-
"""
Start Volt (CODESYS Script Command / Execute Script File)

Runs inside the LIVE CODESYS IDE: loads Volt.Cli.Ide.Codesys and hands PipeHost
the live scripting objects, so the Volt toolchain talks to THIS IDE session over
the named pipe `volt.bridge.codesys.<pid>` (per-instance, so several CODESYS can
run at once). PipeHost.Start returns immediately; the IDE's own message loop keeps
the pipe served (no pump needed here — unlike run_pipe_headless.py).

Stop it again with stop_volt_codesys.py.

DLL resolution (first that exists wins):
  1. $VOLT_BRIDGE_DLL                              explicit override
  2. <this folder>/Volt.Cli.Ide.Codesys.dll       shipped beside this script (backup copy in the install dir)
  3. %LOCALAPPDATA%\Programs\Volt\...              the install dir — where the DLLs live when this script was
                                                   published to a visible folder (Documents\Volt) that has no DLL
  4. repo build output (absolute)                  dev, this machine
"""
from __future__ import print_function
import os

_DLL_NAME = "Volt.Cli.Ide.Codesys.dll"

# The default per-user install dir subfolder that holds the bridge DLLs (installer/Volt.iss lays it here). Lets
# the visible Documents\Volt copy of this script find the DLLs that stay in the (hidden) install dir.
_INSTALL_SUBDIR = ("Programs", "Volt", "codesys-scriptcommands")

# Dev build output on this machine (CODESYS "Execute Script File" does not set __file__).
_REPO_BIN = r"C:\Users\marce\Github\volt\packages\volt-cli\src\Volt.Cli.Ide.Codesys\bin"


def _script_dir():
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except Exception:
        return None


def _candidates():
    out = []
    env = os.environ.get("VOLT_BRIDGE_DLL")
    if env:
        out.append(env)
    here = _script_dir()
    if here:
        out.append(os.path.join(here, _DLL_NAME))
    # The install dir (the DLLs stay here even when this script was published to a visible Documents\Volt folder).
    local = os.environ.get("LOCALAPPDATA")
    if local:
        # IronPython 2.7 (CODESYS scripting) rejects f(a, *b, c) at PARSE time — keep the *-unpack trailing.
        out.append(os.path.join(local, *(_INSTALL_SUBDIR + (_DLL_NAME,))))
    out.append(os.path.join(_REPO_BIN, "Release", "net48", _DLL_NAME))
    out.append(os.path.join(_REPO_BIN, "Debug", "net48", _DLL_NAME))
    return out


def _find_dll():
    for c in _candidates():
        if c and os.path.exists(c):
            return c
    return None


try:
    import clr
    dll = _find_dll()
    if not dll:
        print("Volt: DLL not found. Looked in:")
        for c in _candidates():
            print("   %s  (exists=%s)" % (c, os.path.exists(c) if c else False))
    else:
        print("Volt: loading %s" % dll)
        clr.AddReferenceToFileAndPath(dll)
        from Volt.Cli.Ide.Codesys import PipeHost
        # projects / system / online are injected into every script's globals.
        # NOTE: CODESYS file-locks the DLL once loaded; to rebuild, close the IDE.
        print(PipeHost.Start(projects, system, online))
except Exception as e:
    print("Volt: start failed: %s" % str(e))
