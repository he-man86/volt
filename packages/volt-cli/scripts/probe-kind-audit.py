# Kind audit (openspec push-without-header-check 5.Q): which CODESYS object CLASSES a project holds (census), and
# whether a class or kind follows the TEXT written to it (DIALECT C2f/C2g/C2l). Run via ide.ps1 -RunScript on a COPY.
# ASCII ONLY (IronPython 2.7). Answer: kind-audit.log.
from __future__ import print_function
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "kind-audit.log")
_f = open(_LOG, "w")


def log(s):
    _f.write(str(s) + "\n")
    _f.flush()


_P = projects
_PouType = PouType
_DutType = DutType


def lmm():
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            continue
        if t is not None:
            p = t.GetProperty("LanguageModelMgr")
            if p is not None:
                return p.GetValue(None, None)
    return None


MGR = None
LMM = None
FIND = None


def find_sig(guid):
    import System
    global FIND
    if FIND is None:
        for s in [LMM.GetType()] + list(LMM.GetType().GetInterfaces()):
            for mi in s.GetMethods(vp.bf()):
                if mi.Name == "FindSignature" and len(mi.GetParameters()) == 2:
                    FIND = mi
                    break
            if FIND is not None:
                break
    args = System.Array[System.Object]([guid, None])
    try:
        sig = FIND.Invoke(LMM, args)
    except Exception as e:
        return "<raised %s>" % str(e)[:60]
    if sig is None:
        return "null"
    return "%s/%s" % (vp.prop(sig, "POUType"), vp.prop(sig, "Flags"))


def iobj_of(o):
    raw = vp.unwrap(o)
    guid = vp.prop(raw, "guid")
    handle = vp.prop(raw, "handle")
    ok, meta = vp.call(MGR, "GetObjectToRead", [handle, guid])
    if not ok:
        return None, guid, None
    return vp.prop(meta, "Object"), guid, meta


def ifaces_of(iobj):
    return "+".join(sorted(i.Name for i in iobj.GetType().GetInterfaces()
                           if i.Name.endswith("Object") and i.Name not in ("IObject", "IGenericObject")))


def describe(o, extra=""):
    iobj, guid, meta = iobj_of(o)
    if iobj is None:
        return "%s: READ FAILED" % o.get_name()
    otg = vp.prop(meta, "ObjectType")
    s = "%s: clr=%s ifaces=[%s] sig=%s" % (o.get_name(), iobj.GetType().FullName, ifaces_of(iobj), find_sig(guid))
    for p in ("ParameterList", "NetVarProperties", "ExcludeFromBuild"):
        v = vp.prop(iobj, p)
        if v is not None:
            s += " %s=%s" % (p, v)
    impl = None
    for asp in ("Implementation",):
        try:
            impl = vp.prop(iobj, asp)
        except Exception:
            impl = None
    if impl is not None:
        s += " impl=%s" % impl.GetType().Name
    return s + extra


def decl_text(o):
    try:
        return o.textual_declaration.text
    except Exception:
        return None


def set_decl(o, text):
    try:
        o.textual_declaration.replace(text)
        return "ok"
    except Exception as e:
        return "<raised %s>" % str(e)[:80]


def census(app):
    """Every object below the project root: CLR class -> count, interfaces, an example."""
    seen = {}
    roots = [_P.primary]
    for node in vp.walk(_P.primary, 0, 20):
        try:
            iobj, guid, meta = iobj_of(node)
        except Exception:
            continue
        if iobj is None:
            continue
        key = iobj.GetType().FullName
        rec = seen.get(key)
        if rec is None:
            rec = seen[key] = [0, ifaces_of(iobj), node.get_name(), set()]
        rec[0] += 1
        if "GVL" in key or "Var" in key or "NVL" in key or "Persist" in key:
            rec[3].add("PL=%s NV=%s" % (vp.prop(iobj, "ParameterList"), vp.prop(iobj, "NetVarProperties") is not None))
    for k in sorted(seen):
        c, i, ex, extra = seen[k]
        log("  %5d  %-70s [%s]  e.g. '%s' %s" % (c, k, i, ex, " ".join(sorted(extra))))


try:
    src = os.environ.get("VOLT_FIXTURE_PROJECT")
    log("probe-kind-audit - project %s" % src)
    _P.open(src)
    app = _P.primary.active_application
    MGR = vp.object_manager()
    LMM = lmm()
    log("opened; application %s" % app.get_name())

    log("")
    log("==== create_* surface of the application")
    for n in sorted(dir(app)):
        if n.startswith("create_"):
            log("  " + n)

    log("")
    log("==== census BEFORE (CLR class, count, interfaces)")
    census(app)

    f = app.create_folder("VltAudit")
    f = [c for c in app.get_children() if c.get_name() == "VltAudit"][0]

    log("")
    log("==== GVL family")
    made = []
    for meth, nm in [("create_gvl", "VltA_G"), ("create_persistentvariables", "VltA_PV"),
                     ("create_persistent_variables", "VltA_PV2"), ("create_nvl", "VltA_N"),
                     ("create_parameter_list", "VltA_PL"), ("create_paramlist", "VltA_PL2")]:
        fn = getattr(f, meth, None) or getattr(app, meth, None)
        if fn is None:
            log("  %s: not on the scripting container" % meth)
            continue
        try:
            o = fn(nm)
            log("  %s -> %s" % (meth, describe(o)))
            log("     decl: %s" % ((decl_text(o) or "").replace("\n", " | ")[:120]))
            made.append(o)
        except Exception as e:
            log("  %s raised %s" % (meth, str(e)[:120]))

    log("")
    log("==== text vs class: write a foreign declaration into each family")
    pou = f.create_pou("VltA_PI", _PouType.Program)
    log("  POU created Program: " + describe(pou))
    log("    write INTERFACE text: %s" % set_decl(pou, "INTERFACE VltA_PI\n"))
    log("    -> " + describe(pou))
    log("    write TYPE text: %s" % set_decl(pou, "TYPE VltA_PI :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\n"))
    log("    -> " + describe(pou))
    log("    write VAR_GLOBAL text: %s" % set_decl(pou, "VAR_GLOBAL\n g : INT;\nEND_VAR\n"))
    log("    -> " + describe(pou))
    log("    write FUNCTION_BLOCK text: %s" % set_decl(pou, "FUNCTION_BLOCK VltA_PI\nVAR\nEND_VAR\n"))
    log("    -> " + describe(pou))

    itf = f.create_interface("VltA_IP")
    log("  INTERFACE created: " + describe(itf))
    log("    write PROGRAM text: %s" % set_decl(itf, "PROGRAM VltA_IP\nVAR\nEND_VAR\n"))
    log("    -> " + describe(itf))
    log("    write FUNCTION_BLOCK text: %s" % set_decl(itf, "FUNCTION_BLOCK VltA_IP\nVAR\nEND_VAR\n"))
    log("    -> " + describe(itf))

    gvl = f.create_gvl("VltA_GX")
    log("  GVL created: " + describe(gvl))
    log("    write TYPE text: %s" % set_decl(gvl, "TYPE VltA_GX :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\n"))
    log("    -> " + describe(gvl))
    log("    write PROGRAM text: %s" % set_decl(gvl, "PROGRAM VltA_GX\nVAR\nEND_VAR\n"))
    log("    -> " + describe(gvl))
    log("    write VAR_GLOBAL PERSISTENT RETAIN text: %s" % set_decl(gvl, "VAR_GLOBAL PERSISTENT RETAIN\n p : INT;\nEND_VAR\n"))
    log("    -> " + describe(gvl))

    dut = f.create_dut("VltA_DX", _DutType.Structure)
    log("  DUT created: " + describe(dut))
    log("    write VAR_GLOBAL text: %s" % set_decl(dut, "VAR_GLOBAL\n g : INT;\nEND_VAR\n"))
    log("    -> " + describe(dut))
    log("    write PROGRAM text: %s" % set_decl(dut, "PROGRAM VltA_DX\nVAR\nEND_VAR\n"))
    log("    -> " + describe(dut))
    log("    write INTERFACE text: %s" % set_decl(dut, "INTERFACE VltA_DX\n"))
    log("    -> " + describe(dut))

    log("")
    log("==== members")
    fb = f.create_pou("VltA_FB", _PouType.FunctionBlock)
    for meth in ("create_method", "create_property", "create_action", "create_transition"):
        fn = getattr(fb, meth, None)
        log("  %s: %s" % (meth, fn.__doc__.split("\n")[0] if fn is not None and fn.__doc__ else ("absent" if fn is None else "?")))
    m = fb.create_method("M1")
    log("  method: " + describe(m))
    log("    write PROPERTY text: %s" % set_decl(m, "PROPERTY M1 : INT\n"))
    log("    -> " + describe(m))
    log("    write FUNCTION_BLOCK text: %s" % set_decl(m, "FUNCTION_BLOCK M1\nVAR\nEND_VAR\n"))
    log("    -> " + describe(m))
    p = fb.create_property("P1", "INT")
    log("  property: " + describe(p))
    for acc in p.get_children():
        log("    accessor: " + describe(acc))
    log("    write METHOD text: %s" % set_decl(p, "METHOD P1 : INT\n"))
    log("    -> " + describe(p))
    try:
        a = fb.create_action("A1")
        log("  action (default lang): " + describe(a))
        log("    decl: %s" % decl_text(a))
    except Exception as e:
        log("  create_action raised %s" % str(e)[:120])
    try:
        import System
        lang_ids = {}
        for nm in dir(ImplementationLanguages):
            if not nm.startswith("_"):
                lang_ids[nm] = getattr(ImplementationLanguages, nm)
        log("  ImplementationLanguages: %s" % ", ".join(sorted(lang_ids)))
        a2 = fb.create_action("A2", lang_ids.get("cfc") or lang_ids.get("fbd"))
        log("  action (cfc/fbd): " + describe(a2))
    except Exception as e:
        log("  create_action(lang) raised %s" % str(e)[:160])

    # an interface's members: their class vs a POU's
    im = itf.create_method("IM1") if hasattr(itf, "create_method") else None
    if im is not None:
        log("  interface method (interface now holds FUNCTION_BLOCK text): " + describe(im))
    itf2 = f.create_interface("VltA_I2")
    im2 = itf2.create_method("IM2")
    log("  interface method: " + describe(im2))
    ip2 = itf2.create_property("IP2", "INT")
    log("  interface property: " + describe(ip2))
    for acc in ip2.get_children():
        log("    accessor: " + describe(acc))

    # a POU holding INTERFACE text: what does its new method become?
    pou2 = f.create_pou("VltA_P2", _PouType.FunctionBlock)
    set_decl(pou2, "INTERFACE VltA_P2\n")
    pm = pou2.create_method("PM")
    log("  method of a POU holding INTERFACE text: " + describe(pm) + " ; owner " + describe(pou2))

    log("")
    log("==== census AFTER (VltAudit folder only)")
    for node in vp.walk(f, 0, 6):
        log("  " + describe(node))
    log("DONE")
except Exception:
    import traceback
    log(traceback.format_exc())
finally:
    _f.close()
    try:
        import System
        System.Environment.Exit(0)
    except Exception:
        pass
