# Kind audit, part 2 (openspec push-without-header-check 5.Q): which members a POU accepts follows its TEXT, not
# its creation seed (DIALECT C2k), and a member keeps its class whatever its text (C2l). Run via ide.ps1 -RunScript on
# a COPY. ASCII ONLY (IronPython 2.7). Answer: kind-audit2.log.
from __future__ import print_function
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "kind-audit2.log")
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


def try_child(owner, meth, *args):
    try:
        c = getattr(owner, meth)(*args)
        return "accepted -> " + describe(c)
    except Exception as e:
        return "REFUSED: " + str(e)[:90]


try:
    src = os.environ.get("VOLT_FIXTURE_PROJECT")
    log("probe-kind-audit2 - project %s" % src)
    _P.open(src)
    app = _P.primary.active_application
    MGR = vp.object_manager()
    LMM = lmm()
    app.create_folder("VltAudit2")
    f = [c for c in app.get_children() if c.get_name() == "VltAudit2"][0]
    cases = [
        ("VltB_FB", _PouType.FunctionBlock, None),
        ("VltB_PRG", _PouType.Program, None),
        ("VltB_FUN", _PouType.Function, None),
        ("VltB_FBasFUN", _PouType.FunctionBlock, "FUNCTION VltB_FBasFUN : INT\nVAR_INPUT\nEND_VAR\n"),
        ("VltB_FUNasFB", _PouType.Function, "FUNCTION_BLOCK VltB_FUNasFB\nVAR\nEND_VAR\n"),
        ("VltB_FBasITF", _PouType.FunctionBlock, "INTERFACE VltB_FBasITF\n"),
        ("VltB_FBbroken", _PouType.FunctionBlock, "(* doc\nFUNCTION_BLOCK VltB_FBbroken\n"),
    ]
    for nm, pt, text in cases:
        if pt == _PouType.Function:
            o = f.create_pou(nm, pt, None, "INT")
        else:
            o = f.create_pou(nm, pt)
        if text is not None:
            set_decl(o, text)
        log("== %s: %s" % (nm, describe(o)))
        for meth in ("create_method", "create_property", "create_action", "create_transition"):
            if meth == "create_property":
                r = try_child(o, meth, nm[:6] + "_p", "INT")
            else:
                r = try_child(o, meth, nm[:6] + "_" + meth[7:9])
            log("    %s: %s" % (meth, r))
    # Text change AFTER children exist: an FB with a method rewritten as FUNCTION - does the method survive?
    fb = f.create_pou("VltB_Keep", _PouType.FunctionBlock)
    fb.create_method("KM")
    set_decl(fb, "FUNCTION VltB_Keep : INT\nVAR_INPUT\nEND_VAR\n")
    log("== VltB_Keep (FB with method, rewritten FUNCTION): %s ; children %s" % (
        describe(fb), [c.get_name() for c in fb.get_children()]))
    # abstract method: class vs text
    fba = f.create_pou("VltB_Abs", _PouType.FunctionBlock)
    set_decl(fba, "FUNCTION_BLOCK ABSTRACT VltB_Abs\nVAR\nEND_VAR\n")
    m = fba.create_method("AM")
    log("== plain method in ABSTRACT FB: " + describe(m))
    log("   write METHOD ABSTRACT text: %s" % set_decl(m, "METHOD ABSTRACT AM : INT\n"))
    log("   -> " + describe(m))
    # an existing AbstractPOUMethodObject: its declaration
    for node in vp.walk(_P.primary, 0, 20):
        try:
            iobj, g, meta = iobj_of(node)
        except Exception:
            continue
        if iobj is not None and iobj.GetType().Name == "AbstractPOUMethodObject":
            log("== existing AbstractPOUMethodObject %s decl: %s" % (node.get_name(), (decl_text(node) or "").replace("\n", " | ")[:100]))
            log("   write plain METHOD text: %s" % set_decl(node, "METHOD %s : BOOL\n" % node.get_name()))
            log("   -> " + describe(node))
            break
    for node in vp.walk(_P.primary, 0, 20):
        try:
            iobj, g, meta = iobj_of(node)
        except Exception:
            continue
        if iobj is not None and iobj.GetType().Name == "POUObjectCheckFunction":
            log("== check function %s decl: %s" % (node.get_name(), (decl_text(node) or "").replace("\n", " | ")[:100]))
            break
    for node in vp.walk(_P.primary, 0, 20):
        try:
            iobj, g, meta = iobj_of(node)
        except Exception:
            continue
        if iobj is not None and iobj.GetType().Name == "VarPersistentObject":
            log("== persistent %s decl: %s" % (node.get_name(), (decl_text(node) or "").replace("\n", " | ")[:140]))
            break
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
