# -*- coding: utf-8 -*-
# WHAT DOES A LIBRARY-SIGNATURE EXTRACTION COST, AND WHAT DOES IT LEAVE BEHIND? (openspec directed-library-signatures
# tasks 1.1 / 1.2)
#
# The runscript for a normal GUI CODESYS: it runs `run_pipe_production.py` verbatim (fixture open + the shipped
# `start_volt_codesys.py`, so the pipe is served exactly as `ide.ps1 up` serves it) and then leaves a UI timer behind
# that answers requests from `measure-library-signatures.ts`, which drives the fetches over the pipe. The timer runs on
# the IDE's UI thread - the thread the bridge's pipe calls run on too - so a request never interleaves with a fetch.
#
#   request : %LOCALAPPDATA%\volt-bridge\libsig-probe\<pid>\request   one line: "<id>|<command>|<argument>"
#   answer  : <id>.out (the answer, text) then <id>.done - or <id>.error with the reason
#
# Commands (all READ the IDE, except `edit` and `clean`):
#   messages          every message in the message view, per category: "<category>\t<count>" then the last 5 texts
#   libpaths          the precompiled LIBRARY signatures as they stand NOW (no build): "<count>\t<LibraryPath>" per
#                     distinct LibraryPath, read exactly as CodesysObjectModel.ExtractLibrarySignatures reads them
#                     (IsLibraryObject, no `__` name) - the raw strings the RESOLUTION matcher compares against
#   edit <name>       add a local INT to the POU <name> and a statement incrementing it, through scripting - what an
#                     engineer typing in the editor does to the project (it dirties the application)
#   clean             CODESYS's "Clean" of the active application (drops the compile information)
#
# Launch through ide.ps1 so the instance is tracked and closed:
#   pwsh scripts/ide.ps1 up -Vendor codesys -Instance directed-library-signatures -RunScript <this file> -Wait
#
# ASCII ONLY.
from __future__ import print_function
import os
import sys
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

# The production host, verbatim - the same `compile`+`exec` it uses for the shipped script, for the same reason.
_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))

import clr
clr.AddReference("System.Windows.Forms")
from System.Windows.Forms import Timer
from System.Diagnostics import Process

_DIR = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "libsig-probe", str(Process.GetCurrentProcess().Id))
if not os.path.isdir(_DIR):
    os.makedirs(_DIR)
_REQ = os.path.join(_DIR, "request")
if os.path.exists(_REQ):
    os.remove(_REQ)                              # a request left by a previous IDE with this pid answers nothing


def _messages():
    import System
    from System.Reflection import BindingFlags as B
    store = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.ScriptDriverSystem.APEnvironment")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("MessageStorage", B.Public | B.NonPublic | B.Static)
        if p is not None:
            store = p.GetValue(None, None)
            break
    if store is None:
        raise Exception("MessageStorage unreachable")
    cats = vp.prop(store, "Categories")
    if cats is None:
        raise Exception("MessageStorage exposes no Categories")
    out = []
    for cat in cats:
        ok, msgs = vp.call(store, "GetMessages", [cat])
        if not ok:
            raise Exception("GetMessages failed: " + str(msgs))
        msgs = list(msgs or [])
        desc = cat.GetType().Name
        out.append("%s\t%d" % (desc, len(msgs)))
        for m in msgs[-5:]:
            out.append("    " + str(vp.prop(m, "Text") or m).replace("\n", " ")[:160])
    return out


def _libpaths():
    import System
    lmm = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("LanguageModelMgr")
        if p is not None:
            lmm = p.GetValue(None, None)
            if lmm is not None:
                break
    if lmm is None:
        raise Exception("LanguageModelMgr unavailable")
    ok, sigs = vp.call(lmm, "AllPrecompiledSignatures", [True, True])
    if not ok:
        raise Exception("AllPrecompiledSignatures failed: " + str(sigs))
    counts = {}
    total = 0
    for s in sigs:
        if vp.prop(s, "IsLibraryObject") is not True:
            continue
        name = vp.prop(s, "Name")
        if not name or "__" in name:
            continue
        lp = vp.prop(s, "LibraryPath") or ""
        counts[lp] = counts.get(lp, 0) + 1
        total += 1
    out = ["TOTAL\t%d" % total]
    for lp in sorted(counts):
        out.append("%d\t%s" % (counts[lp], lp))
    return out


def _edit(name):
    # A CODE change, not a comment: a comment-only edit leaves CODESYS answering "The application is up to date"
    # (measured on the first run of this probe), which is not the edit an engineer makes.
    proj = projects.primary
    if proj is None:
        raise Exception("no project is open")
    found = [o for o in proj.find(name, True) if o.get_name() == name and getattr(o, "has_textual_implementation", False)]
    if len(found) != 1:
        raise Exception("expected ONE object named '%s' with a textual implementation, found %d" % (name, len(found)))
    pou = found[0]
    decl = pou.textual_declaration.text
    cut = decl.rfind("END_VAR")
    if cut >= 0:
        decl2 = decl[:cut] + "    vltLibsigProbe : INT;\n" + decl[cut:]
    else:
        decl2 = decl.rstrip() + "\nVAR\n    vltLibsigProbe : INT;\nEND_VAR\n"
    pou.textual_declaration.replace(decl2)
    impl = pou.textual_implementation.text
    pou.textual_implementation.replace(impl.rstrip() + "\nvltLibsigProbe := vltLibsigProbe + 1;\n")
    return ["edited %s: declaration %d -> %d chars, implementation %d -> %d chars" % (
        name, len(decl), len(pou.textual_declaration.text), len(impl), len(pou.textual_implementation.text))]


def _clean():
    # CODESYS's own "Clean" of the active application: drops the compile information, the state a cold session
    # starts from when the IDE has no cached compile info for the project.
    proj = projects.primary
    if proj is None:
        raise Exception("no project is open")
    app = proj.active_application
    if app is None:
        raise Exception("no active application")
    app.clean()
    return ["cleaned %s" % app.get_name()]


def _tick(sender, args):
    if not os.path.exists(_REQ):
        return
    rid = None
    try:
        with open(_REQ) as f:
            line = f.read().strip()
        os.remove(_REQ)
        rid, cmd, arg = (line.split("|") + ["", ""])[:3]
        if cmd == "messages":
            out = _messages()
        elif cmd == "libpaths":
            out = _libpaths()
        elif cmd == "edit":
            out = _edit(arg)
        elif cmd == "clean":
            out = _clean()
        else:
            raise Exception("unknown command '%s'" % cmd)
        with open(os.path.join(_DIR, rid + ".out"), "w") as f:
            f.write("\n".join(out) + "\n")
        open(os.path.join(_DIR, rid + ".done"), "w").close()
    except Exception:
        if rid is not None:
            with open(os.path.join(_DIR, rid + ".error"), "w") as f:
                f.write(traceback.format_exc())


_timer = Timer()
_timer.Interval = 200
_timer.Tick += _tick
_timer.Start()                                   # an enabled WinForms timer is rooted by the framework; it outlives this script
_log("libsig probe watching %s" % _DIR)
