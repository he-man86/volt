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
    # so its removal fails and the folder is left whole. It used to be a bare rmtree, on the theory that a running
    # session's locks make it fail — but rmtree deletes file by file, and only the assemblies ALREADY loaded are
    # locked: it stripped every dependency a running bridge had not loaded yet (this session's own on a second run,
    # another IDE's when a second CODESYS started Volt). The next lazy load of one then had no file beside the bridge,
    # and was answered from wherever else one was found — a second copy (openspec codesys-single-load-dependencies).
    # Best-effort; never let cleanup break activation.
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


def _unblock_dir(d):
    """Unblock every file we might load out of `d`. Returns how many streams were removed (0 is the normal case
    for an install that was not downloaded, and is not an error)."""
    removed = 0
    try:
        for name in os.listdir(d):
            if os.path.splitext(name)[1].lower() in _STAGE_EXTS:
                if _unblock(os.path.join(d, name)):
                    removed += 1
    except Exception:
        pass
    return removed


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
        wanted = [n for n in os.listdir(src_dir) if os.path.splitext(n)[1].lower() in _STAGE_EXTS]
        for name in wanted:
            try:
                shutil.copy2(os.path.join(src_dir, name), os.path.join(dst_dir, name))
            except Exception:
                pass
        # Every wanted file, not just the main DLL. A per-file copy can fail on its own (antivirus holds a
        # freshly downloaded DLL open), and checking only _DLL_NAME declared success over a half-copied folder -
        # which then failed later, at PipeHost.Start, naming whichever dependency was missing.
        missing = [n for n in wanted if not os.path.exists(os.path.join(dst_dir, n))]
        if missing:
            print("Volt: staging incomplete (%s); loading from %s instead" % (", ".join(missing), src_dir))
            return src
        return dst if os.path.exists(dst) else src
    except Exception:
        return src


def _off_sys_path():
    """Take every folder holding the bridge DLL off IronPython's sys.path, so IronPython can never load a Volt
    dependency itself.

    CODESYS puts the running script's folder on sys.path, and IronPython's AssemblyResolve handler, which runs before
    the bridge's own, answers a request that names no requesting assembly — the CLR raises those while reading a
    member's signature, e.g. Volt.Wire's System.Text.Json types — by LoadFile from the first sys.path folder holding
    the file. Run from the folder holding the DLLs (a downloaded bundle, the install dir), that loaded a SECOND
    System.Text.Json beside the bridge's own: two JsonElement types, and every call failed (openspec
    codesys-single-load-dependencies, measured 2026-10-07). With the folder off sys.path IronPython finds nothing and
    the bridge's resolver answers, from the folder the bridge was loaded from. Only the folders holding the bridge
    DLL: nothing of CODESYS's own (ScriptLib) is touched. Returns the folders removed."""
    import sys
    removed = []
    for p in list(sys.path):
        try:
            if os.path.exists(os.path.join(p, _DLL_NAME)):
                sys.path.remove(p)
                removed.append(p)
        except Exception:
            pass
    return removed


try:
    import clr
    _off_sys_path()
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
        # Assembly.LoadFrom, then hand the loaded assembly to clr — NOT clr.AddReferenceToFileAndPath. That call loads
        # with IronPython's own LoadFile, and IronPython then answers every dependency of an assembly IT loaded from
        # its AssemblyResolve handler (registered before the bridge's), probing sys.path IN ORDER. CODESYS puts the
        # running script's folder on sys.path, so a user who runs this file from the folder holding the DLLs (a
        # downloaded bundle, the install dir) got Volt.Wire, Volt.Contracts and one System.Text.Json from THAT folder
        # and another System.Text.Json from the staged one: two JsonElement types, every call failing with
        # MissingMethodException / MissingFieldException (measured live on 3.5.21.40, 2026-10-07; openspec
        # codesys-single-load-dependencies). Loaded here, the bridge is not IronPython's, so IronPython leaves the
        # requests the bridge's assemblies make alone, and the ones that name no requester find nothing on sys.path
        # (_off_sys_path): every dependency binds next to the bridge or through its own resolver, from the bridge's
        # folder — one copy, one folder. A second run of this script in the same IDE gets the copy already loaded
        # (LoadFrom returns it for the same identity).
        from System.Reflection import Assembly
        clr.AddReference(Assembly.LoadFrom(staged))
        from Volt.Ide.Codesys import PipeHost
        # projects / system / online are injected into every script's globals.
        # NOTE: CODESYS file-locks the loaded copy (in %TEMP%\Volt), NOT the install dir — so Volt can update while
        # the IDE is open. To pick up a REBUILT bridge, restart CODESYS (a new pid → a fresh copy).
        print(PipeHost.Start(projects, system, online))
except Exception as e:
    print("Volt: start failed: %s" % str(e))
