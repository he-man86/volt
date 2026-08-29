# -*- coding: utf-8 -*-
"""
Start Volt (CODESYS Script Command / Execute Script File)

Runs inside the LIVE CODESYS IDE: loads Volt.Ide.Codesys and hands PipeHost
the live scripting objects, so the Volt toolchain talks to THIS IDE session over
the named pipe `volt.bridge.codesys.<pid>` (per-instance, so several CODESYS can
run at once). PipeHost.Start returns immediately; the IDE's own message loop keeps
the pipe served (no pump needed here — unlike run_pipe_headless.py).

Stop it again with stop_volt_codesys.py.

DLL resolution (first that exists wins):
  1. $VOLT_BRIDGE_DLL                              explicit override
  2. <this folder>/Volt.Ide.Codesys.dll       shipped beside this script (backup copy in the install dir)
  3. %LOCALAPPDATA%\Programs\Volt\...              the install dir — where the DLLs live when this script was
                                                   published to a visible folder (Documents\Volt) that has no DLL
(For the dev loop, codesys-pipe.ps1 sets VOLT_BRIDGE_DLL - case 1 - before running this.)
"""
from __future__ import print_function
import os
import shutil

_DLL_NAME = "Volt.Ide.Codesys.dll"
# What to copy beside the bridge DLL when staging it (below): everything the CLR probes for as a dependency.
_STAGE_EXTS = (".dll", ".config", ".json")

# The default per-user install dir subfolder that holds the bridge DLLs (installer/Volt.iss lays it here). Lets
# the visible Documents\Volt copy of this script find the DLLs that stay in the (hidden) install dir.
_INSTALL_SUBDIR = ("Programs", "Volt", "codesys-scriptcommands")



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
    # There is deliberately NO repo-build fallback here. This file used to carry an ABSOLUTE PATH into one
    # developer's home directory, which is dead weight on every path that matters: the dev loop goes through
    # VOLT_BRIDGE_DLL, which codesys-pipe.ps1 sets to the resolved DLL before running this script, and an
    # install finds the DLL beside the script or in the install dir. It only ever worked on one machine, and
    # it shipped.
    return out


def _find_dll():
    for c in _candidates():
        if c and os.path.exists(c):
            return c
    return None


def _temp_root():
    base = os.environ.get("TEMP") or os.environ.get("TMP")
    if not base:
        base = os.path.join(os.environ.get("LOCALAPPDATA", "."), "Temp")
    return os.path.join(base, "Volt", "codesys-bridge")


def _prune(root):
    # Drop copies left by CLOSED sessions. A still-running CODESYS keeps its dir file-locked, so rmtree fails on it
    # and leaves it intact — exactly right. Best-effort; never let cleanup break activation.
    try:
        for name in os.listdir(root):
            try:
                shutil.rmtree(os.path.join(root, name))
            except Exception:
                pass
    except Exception:
        pass


def _stage(src):
    """Copy the bridge DLL + its sibling deps to a PER-IDE-SESSION temp dir and load from the COPY, so CODESYS
    file-locks the copy — never the install-dir originals. That is what lets Volt UPDATE IN PLACE while CODESYS is
    open: loading straight from the install dir was why in-place updates hit 'DeleteFile failed; Access denied' on
    codesys-scriptcommands\\*.dll. The bridge's own AssemblyResolve keys off this DLL's load location, so its deps
    resolve from the copy too. Best-effort: on ANY failure, fall back to loading the original (old behaviour)."""
    try:
        src_dir = os.path.dirname(src)
        root = _temp_root()
        _prune(root)
        dst_dir = os.path.join(root, str(os.getpid()))  # os.getpid() == THIS CODESYS pid (matches the pipe name)
        dst = os.path.join(dst_dir, _DLL_NAME)
        if os.path.exists(dst):
            return dst  # already staged for this session (script re-run) — don't recopy a DLL we hold open
        if not os.path.isdir(dst_dir):
            os.makedirs(dst_dir)
        for name in os.listdir(src_dir):
            if os.path.splitext(name)[1].lower() in _STAGE_EXTS:
                try:
                    shutil.copy2(os.path.join(src_dir, name), os.path.join(dst_dir, name))
                except Exception:
                    pass
        return dst if os.path.exists(dst) else src
    except Exception:
        return src


try:
    import clr
    dll = _find_dll()
    if not dll:
        print("Volt: DLL not found. Looked in:")
        for c in _candidates():
            print("   %s  (exists=%s)" % (c, os.path.exists(c) if c else False))
    else:
        staged = _stage(dll)  # load a per-session COPY so the install-dir DLLs stay unlocked (in-place updates)
        print("Volt: loading %s" % staged)
        clr.AddReferenceToFileAndPath(staged)
        from Volt.Ide.Codesys import PipeHost
        # projects / system / online are injected into every script's globals.
        # NOTE: CODESYS file-locks the loaded copy (in %TEMP%\Volt), NOT the install dir — so Volt can update while
        # the IDE is open. To pick up a REBUILT bridge, restart CODESYS (a new pid → a fresh copy).
        print(PipeHost.Start(projects, system, online))
except Exception as e:
    print("Volt: start failed: %s" % str(e))
