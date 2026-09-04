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
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings8.log")
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









WARN_KEY = "{8F99A816-E488-41E4-9FA3-846536012284}"
OPTS_KEY = "{E709B08B-B6E4-4966-8EED-D793A13114C6}"

def find_method(o, name, argc):
    for src in [o.GetType()] + list(o.GetType().GetInterfaces()):
        for m in src.GetMethods():
            if m.Name == name and len(m.GetParameters()) == argc:
                return m
    return None

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
        if p is not None: store = p.GetValue(None, None)
        if store is not None: break

    grk = find_method(store, "GetRootKey", 1)
    rootEnum = grk.GetParameters()[0].ParameterType
    root = grk.Invoke(store, System.Array[System.Object]([System.Enum.Parse(rootEnum, "Project")]))
    log("root = %r" % root)

    log("")
    log("=== every method on IOptionKey (untruncated) ===")
    seen = set()
    for src in [root.GetType()] + list(root.GetType().GetInterfaces()):
        for m in src.GetMethods():
            sig = "%s(%s)" % (m.Name, ", ".join(x.ParameterType.Name for x in m.GetParameters()))
            if sig in seen: continue
            seen.add(sig)
            log("   %-60s generic=%s -> %s" % (sig, m.IsGenericMethod, m.ReturnType.Name))

    for keyname in (WARN_KEY, OPTS_KEY):
        log("")
        log("=== OpenSubKey(%s) ===" % keyname)
        osk = find_method(root, "OpenSubKey", 1)
        sub = osk.Invoke(root, System.Array[System.Object]([keyname]))
        log("   sub = %r" % sub)
        if sub is None: continue
        gsvn = find_method(sub, "GetSerializableValueNames", 2)
        try:
            names = gsvn.Invoke(sub, System.Array[System.Object]([None, None]))
            log("   value names: %r" % (None if names is None else list(names)))
        except Exception:
            log("   GetSerializableValueNames threw: " + traceback.format_exc().splitlines()[-1])
        # the generic getter
        for m in [x for x in sub.GetType().GetMethods() if x.Name == "GetValue"] + \
                 [x for i in sub.GetType().GetInterfaces() for x in i.GetMethods() if x.Name == "GetValue"]:
            log("   GetValue candidate: generic=%s params=%r" % (m.IsGenericMethod, [p.ParameterType.Name for p in m.GetParameters()]))
            try:
                mm = m.MakeGenericMethod(System.Array[System.Type]([clr.GetClrType(System.String)])) if m.IsGenericMethod else m
                for vn in ("DisabledWarningIds", "ReplaceConstants", "MaxCompilerWarnings"):
                    try:
                        args = [vn, ""] if len(mm.GetParameters()) == 2 else [vn]
                        v = mm.Invoke(sub, System.Array[System.Object](args))
                        log("      %s -> %r" % (vn, v))
                    except Exception:
                        pass
            except Exception:
                log("      makegeneric threw: " + traceback.format_exc().splitlines()[-1])
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
