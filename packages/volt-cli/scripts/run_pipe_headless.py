# -*- coding: utf-8 -*-
"""
Run Volt CLI pipe host HEADLESS  (CODESYS.exe --runscript ... --noUI)

Pipe twin of volt-bridge/codesys-scriptcommands/run_bridge_headless.py: instead
of the HTTP Host it loads Volt.Ide.Codesys and calls PipeHost.Start, serving
the REAL CodesysDriver over the named pipe `volt.bridge.codesys`. Everything else
(assert-dialog suppression, fixture open, primary-thread pump) is identical —
the marshaled endpoints still run on the CODESYS primary thread, so we must pump.

Env (set by the launcher):
  VOLT_BRIDGE_DLL      absolute path to Volt.Ide.Codesys.dll (required)
  VOLT_FIXTURE_PROJECT .project to open before starting (optional)
  VOLT_STOP_FLAG       path to a file whose existence requests shutdown (optional)
"""
from __future__ import print_function
import os
import time

_LOGFILE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt-bridge", "headless-launcher.log")


def _log(msg):
    try:
        d = os.path.dirname(_LOGFILE)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with open(_LOGFILE, "a") as f:
            f.write("[volt-pipe-headless] %s\n" % msg)
    except Exception:
        pass


def _silence_assert_dialogs():
    try:
        import clr
        clr.AddReference("System")
        from System.Diagnostics import Trace
        for l in list(Trace.Listeners):
            try:
                l.AssertUiEnabled = False
            except Exception:
                pass
        _log("assertion dialogs disabled")
    except Exception as e:
        _log("could not disable assertion dialogs: %s" % str(e))


_silence_assert_dialogs()


def _primary():
    try:
        return getattr(projects, "primary", None)
    except Exception:
        return None


def _open_fixture():
    path = os.environ.get("VOLT_FIXTURE_PROJECT")
    if not path:
        _log("no VOLT_FIXTURE_PROJECT; using current primary project (if any)")
        return
    if _primary() is not None:
        _log("a project is already primary; not opening fixture")
        return
    if not os.path.exists(path):
        _log("fixture project not found: %s" % path)
        return
    import traceback
    for attempt in range(1, 6):
        try:
            _log("opening fixture (attempt %d): %s" % (attempt, path))
            projects.open(path)
            _log("fixture opened; primary=%r" % (_primary() is not None))
            return
        except Exception as e:
            msg = str(e)
            if "already open" in msg or _primary() is not None:
                _log("primary now open (open reported: %s)" % msg)
                return
            _log("open attempt %d failed: %s" % (attempt, msg))
            if attempt == 1:
                _log("traceback:\n%s" % traceback.format_exc())
            time.sleep(1.0)
    _log("fixture open gave up (continuing)")


def _make_pump():
    import clr
    try:
        clr.AddReference("WindowsBase")
        from System.Windows.Threading import Dispatcher, DispatcherFrame, DispatcherPriority
        from System import Action
        disp = Dispatcher.CurrentDispatcher

        def pump():
            frame = DispatcherFrame()
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
        _log("no message pump (%s); marshaled endpoints may hang" % str(e))
        return lambda: None


def _find_dll():
    dll = os.environ.get("VOLT_BRIDGE_DLL")
    if dll and os.path.exists(dll):
        return dll
    _log("VOLT_BRIDGE_DLL missing or not found: %r" % dll)
    return None


try:
    import clr
    dll = _find_dll()
    if not dll:
        _log("aborting: no DLL")
    else:
        _open_fixture()
        _log("loading %s" % dll)
        clr.AddReferenceToFileAndPath(dll)
        from Volt.Ide.Codesys import PipeHost
        _log(PipeHost.Start(projects, system, online))

        pump = _make_pump()
        flag = os.environ.get("VOLT_STOP_FLAG")
        _log("serving on pipe; pumping primary thread")
        while PipeHost.IsRunning:
            if flag and os.path.exists(flag):
                _log("stop flag seen; stopping")
                PipeHost.Stop()
                break
            pump()
            time.sleep(0.02)
        _log("pipe host stopped; script exiting")
except Exception as e:
    _log("fatal: %s" % str(e))
