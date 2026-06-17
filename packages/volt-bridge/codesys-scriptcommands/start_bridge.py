# -*- coding: utf-8 -*-
"""
Start Volt Bridge  (CODESYS Script Command / Execute Script File)

Runs inside the live CODESYS IDE. Loads the VoltBridge in-process host (C#) and
hands it the live scripting objects, so the Volt app can talk to *this* IDE
session over http://127.0.0.1:8556. All bridge logic lives in the C# DLL; this
script is only the launcher.

DLL resolution (first that exists wins):
  1. $VOLT_BRIDGE_DLL                                explicit override
  2. <this folder>/Volt.Bridge.Codesys.dll     production (installer ships
                                                      the DLL next to this script)
  3. repo build output (absolute)                    dev, this machine
"""
from __future__ import print_function
import os

_DLL_NAME = "Volt.Bridge.Codesys.dll"

# Dev build output on this machine (CODESYS "Execute Script File" does not set
# __file__, so we cannot resolve relative to the script — use an absolute path).
_REPO_BIN = r"C:\Users\marce\OneDrive\Documenten\Github\volt\packages\volt-bridge\src\Volt.Bridge.Codesys\bin"


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
        print("Volt bridge: DLL not found. Looked in:")
        for c in _candidates():
            print("   %s  (exists=%s)" % (c, os.path.exists(c) if c else False))
    else:
        print("Volt bridge: loading %s" % dll)
        clr.AddReferenceToFileAndPath(dll)
        from Volt.Bridge.Codesys import Host
        # projects / system / online are injected into every script's globals.
        # NOTE: CODESYS file-locks the DLL once loaded; to rebuild, close the IDE.
        print(Host.Start(projects, system, online))
except Exception as e:
    print("Volt bridge: start failed: %s" % str(e))
