# Call ProjectSettingsDescriptor DIRECTLY, in-process, and report what it returns or throws.
#
# The pull only shows the SYMPTOM (a missing .projectsettings item), because a descriptor that throws
# makes the item unreadable and the fetch skips it. This loads the built bridge DLL the same way the
# in-proc host does and invokes the one method, so the exception is visible.
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "verify-descriptor.log")
SRC = os.environ.get("VOLT_PROBE_PROJECT") or ""

f = open(LOG, "w")
def log(s):
    f.write(str(s) + "\n"); f.flush()


DLL = os.environ.get("VOLT_BRIDGE_DLL") or os.path.join(
    HERE, "..", "src", "Volt.Ide.Codesys", "bin", "Release", "net48", "Volt.Ide.Codesys.dll")

try:
    import clr, System
    from System.Reflection import BindingFlags as B

    proj = projects.open(SRC)
    log("opened " + os.path.basename(SRC))

    log("loading " + os.path.abspath(DLL))
    asm = System.Reflection.Assembly.LoadFrom(os.path.abspath(DLL))
    t = asm.GetType("Volt.Ide.Codesys.CodesysObjectModel")
    log("type: %r" % (t,))
    if t is None:
        raise SystemExit

    bf = B.Public | B.NonPublic | B.Instance
    ctor = t.GetConstructors(bf)
    log("ctors: %r" % [[p.ParameterType.Name for p in c.GetParameters()] for c in ctor])
    import System as _S
    inst = None
    for c in ctor:
        ps = c.GetParameters()
        try:
            if len(ps) == 0:
                inst = c.Invoke(None)
            else:
                inst = c.Invoke(_S.Array[_S.Object]([None] * len(ps)))
            break
        except Exception:
            log("  ctor(%d) threw: %s" % (len(ps), traceback.format_exc().splitlines()[-1]))
    log("instance: %r" % (inst,))

    m = t.GetMethod("ProjectSettingsDescriptor", bf)
    log("method: %r" % (m is not None,))

    # find the Project Settings node to pass in (the method ignores it, but the signature wants one)
    node = None
    def visit(n, depth):
        global node
        if depth > 3 or node is not None: return
        try: kids = list(n.get_children())
        except Exception: return
        for k in kids:
            try: nm = str(k.get_name())
            except Exception: nm = "?"
            if nm == "Project Settings":
                node = k; return
            visit(k, depth + 1)
    visit(proj, 0)
    log("node: %r" % (None if node is None else str(node.get_name())))

    try:
        body = m.Invoke(inst, System.Array[System.Object]([node]))
        log("")
        log("--- .projectsettings body ---")
        log(body)
        log("--- end ---")
    except System.Exception, ex:
        log("")
        log("!!! THREW (full .NET chain):")
        log(ex.ToString())
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System; System.Environment.Exit(0)
    except Exception: pass
