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
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings6.log")
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







def call0(o, name):
    try:
        m = o.GetType().GetMethod(name)
        if m is None:
            for i in o.GetType().GetInterfaces():
                m = i.GetMethod(name)
                if m is not None: break
        if m is None or len(m.GetParameters()) != 0: return None
        return m.Invoke(o, None)
    except Exception:
        return None

def walk_key(k, path, depth, hits):
    if k is None or depth > 6: return
    name = prop(k, "Name")
    here = path + "/" + str(name)
    for getter in ("GetValueNames", "ValueNames", "GetValues"):
        vals = call0(k, getter)
        if vals is None: continue
        try: vals = list(vals)
        except Exception: continue
        for vn in vals:
            try:
                m = k.GetType().GetMethod("GetValue")
                if m is None:
                    for i in k.GetType().GetInterfaces():
                        m = i.GetMethod("GetValue")
                        if m is not None: break
                import System
                v = m.Invoke(k, System.Array[System.Object]([vn])) if m is not None else None
            except Exception:
                v = "<threw>"
            s = repr(v)
            if "371" in s or "arn" in str(vn) or "arn" in s:
                hits.append("%s :: %s = %s" % (here, vn, s[:300]))
        break
    for getter in ("GetSubKeys", "SubKeys", "GetSubKeyNames"):
        subs = call0(k, getter)
        if subs is None: continue
        try: subs = list(subs)
        except Exception: continue
        for sk in subs:
            if isinstance(sk, str):
                import System
                m = k.GetType().GetMethod("GetSubKey")
                if m is None:
                    for i in k.GetType().GetInterfaces():
                        m = i.GetMethod("GetSubKey")
                        if m is not None: break
                try: sk = m.Invoke(k, System.Array[System.Object]([sk])) if m is not None else None
                except Exception: sk = None
            walk_key(sk, here, depth + 1, hits)
        break

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

    m = store.GetType().GetMethod("GetRootKey")
    if m is None:
        for i in store.GetType().GetInterfaces():
            m = i.GetMethod("GetRootKey")
            if m is not None: break
    rootEnum = m.GetParameters()[0].ParameterType
    log("OptionRoot values: %r" % list(System.Enum.GetNames(rootEnum)))

    for nm in System.Enum.GetNames(rootEnum):
        val = System.Enum.Parse(rootEnum, nm)
        try:
            key = m.Invoke(store, System.Array[System.Object]([val]))
        except Exception:
            log("  %s -> threw" % nm); continue
        log("")
        log("=== root %s -> %r ===" % (nm, key))
        if key is None: continue
        kt = key.GetType()
        log("   key type %s" % kt.FullName)
        seen = set()
        for src in [kt] + list(kt.GetInterfaces()):
            for mm in src.GetMethods():
                if mm.Name in seen or mm.Name.startswith(("get_","set_","add_","remove_")): continue
                seen.add(mm.Name)
                log("      m %-28s (%s)" % (mm.Name, ", ".join(x.ParameterType.Name for x in mm.GetParameters())))
        hits = []
        walk_key(key, "", 0, hits)
        log("   HITS: %d" % len(hits))
        for h in hits[:40]: log("      " + h)
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
