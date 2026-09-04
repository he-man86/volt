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
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "projectsettings.log")
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


def members(o, label):
    if o is None:
        log("  %s = None" % label)
        return
    t = o.GetType()
    log("  %s : %s" % (label, t.FullName))
    seen = set()
    for src in [t] + list(t.GetInterfaces()):
        for p in src.GetProperties():
            if p.Name in seen: continue
            seen.add(p.Name)
            try: v = p.GetValue(o, None)
            except Exception: v = "<threw>"
            log("      prop %-34s = %r" % (p.Name, v))
        for m in src.GetMethods():
            if m.Name.startswith("get_") or m.Name.startswith("set_"): continue
            if len(m.GetParameters()) != 0: continue
            if m.Name in seen: continue
            seen.add(m.Name)
            try:
                v = m.Invoke(o, None)
                if v is not None and hasattr(v, "__iter__") and not isinstance(v, str):
                    v = list(v)
            except Exception:
                v = "<threw>"
            log("      m()  %-34s = %r" % (m.Name, v))

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

try:
    import clr, System, shutil
    if not SRC or not os.path.exists(SRC):
        log("VOLT_PROBE_PROJECT missing: %r" % SRC); raise SystemExit

    log("=== BEFORE opening any project ===")
    provider = static_member("_3S.CoDeSys.Engine.APEnvironment", "LMServiceProvider")
    log("  LMServiceProvider = %r" % provider)

    proj = projects.open(SRC)
    log("")
    log("=== AFTER projects.open(%s) ===" % os.path.basename(SRC))

    provider = static_member("_3S.CoDeSys.Engine.APEnvironment", "LMServiceProvider")
    if provider is None:
        log("  LMServiceProvider STILL None"); raise SystemExit
    members(provider, "LMServiceProvider")

    cfg = None
    try:
        cfg = provider.GetType().GetProperty("ConfigurationService").GetValue(provider, None)
    except Exception:
        log("  ConfigurationService threw: " + traceback.format_exc().splitlines()[-1])
    log("")
    members(cfg, "ConfigurationService")

    wc = None
    if cfg is not None:
        try:
            wc = cfg.GetType().GetProperty("WarningConfiguration").GetValue(cfg, None)
        except Exception:
            pass
    log("")
    members(wc, "WarningConfiguration")
    if wc is not None:
        for g in ("GetDisabledWarningIds", "GetWarningAsErrorIds"):
            try:
                v = wc.GetType().GetMethod(g).Invoke(wc, None)
                log("  %s() -> %r" % (g, None if v is None else list(v)))
            except Exception:
                log("  %s() threw: %s" % (g, traceback.format_exc().splitlines()[-1]))

    # Does compiling / touching the application make the settings appear?
    log("")
    log("=== after selecting the application ===")
    try:
        apps = proj.find("Application", True)
        log("  find('Application') -> %d" % len(apps))
        if len(apps) > 0:
            app = apps[0]
            log("  app = %r  guid=%r" % (app.get_name(), getattr(app, "guid", None)))
            try:
                app.set_active_application()
                log("  set_active_application() ok")
            except Exception:
                log("  set_active_application threw: " + traceback.format_exc().splitlines()[-1])
    except Exception:
        log("  " + traceback.format_exc().splitlines()[-1])

    provider = static_member("_3S.CoDeSys.Engine.APEnvironment", "LMServiceProvider")
    cfg2 = provider.GetType().GetProperty("ConfigurationService").GetValue(provider, None) if provider else None
    wc2 = cfg2.GetType().GetProperty("WarningConfiguration").GetValue(cfg2, None) if cfg2 else None
    if wc2 is not None:
        for g in ("GetDisabledWarningIds", "GetWarningAsErrorIds"):
            try:
                v = wc2.GetType().GetMethod(g).Invoke(wc2, None)
                log("  %s() -> %r" % (g, None if v is None else list(v)))
            except Exception:
                log("  %s() threw" % g)
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
