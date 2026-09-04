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
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings5.log")
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

    store = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try: t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception: t = None
        if t is None: continue
        p = t.GetProperty("OptionStorage")
        if p is not None:
            store = p.GetValue(None, None)
            break
    if store is None:
        log("OptionStorage unavailable"); raise SystemExit

    log("")
    log("=== OptionStorage surface ===")
    t = store.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods():
            if m.Name.startswith(("get_", "set_")): continue
            ps = m.GetParameters()
            log("   %-34s (%s) -> %s" % (m.Name, ", ".join(x.ParameterType.Name for x in ps), m.ReturnType.Name))
        for p in src.GetProperties():
            try: v = p.GetValue(store, None)
            except Exception: v = "<threw>"
            log("   prop %-30s = %r" % (p.Name, v))

    # Enumerate whatever keys it will give us, and show any that mention warnings.
    log("")
    log("=== keys ===")
    for name in ("GetKeys", "Keys", "GetOptionKeys", "EnumKeys", "GetAllKeys"):
        try:
            mm = t.GetMethod(name)
            if mm is None: continue
            v = mm.Invoke(store, None)
            keys = list(v) if v is not None else []
            log("   %s -> %d keys" % (name, len(keys)))
            for k in keys[:200]:
                log("      %r" % (k,))
        except Exception:
            log("   %s threw: %s" % (name, traceback.format_exc().splitlines()[-1]))
    proj.close()
    log("")
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
