# -*- coding: utf-8 -*-
# WHICH MESSAGE CATEGORIES DOES A CODESYS BUILD WRITE, AND WHERE DOES SCRIPT OUTPUT LAND?
# (openspec codesys-build-own-messages-only 1.1 / 1.2)
#
# The bridge's `build` read EVERY category of `APEnvironment.MessageStorage`. PLCAssist saw script output and a
# script's stderr come back as build diagnostics, and a stderr line fail every later build of a clean project. This
# is the runscript for a normal GUI CODESYS (`ide.ps1 up -Vendor codesys -RunScript <this>`): it runs
# `run_pipe_production.py` verbatim (fixture open + the shipped bridge start), then arms a UI timer that answers
# request files, so the `build` and the directed library read go through the PIPE exactly as a client makes them,
# and the store is read between them.
#
#   request : %LOCALAPPDATA%\volt-bridge\build-own-messages.req   one line: "dump|<label>" or "emit|<label>"
#     dump  - log every category of MessageStorage the way the bridge enumerates it (type, every readable property)
#             and every message in it (severity, Number, text)
#     emit  - print a line and write a line to stderr, as a user's script does
#     addlib|dellib - add/remove a placeholder to a library installed nowhere (where does "unresolved" land?)
#     plant|unplant - put an undeclared identifier in PLC_PRG / restore it (a real compile error)
#     exec|<file> - run a python file here, on the UI thread (an ad-hoc read)
#   answer  : $VOLT_PROBE_LOG (default build-own-messages.log beside this script); the .req is then deleted
#
# It reads the store; the only writes (addlib, plant) go to the fixture COPY ide.ps1 opened. ASCII ONLY - IronPython 2.7.
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "build-own-messages.log")
_REQ = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "build-own-messages.req")


def _plog(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


# Before the host: the script output a user's script leaves behind BEFORE the bridge starts.
print("VoltProbe: stdout line before the bridge")
sys.stderr.write("VoltProbe: stderr line before the bridge\n")

_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))


def _store():
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.ScriptDriverSystem.APEnvironment")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("MessageStorage", vp.bf() | __import__("System").Reflection.BindingFlags.Static)
        if p is not None:
            return p.GetValue(None, None)
    return None


def _props(o):
    out = []
    try:
        for i in [o.GetType()] + list(o.GetType().GetInterfaces()):
            for p in i.GetProperties():
                if p.GetIndexParameters().Length:
                    continue
                try:
                    out.append("%s=%s" % (p.Name, p.GetValue(o, None)))
                except Exception:
                    pass
    except Exception as e:
        out.append("props FAILED %s" % e)
    return sorted(set(out))


def _dump(label):
    _plog("")
    _plog("== dump: " + label)
    store = _store()
    if store is None:
        _plog("   MessageStorage UNREACHABLE")
        return
    for cat in vp.prop(store, "Categories"):
        ok, msgs = vp.call(store, "GetMessages", [cat])
        msgs = list(msgs) if ok and msgs is not None else []
        _plog("   category %s  %s" % (cat.GetType().FullName, " ".join(_props(cat))))
        _plog("      %d message(s)" % len(msgs))
        for m in msgs:
            _plog("      [%s] #%s %s guid=%s" % (vp.prop(m, "Severity"), vp.prop(m, "Number"),
                                               (vp.prop(m, "Text") or "").replace("\n", " | "), vp.prop(m, "ObjectGuid")))


def _emit(label):
    print("VoltProbe: stdout line (" + label + ")")
    sys.stderr.write("VoltProbe: stderr line (" + label + ")\n")
    _plog("")
    _plog("== emitted stdout + stderr: " + label)


def _prg():
    return [o for o in projects.primary.find("PLC_PRG", True) if getattr(o, "has_textual_implementation", False)][0]


_KEPT = {}


def _lib(verb, label):
    # A library reference that is installed nowhere: where does the build put "cannot resolve"?
    lm = [o for o in projects.primary.find("Library Manager", True)][0]
    if verb == "addlib":
        try:
            lm.add_placeholder("VoltMissingLib", "VoltMissingLib, 1.0.0.0 (Volt Probe)")
            _plog("== added placeholder VoltMissingLib: " + label)
        except Exception as e:
            _plog("== add_placeholder FAILED %s; trying add_library" % e)
            lm.add_library("VoltMissingLib, 1.0.0.0 (Volt Probe)")
            _plog("== added library VoltMissingLib: " + label)
    else:
        lm.remove_library("#VoltMissingLib")
        _plog("== removed VoltMissingLib: " + label)


def _plant(verb, label):
    impl = _prg().textual_implementation
    if verb == "plant":
        _KEPT["prg"] = impl.text
        impl.replace("voltProbeUndeclared := 1;\n")
        _plog("== planted a compile error in PLC_PRG: " + label)
    else:
        impl.replace(_KEPT.pop("prg"))
        _plog("== restored PLC_PRG: " + label)


def _tick(sender, args):
    if not os.path.exists(_REQ):
        return
    try:
        with open(_REQ) as f:
            line = f.read().strip()
        os.remove(_REQ)
        verb, _, label = line.partition("|")
        if verb == "emit":
            _emit(label)
        elif verb in ("addlib", "dellib"):
            _lib(verb, label)
        elif verb in ("plant", "unplant"):
            _plant(verb, label)
        elif verb == "exec":
            # label = a python file run here, on the UI thread, with this namespace (an ad-hoc read)
            with open(label) as f:
                exec(compile(f.read(), label, "exec"), globals())
        else:
            _dump(label)
        _plog("== done: " + label)
    except Exception:
        import traceback
        _plog(traceback.format_exc())


import clr
clr.AddReference("System.Windows.Forms")
import System
from System.Windows.Forms import Timer

_timer = Timer()
_timer.Interval = 1000
_timer.Tick += _tick
_timer.Start()
System.AppDomain.CurrentDomain.SetData("volt.probe.build-own-messages", _timer)
_plog("probe timer armed; request file: " + _REQ)
