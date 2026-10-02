# -*- coding: utf-8 -*-
# DOES A PUSH KEEP A SPECIAL CLASS? - read between pushes, in the SAME live IDE the pushes go through.
#
# openspec `push-without-header-check` 5.Q.6 (design 5.Qb, Migration 1; DIALECT C2n). The wire carries less than the
# IDE stores for a handful of classes (a check function is a `POUObjectCheckFunction`, a persistent list a
# `VarPersistentObject`, an NVL an `INVLObject`, a text-list enum a `TextListEnumerationObject`, an abstract method an
# `AbstractPOUMethodObject`). The design assumes an update, a rename and a move written through the bridge keep the
# object - and with it the class. This reads the class back after every step, off the IDE the bridge is serving.
#
# The runscript for a normal GUI CODESYS: it runs `run_pipe_production.py` verbatim (fixture open + the shipped
# `start_volt_codesys.py`), then arms a UI timer that answers READ requests. The pushes come from outside
# (`probe-merged-classes.ts`, over the pipe); between them the caller drops a request file and this logs, for every
# object it names: guid, parent, the CLR class, its *Object interfaces, and the per-object properties that make the
# class special (KindOfCheckFunction, NetVarProperties, ParameterList).
# It only READS, on the IDE's UI thread (the thread the bridge's own pipe calls run on), so a read never races a push.
#
#   request : %LOCALAPPDATA%\volt-bridge\merged-probe.req   one line: "<label>|<name>,<name>,..."   (prefix* allowed)
#   answer  : $VOLT_PROBE_LOG (default: merged-classes.log beside this script), then the .req is deleted
#
#   pwsh scripts/ide.ps1 up -Vendor codesys -Instance push-without-header-check -Fixture <a .project> `
#        -RunScript scripts/probe-merged-classes.py -Wait
#
# ASCII ONLY.
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "merged-classes.log")
_REQ = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "merged-probe.req")


# NOT `_log`: the host script below is exec'd into THIS namespace and defines its own `_log`.
def _plog(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


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
    if not ok:
        return "%-26s guid %s  in '%s'  READ FAILED: %s" % (o.get_name(), guid, parent, meta)
    iobj = vp.prop(meta, "Object")
    if iobj is None:
        return "%-26s guid %s  in '%s'  no IObject" % (o.get_name(), guid, parent)
    clr_name = iobj.GetType().FullName
    ifaces = sorted(i.Name for i in iobj.GetType().GetInterfaces() if i.Name.endswith("Object"))
    extra = []
    for p in ("KindOfCheckFunction", "NetVarProperties", "ParameterList"):
        try:
            pi = iobj.GetType().GetProperty(p, vp.bf())
        except Exception:
            pi = None
        if pi is None:
            continue
        try:
            extra.append("%s=%s" % (p, pi.GetValue(iobj, None)))
        except Exception as e:
            extra.append("%s=<%s>" % (p, type(e).__name__))
    return "%-26s guid %s  in '%s'  clr=%s  [%s]  %s" % (
        o.get_name(), guid, parent, clr_name, "+".join(ifaces), " ".join(extra))


def _answer(label, wanted):
    mgr = vp.object_manager()
    proj = projects.primary
    _plog("")
    _plog("== " + label)
    hits = [o for o in vp.walk(proj) if _matches(o.get_name(), wanted)]
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
        with open(_REQ + ".done", "w") as f:
            f.write(label)
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
System.AppDomain.CurrentDomain.SetData("volt.probe.merged-classes", _timer)
_plog("probe timer armed; request file: " + _REQ)
