# THE LEAK, and the fix, in one session.
#
# Opens two projects one after another in a SINGLE CODESYS and, for each, reports both readings:
#   OLD  APEnvironment.LMServiceProvider -> ConfigurationService -> WarningConfiguration  (session-global)
#   NEW  SystemInstances.OptionStorage.GetRootKey(Project) -> {8F99A816-...}              (project-scoped)
#
# pro2193 disables C0371; lenze-mid disables nothing. If the global service carries the first project's
# answer into the second, the OLD column says so.
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "leak-check.log")
SRC = os.environ.get("VOLT_PROBE_PROJECT") or ""

f = open(LOG, "w")
def log(s):
    f.write(str(s) + "\n"); f.flush()



DLL = os.environ.get("VOLT_BRIDGE_DLL")
PROJECTS = [p for p in (os.environ.get("VOLT_PROBE_PROJECTS") or "").split(";") if p.strip()]

def static_member(type_name, member):
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try: t = asm.GetType(type_name)
        except Exception: t = None
        if t is None: continue
        p = t.GetProperty(member)
        if p is not None:
            try: return p.GetValue(None, None)
            except Exception: return None
    return None

def old_reading():
    provider = static_member("_3S.CoDeSys.Engine.APEnvironment", "LMServiceProvider")
    if provider is None: return "<no provider>"
    cfg = provider.GetType().GetProperty("ConfigurationService").GetValue(provider, None)
    if cfg is None: return "<no config>"
    wc = cfg.GetType().GetProperty("WarningConfiguration").GetValue(cfg, None)
    if wc is None: return "<no warning config>"
    v = wc.GetType().GetMethod("GetDisabledWarningIds").Invoke(wc, None)
    return "none" if v is None else repr(list(v))

try:
    import clr, System
    from System.Reflection import BindingFlags as B
    bf = B.Public | B.NonPublic | B.Instance

    asm = System.Reflection.Assembly.LoadFrom(os.path.abspath(DLL))
    t = asm.GetType("Volt.Ide.Codesys.CodesysObjectModel")
    ctor = [c for c in t.GetConstructors(bf)][0]
    inst = ctor.Invoke(System.Array[System.Object]([None] * len(ctor.GetParameters())))
    m = t.GetMethod("ProjectSettingsDescriptor", bf)
    log("bridge: " + os.path.abspath(DLL))

    for path in PROJECTS:
        path = path.strip()
        log("")
        log("=" * 72)
        log("OPEN " + os.path.basename(path))
        log("=" * 72)
        proj = projects.open(path)

        node = [None]
        def visit(n, depth):
            if depth > 3 or node[0] is not None: return
            try: kids = list(n.get_children())
            except Exception: return
            for k in kids:
                try: nm = str(k.get_name())
                except Exception: nm = "?"
                if nm == "Project Settings":
                    node[0] = k; return
                visit(k, depth + 1)
        visit(proj, 0)

        log("  OLD (session-global service) GetDisabledWarningIds -> %s" % old_reading())
        try:
            body = m.Invoke(inst, System.Array[System.Object]([node[0]]))
            first = [l for l in body.split("\n") if l.strip()]
            log("  NEW (project option storage):")
            for l in first:
                log("      " + l)
            if not first:
                log("      <nothing set - all defaults>")
        except System.Exception, ex:
            log("  NEW THREW: " + ex.ToString().split("\n")[0])
        proj.close()

    log("")
    log("done")
except System.Exception, ex:
    log(ex.ToString())
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System; System.Environment.Exit(0)
    except Exception: pass
