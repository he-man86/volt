# -*- coding: utf-8 -*-
"""
Open a fixture project, then start Volt THE WAY A USER DOES. THE ONLY host script for the dev/test loop.

There used to be a second one, `run_pipe_headless.py`, which opened the project with `--noUI` and PUMPED the
message loop itself because headless CODESYS has none running. It was faster to launch and it was the default,
which meant the e2e tier spent its whole life exercising a path no engineer takes: a different DLL load (build
output rather than a per-session copy) and a pump that ships with nothing. It is deleted. One host, and it is
the one users run.

This runs the SHIPPED script — `start_volt_codesys.py`, verbatim — inside a normal GUI CODESYS. What that buys
over the harness pump is not cosmetic:

  - it loads the bridge from a PER-SESSION TEMP COPY (so an install can update while the IDE is open), where the
    headless script loads the build output directly;
  - `PipeHost.Start` returns immediately and the IDE'S OWN message loop serves the pipe, where the headless
    script owns the loop.

The only thing scripted here that a user does by hand is OPENING the project — everything after that is the
production script, unmodified. Beside it run two harness-only helpers a user never has: assertion dialogs turned into
log lines, and a read-only native-export probe the e2e tests read CODESYS bodies through (see `_native_probe`). Stop it the way a user does too: run `stop_volt_codesys.py` from the IDE.

Driven by `ide.ps1 up -Vendor codesys -Production` (which implies -Ui).
"""
from __future__ import print_function
import os

_FIXTURE = os.environ.get("VOLT_FIXTURE_PROJECT")
_HERE = os.path.dirname(os.path.abspath(__file__))
_LOGFILE = os.environ.get("VOLT_LAUNCHER_LOG") or os.path.join(
    os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "bridge-launcher.log")


def _log(msg):
    """Print AND append to a file.

    A GUI CODESYS cannot have its stdout redirected - the process wants its own console handles and redirecting
    them can wedge startup - so a launcher that only prints tells the caller nothing. This file is the only way
    to answer "did it open, and which project?" from outside, and answering that was the difference between a
    two-minute wait and a wrong diagnosis more than once.
    """
    print("[volt-pipe-production] %s" % msg)
    try:
        d = os.path.dirname(_LOGFILE)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with open(_LOGFILE, "a") as f:
            f.write("[volt-pipe-production] %s\n" % msg)
    except Exception:
        pass


def _silence_assert_dialogs():
    """Turn .NET assertion dialogs into log lines.

    HARNESS-ONLY, and that is why it lives here rather than in the shipped script: an engineer at their desk WANTS
    to see an assertion, while an unattended corpus sweep or e2e run must never stop on a modal window. And a
    modal dialog does not merely pause the run - it blocks COM, so the pipe stops answering and the failure looks
    like a hung IDE rather than an assertion.

    It moved here from `run_pipe_headless.py` when that script was deleted; it was the one thing the headless
    harness did that the production path did not.
    """
    try:
        import clr
        clr.AddReference("System")
        from System.Diagnostics import Trace
        for listener in list(Trace.Listeners):
            try:
                listener.AssertUiEnabled = False
            except Exception:
                pass
        _log("assertion dialogs disabled")
    except Exception as e:
        _log("could not disable assertion dialogs: %s" % str(e))


_silence_assert_dialogs()


def _open_fixture():
    """Open the fixture, or keep whatever is already open. A user opens their project before starting Volt; this
    is that step and nothing more."""
    if not _FIXTURE:
        _log("no VOLT_FIXTURE_PROJECT - using whatever project is open")
        return
    try:
        if projects.primary is not None:
            _log("a project is already open - leaving it")
            return
    except Exception:
        pass
    _log("opening fixture: %s" % _FIXTURE)
    projects.open(_FIXTURE)
    _log("fixture opened")


_open_fixture()


# ── the native-export probe: how an e2e test reads a CODESYS body byte for byte ─────────────────────────────────
#
# HARNESS-ONLY, like `_silence_assert_dialogs`: it is here, not in the shipped script, and it reads - it never writes.
#
# WHY IT EXISTS. The spec (openspec `implementation-keyword`, "nothing in the IDE is overwritten") says a push that
# touches an item whose body Volt does not show leaves that body BYTE-IDENTICAL. Nothing on the wire carries such a
# body - that is the point of hiding it - and CODESYS, unlike TwinCAT, saves no file on push and keeps its project in
# a binary archive, so for a long time no live test could read a CODESYS body at all (task 4.1 stood BLOCKED on it).
# What CODESYS DOES have is its own serialization of an object: `export_native` writes the object's IArchivable
# fields as XML, and its `<Single Name="Implementation">` element is the body exactly as the IDE holds it - chart
# elements, NWL element ids and all. Measured on SP21 Patch 4: two exports of an unchanged object are byte-identical,
# and a declaration edit changes only the `Interface` text, the object's `UniqueIdGenerator` and the meta `Timestamp`
# - never a byte of `Implementation`.
#
# THE PROTOCOL is files, so the product's wire gains no test-only op: a test writes `request` into
# %LOCALAPPDATA%\volt-bridge\codesys-native\<pid>\ (pid = this CODESYS, the one the pipe is named after) holding a
# request id on the first line and one object name per line after it; this probe exports each named object to
# `<id>.<name>.export` and then writes `<id>.done` - or `<id>.error` with the reason, so a test fails naming it rather
# than timing out. A WinForms timer runs it ON THE UI THREAD, the thread the pipe host's calls run on too, so an
# export never interleaves with a push.
def _native_probe():
    try:
        import clr
        clr.AddReference("System.Windows.Forms")
        from System.Windows.Forms import Timer
        from System.Diagnostics import Process
        base = os.environ.get("LOCALAPPDATA", _HERE)
        folder = os.path.join(base, "volt-bridge", "codesys-native", str(Process.GetCurrentProcess().Id))
        if not os.path.isdir(folder):
            os.makedirs(folder)
        request = os.path.join(folder, "request")
        if os.path.exists(request):
            os.remove(request)                   # a request left by a previous IDE with this pid answers nothing

        def tick(sender, args):
            if not os.path.exists(request):
                return
            rid = None
            try:
                with open(request) as f:
                    lines = [l.strip() for l in f.read().splitlines() if l.strip()]
                os.remove(request)
                rid, names = lines[0], lines[1:]
                proj = projects.primary
                if proj is None:
                    raise Exception("no project is open")
                for name in names:
                    found = [o for o in proj.find(name, True) if o.get_name() == name]
                    if len(found) != 1:
                        raise Exception("expected ONE object named '%s', found %d" % (name, len(found)))
                    proj.export_native(found, os.path.join(folder, "%s.%s.export" % (rid, name)), recursive=True)
                open(os.path.join(folder, rid + ".done"), "w").close()
            except Exception as e:
                if rid is not None:
                    with open(os.path.join(folder, rid + ".error"), "w") as f:
                        f.write(str(e))
                _log("native probe: %s" % str(e))

        timer = Timer()
        timer.Interval = 200
        timer.Tick += tick
        timer.Start()                            # an enabled WinForms timer is rooted by the framework; it outlives this script
        _log("native probe watching %s" % folder)
    except Exception as e:
        _log("native probe NOT started: %s" % str(e))


_native_probe()

# The SHIPPED script, run as-is. Not imported and not copied: any drift between what is tested and what users run
# is the whole thing this file exists to prevent.
#
# NOT `execfile`. SP21's scripting engine is PYTHON 3, where that builtin no longer exists - and the failure is
# not a clean one: the DeprecationWarning it raises lands in CODESYS's message store, which `build` reads, so
# every e2e test that compiles reported two phantom build ERRORS. `compile`+`exec` is what both 2.x and 3.x have.
# (Several comments in the shipped scripts still say "IronPython 2.7"; that is true of SP18, not of SP21.)
_start = os.path.join(_HERE, "start_volt_codesys.py")
_log("running the production script: %s" % _start)
with open(_start) as _f:
    _src = _f.read()
exec(compile(_src, _start, "exec"))
_log("production script returned - the IDE's own loop now serves the pipe")
