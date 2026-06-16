# -*- coding: utf-8 -*-
"""
Run Volt Bridge HEADLESS  (CODESYS.exe --runscript ... --noUI)

Unlike start_bridge.py (one-shot launcher for the *live* IDE — returns
immediately, the IDE's own message loop keeps the bridge alive), this script is
the entry point when CODESYS is started head-less from the codesys-bridge.ps1
wrapper. There is no IDE message loop to return to, so this script must:

  1. open a fixture project (so the read path has something to serve),
  2. start the in-proc bridge,
  3. KEEP the process alive AND pump the primary thread until shutdown.

Why pump, not sleep: every project-touching endpoint (/refs,/fetch,/push,
/build) marshals onto the CODESYS primary thread via
IEngine.InvokeInPrimaryThread. That delegate only runs when the primary thread
services its message queue. This script runs ON the primary thread, so if we
parked it in a blocking Wait() the marshaled calls would deadlock and only the
cache-only endpoints (/health,/shutdown) would answer. WPF's Dispatcher.PushFrame
drains the thread's Win32 message queue (servicing both WPF Dispatcher and
WinForms Control.Invoke posts), so we pump one frame per loop iteration.

Driven by env vars set by the wrapper:
  VOLT_BRIDGE_DLL      absolute path to VoltBridge.Codesys.dll  (required)
  VOLT_FIXTURE_PROJECT .project to open before starting (optional; else uses
                       whatever project is already primary)
  VOLT_STOP_FLAG       path to a file whose existence requests shutdown
                       (optional backup to POST /shutdown)
"""
from __future__ import print_function
import os
import time


_LOGFILE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt-bridge", "headless-launcher.log")


def _log(msg):
    # Write to a file, NOT stdout: CODESYS captures script stdout into its
    # message store, which would pollute /build diagnostics with our log lines.
    try:
        d = os.path.dirname(_LOGFILE)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with open(_LOGFILE, "a") as f:
            f.write("[volt-headless] %s\n" % msg)
    except Exception:
        pass


# ── 0. suppress modal assertion dialogs ──────────────────────────────────────
# projects.open() drives CODESYS's library resolver, which fires Debug.Assert
# calls. The default .NET trace listener shows a modal Abort/Retry/Ignore box
# that, in --noUI, blocks the primary thread forever (looks like a crash). Turn
# the UI off so asserts log-and-continue (the "Ignore" path) — the same thing
# CODESYS CI runs do.
def _silence_assert_dialogs():
    try:
        import clr
        clr.AddReference("System")
        from System.Diagnostics import Trace
        for l in list(Trace.Listeners):
            try:
                l.AssertUiEnabled = False  # DefaultTraceListener only; others lack it
            except Exception:
                pass
        _log("assertion dialogs disabled (asserts will log-and-continue)")
    except Exception as e:
        _log("could not disable assertion dialogs: %s" % str(e))


_silence_assert_dialogs()


# ── 1. open the fixture project so the read path has data ────────────────────
def _primary():
    try:
        return getattr(projects, "primary", None)
    except Exception:
        return None


def _open_fixture():
    path = os.environ.get("VOLT_FIXTURE_PROJECT")
    if not path:
        _log("no VOLT_FIXTURE_PROJECT set; using current primary project (if any)")
        return
    if _primary() is not None:
        _log("a project is already primary (opened by CODESYS); not opening fixture")
        return
    if not os.path.exists(path):
        _log("fixture project not found: %s" % path)
        return
    # In --noUI the scripting/project manager can lag the script start, so the
    # first projects.open() may NRE. Retry a few times, settling between tries.
    import traceback
    for attempt in range(1, 6):
        try:
            _log("opening fixture (attempt %d): %s" % (attempt, path))
            projects.open(path)
            _log("fixture project opened; primary=%r" % (_primary() is not None))
            return
        except Exception as e:
            msg = str(e)
            # open() can throw an assertion-driven error yet still leave the
            # project primary — treat an already-open primary as success.
            if "already open" in msg or _primary() is not None:
                _log("primary project now open (open reported: %s)" % msg)
                return
            _log("open attempt %d failed: %s" % (attempt, msg))
            if attempt == 1:
                _log("traceback:\n%s" % traceback.format_exc())
            time.sleep(1.0)
    _log("fixture open gave up (continuing; /health still serves)")


# ── 2. build a primary-thread pump (WPF frame; WinForms DoEvents fallback) ───
def _make_pump():
    import clr
    try:
        clr.AddReference("WindowsBase")
        from System.Windows.Threading import Dispatcher, DispatcherFrame, DispatcherPriority
        from System import Action
        disp = Dispatcher.CurrentDispatcher

        def pump():
            frame = DispatcherFrame()
            # Background-priority callback fires after all pending input/render
            # work, so PushFrame drains the queue then returns.
            disp.BeginInvoke(DispatcherPriority.Background,
                             Action(lambda: setattr(frame, "Continue", False)))
            Dispatcher.PushFrame(frame)

        _log("pump: WPF Dispatcher.PushFrame")
        return pump
    except Exception as e:
        _log("WPF pump unavailable (%s); trying WinForms DoEvents" % str(e))
    try:
        clr.AddReference("System.Windows.Forms")
        from System.Windows.Forms import Application

        def pump():
            Application.DoEvents()

        _log("pump: WinForms Application.DoEvents")
        return pump
    except Exception as e:
        _log("no message pump available (%s); marshaled endpoints may hang" % str(e))
        return lambda: None


def _find_dll():
    dll = os.environ.get("VOLT_BRIDGE_DLL")
    if dll and os.path.exists(dll):
        return dll
    _log("VOLT_BRIDGE_DLL missing or not found: %r" % dll)
    return None


# ── main ─────────────────────────────────────────────────────────────────────
try:
    import clr
    dll = _find_dll()
    if not dll:
        _log("aborting: no DLL")
    else:
        _open_fixture()
        _log("loading %s" % dll)
        clr.AddReferenceToFileAndPath(dll)
        from Volt.Bridge.Codesys import Host
        _log(Host.Start(projects, system, online))

        pump = _make_pump()
        flag = os.environ.get("VOLT_STOP_FLAG")
        _log("serving; pumping primary thread. POST /shutdown%s to exit."
             % (" or create %s" % flag if flag else ""))
        while Host.IsRunning:
            if flag and os.path.exists(flag):
                _log("stop flag seen; stopping")
                Host.Stop()
                break
            pump()
            time.sleep(0.02)
        _log("bridge stopped; script exiting (CODESYS will close)")
except Exception as e:
    _log("fatal: %s" % str(e))
