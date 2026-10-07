# -*- coding: utf-8 -*-
"""
Start Volt (CODESYS Script Command / Execute Script File)

Runs inside the LIVE CODESYS IDE: loads Volt.Ide.Codesys and hands PipeHost
the live scripting objects, so the Volt toolchain talks to THIS IDE session over
the named pipe `volt.bridge.codesys.<pid>` (per-instance, so several CODESYS can
run at once). PipeHost.Start returns immediately; the IDE's own message loop keeps
the pipe served (no pump needed here — the IDE has one).

Stop it again with stop_volt_codesys.py.

DLL resolution (first that exists wins):
  1. $VOLT_BRIDGE_DLL                              explicit override
  2. <this folder>/Volt.Ide.Codesys.dll       shipped beside this script (backup copy in the install dir)
  3. %LOCALAPPDATA%\Programs\Volt\...              the install dir — where the DLLs live when this script was
                                                   published to a visible folder (Documents\Volt) that has no DLL
(For the dev loop, ide.ps1 sets VOLT_BRIDGE_DLL - case 1 - before running this.)
"""
from __future__ import print_function
import os
import shutil

_DLL_NAME = "Volt.Ide.Codesys.dll"
# The bridge is ONE assembly: Volt.* and System.Text.Json (with its net48 dependencies) are merged into it and
# internalized at build, so CODESYS is asked to resolve nothing of Volt's (openspec codesys-bridge-single-assembly).
# Staging copies that one file, and the relay sidecars the bridge reads from its own folder (setup.json,
# volt-relay.json).
_SIDECAR_EXT = ".json"

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
    # VOLT_BRIDGE_DLL, which ide.ps1 sets to the resolved DLL before running this script, and an
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
    # Drop copies left by CLOSED sessions, and ONLY those. The bridge DLL goes first: a running session holds it loaded,
    # so its removal fails and the folder is left whole (its relay sidecars with it). Best-effort; never let cleanup
    # break activation.
    try:
        for name in os.listdir(root):
            d = os.path.join(root, name)
            try:
                if os.path.exists(os.path.join(d, _DLL_NAME)):
                    os.remove(os.path.join(d, _DLL_NAME))   # raises while a session has it loaded
                shutil.rmtree(d)
            except Exception:
                pass
    except Exception:
        pass


def _unblock(path):
    """Delete the Zone.Identifier stream Windows puts on a file extracted from a DOWNLOADED zip.

    .NET Framework refuses to load an assembly carrying that stream: "An attempt was made to load an assembly
    from a network location ... you must enable the loadFromRemoteSources switch". The host here is CODESYS.exe,
    whose app.config we do not own, so the switch is not available to us - the mark has to go instead.

    Reproduced 2026-09-25: the bridge zip is served over https, so every file Explorer's "Extract All" writes is
    marked. Loading the marked folder fails; deleting the streams makes the identical load succeed. It surfaced
    as "Could not load file or assembly 'Volt.Wire, Version=1.0.0.0 ... or one of its dependencies" at
    PipeHost.Start, because the main DLL is staged (a copy drops the stream) while a dependency still resolved
    from the marked original.

    Deleting an alternate data stream is just os.remove on 'file:stream'. Best-effort by design: a file that has
    no stream, or that we may not write, raises and is skipped."""
    try:
        os.remove(path + ":Zone.Identifier")
        return True
    except Exception:
        return False


def _staged_files(d):
    """What staging copies out of `d`: the bridge DLL and the relay sidecars."""
    return [n for n in os.listdir(d) if n == _DLL_NAME or os.path.splitext(n)[1].lower() == _SIDECAR_EXT]


def _unblock_dir(d):
    """Unblock every file we might load out of `d`. Returns how many streams were removed (0 is the normal case
    for an install that was not downloaded, and is not an error)."""
    removed = 0
    try:
        for name in _staged_files(d):
            if _unblock(os.path.join(d, name)):
                removed += 1
    except Exception:
        pass
    return removed


def _stage(src):
    """Copy the bridge DLL (and the relay sidecars) to a PER-IDE-SESSION temp dir and load from the COPY, so CODESYS
    file-locks the copy — never the install-dir original. That is what lets Volt UPDATE IN PLACE while CODESYS is
    open: loading straight from the install dir was why in-place updates hit 'DeleteFile failed; Access denied' on
    codesys-scriptcommands\\*.dll. Best-effort: on ANY failure, load the original instead."""
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
        wanted = _staged_files(src_dir)
        for name in wanted:
            try:
                shutil.copy2(os.path.join(src_dir, name), os.path.join(dst_dir, name))
            except Exception:
                pass
        # Every wanted file, not just the DLL: a per-file copy can fail on its own (antivirus holds a freshly
        # downloaded file open), and a staged bridge without its relay sidecar would start without its tunnel.
        missing = [n for n in wanted if not os.path.exists(os.path.join(dst_dir, n))]
        if missing:
            print("Volt: staging incomplete (%s); loading from %s instead" % (", ".join(missing), src_dir))
            return src
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
        # BEFORE staging, and on the SOURCE: a copy already drops the stream, but _stage falls back to loading the
        # source itself. Unblocking here covers every path.
        freed = _unblock_dir(os.path.dirname(dll))
        if freed:
            print("Volt: unblocked %d downloaded file(s) in %s" % (freed, os.path.dirname(dll)))
        staged = _stage(dll)  # load a per-session COPY so the install-dir DLLs stay unlocked (in-place updates)
        _unblock_dir(os.path.dirname(staged))
        print("Volt: loading %s" % staged)
        # Assembly.LoadFrom, then hand the loaded assembly to clr. A second run of this script in the same IDE (from
        # this folder or another) then gets the copy already loaded: LoadFrom returns it for the same identity, where
        # clr.AddReferenceToFileAndPath (IronPython's own LoadFile) loads a file from a NEW path as a second copy.
        from System.Reflection import Assembly
        clr.AddReference(Assembly.LoadFrom(staged))
        from Volt.Ide.Codesys import PipeHost
        # projects / system / online are injected into every script's globals.
        # NOTE: CODESYS file-locks the loaded copy (in %TEMP%\Volt), NOT the install dir — so Volt can update while
        # the IDE is open. To pick up a REBUILT bridge, restart CODESYS (a new pid → a fresh copy).
        print(PipeHost.Start(projects, system, online))
except Exception as e:
    print("Volt: start failed: %s" % str(e))
