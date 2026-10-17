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
production script, unmodified. Beside it run three harness-only helpers a user never has: assertion dialogs turned into
log lines, a read-only native-export probe the e2e tests read CODESYS bodies through (see `_native_probe`), and a run
probe that builds and runs the application in simulation and reads variables (see `_run_probe`). Stop it the way a user does too: run `stop_volt_codesys.py` from the IDE.

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

        quit_req = os.path.join(folder, "quit")
        if os.path.exists(quit_req):
            os.remove(quit_req)

        # `ide.ps1 down` (and `up`, reaping what an instance left) asks for a CLEAN close through this same folder:
        # close the project WITHOUT saving - it is a throwaway fixture copy - and answer `quit.done`; ide.ps1 then
        # closes the main window, which with no project open is CODESYS's normal exit and asks nothing. A forced kill
        # is what it does only when this goes unanswered.
        def quit_tick():
            os.remove(quit_req)
            try:
                if projects.primary is not None:
                    projects.primary.close()
                open(os.path.join(folder, "quit.done"), "w").close()
                _log("quit requested - project closed without saving")
            except Exception as e:
                with open(os.path.join(folder, "quit.error"), "w") as f:
                    f.write(str(e))
                _log("quit: %s" % str(e))

        def tick(sender, args):
            if os.path.exists(quit_req):
                quit_tick()
                return
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


# ── the run probe: how an e2e test asks whether pushed code RUNS ─────────────────────────────────────────────────
#
# HARNESS-ONLY, like the native-export probe, and read-only on the project: it builds, logs in to the SIMULATION and
# reads variables; it writes no object, and puts the device's simulation mode back as it found it. WHY: a body that
# stores, round-trips and builds can still not run - in a lab, an Execute box built through the model in one commit
# stored its ST and did not run until a second commit (openspec ld-fbd-coverage 2R.6a, v2-measurements.md #9) - and
# only the runtime says so. The scripting `online` object is not a
# bridge op on purpose: the product's wire has no reason to run a PLC.
#
# THE PROTOCOL is the native probe's: a test writes `request` into %LOCALAPPDATA%\volt-bridge\codesys-run\<pid>\ holding
# a request id on the first line and one variable path per line after it (`GVL.i`, as the online read names it);
# this probe builds the active application (an error answers `<id>.error`, naming it), puts its device in simulation
# (restored after the run), logs in without an online change (a fresh download), starts it, lets it run SETTLE_S
# seconds, reads every path (one it cannot read answers `UNREADABLE: <why>`), stops and logs out - then writes
# `<id>.json` ({path: value}), or `<id>.error` with the reason.
_ENTRY = []


def _run_probe():
    SETTLE_S = 2.0
    try:
        import clr
        import json
        import time
        clr.AddReference("System.Windows.Forms")
        from System.Windows.Forms import Timer
        from System.Diagnostics import Process
        base = os.environ.get("LOCALAPPDATA", _HERE)
        folder = os.path.join(base, "volt-bridge", "codesys-run", str(Process.GetCurrentProcess().Id))
        if not os.path.isdir(folder):
            os.makedirs(folder)
        request = os.path.join(folder, "request")
        if os.path.exists(request):
            os.remove(request)

        def errors():
            out = []
            for cat in system.get_message_categories(True):
                for sev in (Severity.FatalError, Severity.Error):
                    for m in system.get_message_objects(cat, sev):
                        out.append(str(getattr(m, "text", m)))
            return out

        def run(paths):
            proj = projects.primary
            if proj is None:
                raise Exception("no project is open")
            app = proj.active_application
            app.build()
            found = errors()
            if found:
                raise Exception("does not compile: " + " | ".join(found))
            dev = app
            while dev is not None and not hasattr(dev, "set_simulation_mode"):
                dev = dev.parent
            if dev is None:
                raise Exception("the application has no device to put in simulation")
            # the device as the test found it: simulation is set for this run and put back after it
            was = dev.get_simulation_mode()
            dev.set_simulation_mode(True)
            try:
                stack, entry = _ENTRY[0]
                stack.Push(entry)
                try:
                    oa = online.create_online_application(app)
                finally:
                    stack.Pop()
                oa.login(OnlineChangeOption.Never, True)
                try:
                    oa.start()
                    time.sleep(SETTLE_S)
                    values = {}
                    for p in paths:
                        try:
                            values[p] = str(oa.read_value(p))
                        except Exception as e:
                            values[p] = "UNREADABLE: %s" % str(e)
                    return values
                finally:
                    try:
                        oa.stop()
                    finally:
                        oa.logout()
            finally:
                dev.set_simulation_mode(was)

        def tick(sender, args):
            if not os.path.exists(request):
                return
            rid = None
            try:
                with open(request) as f:
                    lines = [l.strip() for l in f.read().splitlines() if l.strip()]
                os.remove(request)
                rid, paths = lines[0], lines[1:]
                answer(rid + ".json", json.dumps(run(paths)))
            except Exception as e:
                import traceback
                if rid is not None:
                    answer(rid + ".error", str(e) + "\n" + traceback.format_exc())
                _log("run probe: %s" % str(e))

        # whole, or not at all: the test reads an answer the moment it exists
        def answer(name, text):
            tmp = os.path.join(folder, name + ".tmp")
            with open(tmp, "w") as f:
                f.write(text)
            os.rename(tmp, os.path.join(folder, name))

        # `online` answers only INSIDE a running script: `create_online_application` peeks at the script's entry on
        # `ScriptOnline._executionStack` (a Stack<ScriptExecutionEventArgs>, measured SP21) and throws "Stack empty."
        # once this script has returned - which it must, for the IDE's own loop to serve the pipe. This script's entry
        # is taken here, while it runs, and stood back on the stack for each request's creation. One online
        # application per request, not one kept: a kept one reads "Invalid variable reference" for every variable
        # once the application it downloaded has changed (measured: a GVL the test never edited, after a POU's edit).
        from System.Reflection import BindingFlags
        field = online.GetType().GetField("_executionStack", BindingFlags.Instance | BindingFlags.NonPublic)
        if field is None:
            raise Exception("ScriptOnline has no _executionStack field on this CODESYS version")
        stack = field.GetValue(online)
        if stack is None or stack.Count != 1:
            raise Exception("ScriptOnline._executionStack holds %s entries, not this script's one" % (None if stack is None else stack.Count))
        _ENTRY.append((stack, stack.Peek()))
        timer = Timer()
        timer.Interval = 200
        timer.Tick += tick
        timer.Start()
        _log("run probe watching %s" % folder)
    except Exception as e:
        _log("run probe NOT started: %s" % str(e))


_run_probe()

# The SHIPPED script, run as-is. Not imported and not copied: any drift between what is tested and what users run
# is the whole thing this file exists to prevent.
#
# NOT `execfile`. SP21's scripting engine is PYTHON 3, where that builtin no longer exists - and the failure is
# not a clean one: the DeprecationWarning it raises lands in CODESYS's message store, which `build` reads, so
# every e2e test that compiles reported two phantom build ERRORS. `compile`+`exec` is what both 2.x and 3.x have.
# (Several comments in the shipped scripts still say "IronPython 2.7"; that is true of SP18, not of SP21.)
#
# VOLT_START_SCRIPT (set by `ide.ps1 up -BridgeDir <dir>`) names the start script of a folder laid out as INSTALLED
# ({app}\codesys: the DLL beside the script); without it, the one beside this file. It runs with its OWN `__file__`
# (a copy of these globals, which carry CODESYS's `projects`/`system`/`online`), because the script resolves the
# bridge DLL beside itself - under this file's `__file__` it would look in the wrong folder.
_start = os.environ.get("VOLT_START_SCRIPT") or os.path.join(_HERE, "start_volt_codesys.py")
_log("running the production script: %s" % _start)
with open(_start) as _f:
    _src = _f.read()
_globals = dict(globals())
_globals["__file__"] = _start
exec(compile(_src, _start, "exec"), _globals)
_log("production script returned - the IDE's own loop now serves the pipe")
