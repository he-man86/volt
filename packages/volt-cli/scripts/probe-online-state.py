# Can the bridge RUN a POU in simulation and READ its state back? (transpile-st-to-rust, phase 1 - the oracle)
#
# The scripting surface was reflected off SP21's ScriptEngine3.dll: IScriptDeviceObject.set_simulation_mode,
# IScriptOnline.create_online_application, IScriptOnlineApplication.login/start/stop/logout/read_values. There is
# NO single-cycle step, so "N scan cycles" cannot be asked for - this measures the substitute: PLC_PRG gates its
# own body on a cycle counter and raises a done flag, and the caller polls that flag.
#
# Two routes to the online object, because only one is reachable from the C# bridge:
#   A  the `online` global CODESYS injects into a script;
#   B  what C# can build itself: APEnvironment.ScriptEngine.CreateScriptExecutor() -> new ScriptOnline(executor).
#
# It also answers design section 4's unverified corner while the IDE is up: `r := 7 / 2` with r : REAL.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-online-state.py"'
#
# ASCII ONLY.
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("online-state.log")

CYCLES = 5
DECL = """PROGRAM PLC_PRG
VAR
  oracleCycles : INT;
  oracleDone   : BOOL;
  count        : INT;
  realDiv      : REAL := 7 / 2;
  intDiv       : INT;
  negMod       : INT;
  wrap         : SINT := 127;
  lr           : LREAL;
END_VAR
"""
BODY = """IF oracleCycles < %d THEN
  oracleCycles := oracleCycles + 1;
  count := count + 2;
  intDiv := -7 / 2;
  negMod := -7 MOD 2;
  wrap := wrap + 1;
  lr := 1.0 / 3.0;
END_IF
oracleDone := oracleCycles >= %d;
""" % (CYCLES, CYCLES)
READ = ["PLC_PRG.oracleCycles", "PLC_PRG.count", "PLC_PRG.realDiv", "PLC_PRG.intDiv",
        "PLC_PRG.negMod", "PLC_PRG.wrap", "PLC_PRG.lr", "PLC_PRG.oracleDone"]


def run_route(tag, oa):
    t0 = time.time()
    oa.login(OnlineChangeOption.Force, True)
    log("[%s] login ok (%.1fs) logged_in=%r state=%r" % (tag, time.time() - t0, oa.is_logged_in, oa.application_state))
    oa.start()
    t1 = time.time()
    flag = None
    while time.time() - t1 < 30:
        flag = oa.read_value("PLC_PRG.oracleDone")
        if str(flag).upper().endswith("TRUE"):
            break
        time.sleep(0.05)
    log("[%s] done flag %r after %.2fs" % (tag, flag, time.time() - t1))
    vals = oa.read_values(READ)
    for k, v in zip(READ, vals):
        log("[%s]   %-22s = %r  (%s)" % (tag, k, v, type(v).__name__))
    time.sleep(0.5)
    log("[%s] cycles after 0.5s more: %r (gate holds?)" % (tag, oa.read_value("PLC_PRG.oracleCycles")))
    oa.stop()
    oa.logout()
    log("[%s] logged out" % tag)


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    proj = vp.open_copy(projects, src, "online-state")
    log("opened copy of %s" % src)

    app = proj.active_application
    log("application: %s" % app.get_name())
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace(DECL)
    prg.textual_implementation.replace(BODY)
    log("PLC_PRG rewritten")

    app.build()
    log("build issued")

    dev = app
    while dev is not None:
        try:
            dev.set_simulation_mode(True)
            break
        except Exception:
            dev = dev.parent
    log("simulation on for device: %s (simulation_mode=%r)" % (dev.get_name() if dev else None,
                                                                  dev.get_simulation_mode() if dev else None))

    # How is the injected `online` built? Its fields are what route B has to reproduce from C#.
    import System
    log("[A] online global: %s" % online.GetType().FullName)
    for fld in online.GetType().GetFields(vp.bf()):
        try:
            v = fld.GetValue(online)
            log("[A]   field %-24s %s = %s" % (fld.Name, fld.FieldType.FullName, v.GetType().FullName if v is not None else None))
        except Exception as e:
            log("[A]   field %s <raised %s>" % (fld.Name, e))
    SKIP_A = os.environ.get("VOLT_PROBE_SKIP_A") == "1"
    if not SKIP_A:
        try:
            run_route("A online-global", online.create_online_application(app))
        except Exception:
            log("[A] FAILED"); log(__import__("traceback").format_exc())

    try:
        import System
        env = None
        for asm in System.AppDomain.CurrentDomain.GetAssemblies():
            t = asm.GetType("_3S.CoDeSys.ScriptDriverProjects.APEnvironment")
            if t is not None:
                env = t
        engine = env.GetProperty("ScriptEngine", vp.bf() | System.Reflection.BindingFlags.Static).GetValue(None, None)
        executor = engine.CreateScriptExecutor()
        log("[B] executor: %s" % executor.GetType().FullName)
        so_t = None
        for asm in System.AppDomain.CurrentDomain.GetAssemblies():
            t = asm.GetType("_3S.CoDeSys.ScriptDriverOnline.ScriptOnline")
            if t is not None:
                so_t = t
        log("[B] ScriptOnline type: %s (assembly %s)" % (so_t, so_t.Assembly.GetName().Name if so_t else None))
        so = System.Activator.CreateInstance(so_t, vp.bf(), None, System.Array[System.Object]([executor]), None)
        # Invoke directly, NOT through vp.call: that helper keeps only the last traceback line, which for a
        # reflective call is always "Exception has been thrown by the target of an invocation" - the wrapper,
        # never the cause.
        m = [x for x in so_t.GetMethods(vp.bf()) if x.Name == "create_online_application"][0]
        log("[B] method: %s(%s)" % (m.Name, ", ".join([p.ParameterType.FullName for p in m.GetParameters()])))
        try:
            oa = m.Invoke(so, System.Array[System.Object]([app]))
        except System.Reflection.TargetInvocationException as tie:
            log("[B] INNER: %s" % tie.InnerException.ToString())
            raise
        log("[B] create_online_application -> %s" % oa.GetType().FullName)
        run_route("B csharp-route", oa)
    except Exception:
        log("[B] FAILED"); log(__import__("traceback").format_exc())

    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
