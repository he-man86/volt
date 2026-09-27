# -*- coding: utf-8 -*-
# What a `volt push` of a DUT SUBTYPE CHANGE does to the CODESYS object - read between pushes, in the SAME live IDE
# the pushes go through.
#
# openspec `dut-subtype-on-the-wire` task 1.1 (CODESYS half) and the text-list-enum row of DIALECT C2e.
# `probe-dut-subtype-in-place.py` answered 1.3 by writing through scripting (`textual_declaration.replace`); that is
# not the path a user takes. A push writes through the bridge - `CodesysObjectModel.WriteSourceText`, i.e.
# `GetObjectToModify(handle, guid)` and `SetAspectText(iobj, "Interface", ...)` - and whether the object's GUID,
# folder and shape survive THAT write has to be read off the IDE the bridge is serving, not argued from the code.
#
# So this is the runscript for a normal GUI CODESYS: it runs `run_pipe_production.py` verbatim (fixture open + the
# shipped `start_volt_codesys.py`, so the pipe is served exactly as `ide.ps1 up` serves it), and then leaves a UI
# timer behind that answers READ requests. The pushes are made from outside with `volt push`; between them the
# caller drops a request file and this logs, for every object it names:
#   guid, parent folder, the Object-interfaces of the IObject (IDUTObject vs ITextListEnumerationObject), whether
#   the IObject has an `Interface` aspect with a TextDocument (the thing `SetAspectText` writes into), and the
#   declaration text that aspect holds.
# It only READS. The timer runs on the IDE's UI thread - the thread the bridge's own pipe calls run on - so a read
# never races a push.
#
#   request : %LOCALAPPDATA%\volt-bridge\dut-probe.req   one line: "<label>|<name>,<name>,..."   (prefix* allowed)
#   answer  : $VOLT_PROBE_LOG (default: dut-subtype-push.log beside this script), then the .req is deleted
#
# Launch (the same arguments `ide.ps1 up -Vendor codesys` uses, with this file as the runscript):
#   $env:VOLT_BRIDGE_DLL = "<repo>\packages\volt-cli\src\Volt.Ide.Codesys\bin\Release\net48\Volt.Ide.Codesys.dll"
#   $env:VOLT_FIXTURE_PROJECT = "<a COPY of a committed fixture>"
#   & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" --profile="CODESYS V3.5 SP21 Patch 4" `
#     --runscript="<repo>\packages\volt-cli\scripts\probe-dut-subtype-push.py"
#
# ASCII ONLY.
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "dut-subtype-push.log")
_REQ = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "dut-probe.req")


# NOT `_log`: the host script below is exec'd into THIS namespace and defines its own `_log` (the launcher log),
# which would silently rebind ours - the first run of this probe wrote its answers into bridge-launcher.log.
def _plog(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


# The production host, verbatim - the same `compile`+`exec` it uses for the shipped script, for the same reason.
_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))


def _matches(name, wanted):
    for w in wanted:
        if w.endswith("*"):
            if name.startswith(w[:-1]):
                return True
        elif name == w:
            return True
    return False


def _describe(mgr, o):
    raw = vp.unwrap(o)
    guid = vp.prop(raw, "guid")
    handle = vp.prop(raw, "handle")
    parent = o.parent.get_name() if o.parent is not None else "<root>"
    ok, meta = vp.call(mgr, "GetObjectToRead", [handle, guid])
    iobj = vp.prop(meta, "Object") if ok else None
    # A read that FAILS must say so and why - "no Interface aspect" and "could not read the object" are different
    # answers, and the first run of this probe printed both as `Interface-aspect=False`.
    if not ok:
        return "%-26s guid %s  in '%s'  READ FAILED (handle %r %s): %s" % (
            o.get_name(), guid, parent, handle, type(handle).__name__, meta)
    ifaces = sorted(i.Name for i in iobj.GetType().GetInterfaces() if i.Name.endswith("Object")) if iobj is not None else []
    ifaces = [i for i in ifaces if i in ("IDUTObject", "ITextListEnumerationObject", "IEnumerationObject")] or ifaces[:6]
    aspect = vp.prop(iobj, "Interface") if iobj is not None else None
    doc = vp.prop(aspect, "TextDocument") if aspect is not None else None
    text = vp.prop(doc, "Text") if doc is not None else None
    head = " | ".join([l.strip() for l in (text or "").split("\n") if l.strip()][:4])
    return "%-26s guid %s  in '%s'  %s  Interface-aspect=%s TextDocument=%s  decl: %s" % (
        o.get_name(), guid, parent, "+".join(ifaces), aspect is not None, doc is not None, head)


def _answer(label, wanted):
    mgr = vp.object_manager()
    proj = projects.primary
    _plog("")
    _plog("== " + label)
    hits = [o for o in vp.walk(proj) if _matches(o.get_name(), wanted)]
    # The task call entry of a program shares its name; only objects that have a declaration are DUT candidates.
    hits = [o for o in hits if getattr(o, "has_textual_declaration", True)]
    if not hits:
        _plog("   (no object named %s)" % ",".join(wanted))
    for o in hits:
        try:
            _plog("   " + _describe(mgr, o))
        except Exception as e:
            _plog("   %s: read FAILED %s" % (o.get_name(), e))


def _tick(sender, args):
    if not os.path.exists(_REQ):
        return
    try:
        with open(_REQ) as f:
            line = f.read().strip()
        os.remove(_REQ)
        label, _, names = line.partition("|")
        _answer(label, [n.strip() for n in names.split(",") if n.strip()])
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
# Pinned outside this script's scope: the script engine may drop its globals once the runscript returns, and a
# collected Timer stops ticking without a word.
System.AppDomain.CurrentDomain.SetData("volt.probe.dut-subtype-push", _timer)
_plog("probe timer armed; request file: " + _REQ)
