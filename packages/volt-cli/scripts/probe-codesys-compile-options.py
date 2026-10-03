# -*- coding: utf-8 -*-
# WHAT CODESYS'S DESCRIPTOR WRITES FOR THE COMPILE OPTIONS NO CORPUS HOLDS - openspec `twincat-project-settings` 3.4.
#
# Three rows of `Project Settings.projectsettings` carry an UNMEASURED point against TwinCAT (DIALECT D38): (a) what
# the same `Max compiler warnings` number MEANS (TwinCAT's page offers `<no limit>` = 0), (b) how `Project defines` is
# spelled for two defines (TwinCAT stores the typed `A,B`), (c) `Replace constants: off` (every CODESYS corpus reads
# `on`). This sets those options in a LIVE CODESYS, on a fixture copy, through the SAME objects the descriptor reads
# (`APEnvironment.LMServiceProvider -> ConfigurationService -> CompileOptions`, `CodesysObjectModel.Descriptors.cs`),
# so the descriptor the bridge then serves, and the build it then runs, are the vendor's answers.
#
# The runscript for a normal GUI CODESYS (`ide.ps1 up -Vendor codesys -Instance <name> -RunScript <this>`): it runs
# `run_pipe_production.py` verbatim (fixture open + the shipped host, so the pipe is served as `ide.ps1 up` serves it)
# and arms a UI timer that answers SET requests on the IDE's UI thread - the thread the bridge's pipe calls run on.
#
#   request : %LOCALAPPDATA%\volt-bridge\compile-options.req   one line: "<label>|<Member>=<value>;<Member>=<value>"
#             (value `true`/`false` -> bool, digits -> int, anything else -> the string as typed)
#   answer  : $VOLT_PROBE_LOG (default: codesys-compile-options.log beside this script); the .req is deleted
#
# Each answer logs every CompileOptions member's TYPE and value before and after - a member that is not a string (a
# collection rendered by Convert.ToString as its type name) would be a descriptor bug, which is why the type is logged.
#
# ASCII ONLY - CODESYS compiles this as IronPython 2.7.
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "codesys-compile-options.log")
_REQ = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "compile-options.req")
_MEMBERS = ["ReplaceConstants", "UnicodeIdentifiers", "UTF8Encoding", "MaxCompilerWarnings", "EnableBreakpointLogging",
            "ProjectDefines"]


def _plog(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))


def _options():
    """The production read's object, reached the production way (probe-projectsettings-scope.py `read_config`)."""
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Engine.APEnvironment")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("LMServiceProvider")
        provider = p.GetValue(None, None) if p is not None else None
        if provider is not None:
            return vp.prop(vp.prop(provider, "ConfigurationService"), "CompileOptions")
    return None


def _dump(o, when):
    for m in _MEMBERS:
        pi = o.GetType().GetProperty(m)
        if pi is None:
            _plog("   %s %-24s (no such property)" % (when, m))
            continue
        v = pi.GetValue(o, None)
        _plog("   %s %-24s %-16s %r  (settable %s)" % (when, m, pi.PropertyType.Name, v, pi.CanWrite))


def _value(pi, raw):
    import System
    if pi.PropertyType == System.Boolean:
        return raw.strip().lower() == "true"
    if pi.PropertyType == System.Int32:
        return System.Int32(int(raw))
    return raw


def _answer(label, assignments):
    o = _options()
    _plog("")
    _plog("== " + label)
    if o is None:
        _plog("   CompileOptions unavailable")
        return
    _plog("   CompileOptions type: " + o.GetType().FullName)
    _dump(o, "before")
    for a in assignments:
        name, _, raw = a.partition("=")
        pi = o.GetType().GetProperty(name.strip())
        if pi is None or not pi.CanWrite:
            _plog("   cannot set %s" % name)
            continue
        pi.SetValue(o, _value(pi, raw), None)
        _plog("   set %s = %r" % (name.strip(), raw))
    _dump(o, "after ")


def _tick(sender, args):
    if not os.path.exists(_REQ):
        return
    try:
        with open(_REQ) as f:
            line = f.read().strip()
        os.remove(_REQ)
        label, _, rest = line.partition("|")
        _answer(label, [a for a in rest.split(";") if a.strip()])
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
System.AppDomain.CurrentDomain.SetData("volt.probe.compile-options", _timer)
_plog("probe timer armed; request file: " + _REQ)
