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
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings2.log")
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



def members(o, label, methods=True):
    if o is None:
        log("  %s = None" % label); return
    t = o.GetType()
    log("  %s : %s" % (label, t.FullName))
    seen = set()
    for src in [t] + list(t.GetInterfaces()):
        for p in src.GetProperties():
            if p.Name in seen: continue
            seen.add(p.Name)
            try: v = p.GetValue(o, None)
            except Exception: v = "<threw>"
            log("      prop %-32s = %r" % (p.Name, v))
        if not methods: continue
        for m in src.GetMethods():
            if m.Name.startswith(("get_", "set_")) or len(m.GetParameters()) != 0 or m.Name in seen: continue
            seen.add(m.Name)
            try:
                v = m.Invoke(o, None)
                if v is not None and hasattr(v, "__iter__") and not isinstance(v, str): v = list(v)
            except Exception:
                v = "<threw>"
            log("      m()  %-32s = %r" % (m.Name, v))

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

    # 1) the Project Settings NODE the descriptor is handed, and everything on it
    log("")
    log("=== the Project Settings node ===")
    def visit(node, depth):
        if depth > 3: return
        try: kids = list(node.get_children())
        except Exception: return
        for k in kids:
            try: nm = str(k.get_name())
            except Exception: nm = "?"
            if "setting" in nm.lower():
                log("  node name = %r  type=%s" % (nm, k.GetType().FullName))
                members(k, "  scripting node")
                u = unwrap(k)
                members(u, "  unwrapped")
                g = prop(u, "guid")
                if g is not None and objmgr is not None:
                    try:
                        meta = objmgr.GetObjectToRead(prop(u, "handle") or 0, g)
                        members(meta, "  meta")
                        iobj = prop(meta, "Object")
                        members(iobj, "  meta.Object")
                    except Exception:
                        log("  meta threw: " + traceback.format_exc().splitlines()[-1])
            visit(k, depth + 1)
    visit(proj, 0)

    # 2) anything in the loaded assemblies that looks like it OWNS project settings
    log("")
    log("=== candidate settings services ===")
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try: types = asm.GetTypes()
        except Exception: continue
        for t in types:
            n = t.Name
            if not t.IsInterface and ("WarningHelper" in n or "CompilerSettings" in n or "ProjectSettings" in n):
                log("  %s" % t.FullName)
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
