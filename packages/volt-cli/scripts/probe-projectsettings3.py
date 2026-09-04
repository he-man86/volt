# Why a HEADLESS pull loses the project's disabled-warning ids.
#
# ProjectSettingsDescriptor reads APEnvironment.LMServiceProvider -> ConfigurationService ->
# WarningConfiguration, a SESSION-GLOBAL singleton rather than the node being described. Pulled from a
# headless session it answered "no disabled warnings" for a project whose build proves C0371 is off.
# This dumps what that chain actually returns, and what else is on it, with the project open.
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings3.log")
SRC = os.environ.get("VOLT_PROBE_PROJECT") or ""

f = open(LOG, "w")
def log(s):
    f.write(str(s) + "\n"); f.flush()

BF = None
def _bf():
    global BF
    if BF is None:
        from System.Reflection import BindingFlags as B
        BF = B.Public | B.NonPublic | B.Instance | B.FlattenHierarchy
    return BF

def unwrap(o):
    for _ in range(10):
        if o is None:
            return None
        try:
            bp = o.GetType().GetProperty("BaseObject", _bf())
        except Exception:
            return o
        if bp is None:
            return o
        try:
            inner = bp.GetValue(o, None)
        except Exception:
            return o
        if inner is None or inner is o:
            return o
        o = inner
    return o

def prop(o, name):
    if o is None:
        return None
    try:
        t = o.GetType()
    except Exception:
        return None
    try:
        p = t.GetProperty(name, _bf())
        if p is not None:
            return p.GetValue(o, None)
    except Exception:
        pass
    try:
        for i in t.GetInterfaces():
            ip = i.GetProperty(name)
            if ip is not None:
                return ip.GetValue(o, None)
    except Exception:
        pass
    try:
        return getattr(o, name)
    except Exception:
        return None

def call(o, name, args):
    import System
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods(_bf()):
            if m.Name != name or len(m.GetParameters()) != len(args):
                continue
            try:
                return True, m.Invoke(o, System.Array[System.Object](list(args)))
            except Exception:
                return False, None
    return False, None




try:
    import clr, System
    proj = projects.open(SRC)
    log("opened " + os.path.basename(SRC))

    objmgr = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try: t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception: t = None
        if t is None: continue
        p = t.GetProperty("ObjectMgr")
        if p is not None: objmgr = p.GetValue(None, None)
        if objmgr is not None: break

    def visit(node, depth):
        if depth > 3: return
        try: kids = list(node.get_children())
        except Exception: return
        for k in kids:
            try: nm = str(k.get_name())
            except Exception: nm = "?"
            if "setting" in nm.lower():
                u = unwrap(k)
                g = prop(u, "guid")
                meta = objmgr.GetObjectToRead(prop(u, "handle") or 0, g)
                iobj = prop(meta, "Object")
                data = prop(iobj, "OptionData")
                log("")
                log("=== %s : OptionData %d bytes ===" % (nm, 0 if data is None else len(data)))
                if data is not None:
                    out = os.path.join(tempfile.gettempdir(), "volt-optiondata.xml")
                    System.IO.File.WriteAllBytes(out, data)
                    log("wrote " + out)
            visit(k, depth + 1)
    visit(proj, 0)
    proj.close()
    log("")
    log("done")
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System; System.Environment.Exit(0)
    except Exception: pass
