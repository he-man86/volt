# -*- coding: utf-8 -*-
# THE CODESYS VENDOR CORE of the one vendor-fact probe (openspec vendor-fact-probe 2.2). `vendor-facts.ts` drives it.
#
# The runscript for a normal GUI CODESYS that `ide.ps1 up -Vendor codesys -Instance vendor-fact-probe -RunScript
# <this file>` starts. It runs `run_pipe_production.py` VERBATIM (the fixture copy + the shipped `start_volt_codesys.py`,
# so the pipe is the shipped bridge the runner pushes through), then arms a UI-thread timer that answers the runner's
# requests by file:
#
#   request : %LOCALAPPDATA%\volt-bridge\vendor-facts\<pid>\request    one JSON object (written to request.tmp, renamed),
#             in ASCII: every other character arrives as a \u escape (IronPython 2.7 reads the file)
#   answer  : <seq>.out (JSON) then <seq>.done - or <seq>.error with the reason
#   ready   : the file `ready`, once the timer is armed
#
# It implements the table's closed vocabulary ONCE (vendor-facts.table.ts): the steps that are not a push (create, find,
# setText, rename, move, delete, open, close, build, reload, invoke, tryNames) and every read (member, class, guid,
# parent, children, signature, parse, same, diagnostics, process, tried). No fact has a code path of its own here.
#
# A VENDOR exception during a step is the step's outcome - `refused: <its words>` - because that IS the fact. A probe
# fault (an unknown op, a handle that is not there, a malformed path) is a ProbeError and becomes <seq>.error: the runner
# aborts naming it. A member a path names that is not there reads null (the absence is the answer); a vendor exception
# while walking a path reads {"raised": "<type>: <message>"}.
#
# Handles are kept by GUID and re-resolved on every use (object manager -> its current name -> the scripting object with
# that guid), so a push that renamed or moved an object, and an `open`/`reload` that replaced every scripting object,
# leave them valid.
#
# ASCII ONLY (IronPython 2.7: no f-strings, no `nonlocal`).
from __future__ import print_function
import json
import os
import sys
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

# The production host, verbatim - the same `compile`+`exec` it uses for the shipped script, for the same reason.
_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))

import clr
clr.AddReference("System.Windows.Forms")
clr.AddReference("System.Xml")
import System
import System.Xml
from System.Windows.Forms import Timer
from System.Diagnostics import Process
from System.Reflection import BindingFlags as _B

# Captured now: the runscript's injected globals may not outlive the script body the timer outlives.
_P = projects
_SYS = system
_DutType = DutType
_PouType = PouType
_Lang = ImplementationLanguages

_DIR = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "vendor-facts", str(Process.GetCurrentProcess().Id))
if not os.path.isdir(_DIR):
    os.makedirs(_DIR)
for _n in os.listdir(_DIR):
    os.remove(os.path.join(_DIR, _n))           # what a previous IDE with this pid left answers nothing

_BASE = os.environ.get("VOLT_FIXTURE_PROJECT")  # the run's own fixture copy (ide.ps1 made it); cleanup reopens it


class ProbeError(Exception):
    """A fault of the probe, never a vendor answer."""


# ---- per-row state ----------------------------------------------------------------------------------------------

_H = {}          # handle -> {"guid": System.Guid, "created": "script"|"adopted"|"found"}
_ORDER = []      # handles in creation order (cleanup deletes the script-created ones in reverse)
_CACHE = {}      # read key -> the raw object its first `member` read held (for `same`)
_ROW = {"opened": False, "reloaded": False, "saved_base": False}


def _begin():
    _H.clear()
    del _ORDER[:]
    _CACHE.clear()
    _ROW["opened"] = False
    _ROW["reloaded"] = False
    _ROW["saved_base"] = False


# ---- the project and its objects --------------------------------------------------------------------------------

def _proj():
    p = _P.primary
    if p is None:
        raise ProbeError("no project is open")
    return p


def _app():
    a = _proj().active_application
    if a is None:
        raise ProbeError("the open project has no active application")
    return a


def _guid(o):
    g = vp.prop(vp.unwrap(o), "guid")
    if g is None:
        g = getattr(o, "guid", None)
    if g is None:
        raise ProbeError("object %r has no guid" % o)
    return g


def _project_handle():
    for c in _proj().get_children():
        h = vp.prop(vp.unwrap(c), "handle")
        if h is not None:
            return h
    raise ProbeError("the open project has no child to read its handle from")


def _meta(guid):
    ok, meta = vp.call(vp.object_manager(), "GetObjectToRead", [_project_handle(), guid])
    if not ok or meta is None:
        return None
    return meta


def _resolve(handle):
    if handle == "root":
        return _app()
    h = _H.get(handle)
    if h is None:
        raise ProbeError("no handle '%s' in this row" % handle)
    meta = _meta(h["guid"])
    if meta is None:
        raise ProbeError("handle '%s' (%s) is not in the open project" % (handle, h["guid"]))
    name = vp.prop(meta, "Name")
    for o in _proj().find(name, True):
        if _guid(o) == h["guid"]:
            return o
    raise ProbeError("handle '%s': the object manager names it '%s', but no scripting object '%s' has its guid" % (handle, name, name))


def _iobject(o):
    meta = _meta(_guid(o))
    if meta is None:
        raise ProbeError("the object manager cannot read %s" % o.get_name())
    return meta, vp.prop(meta, "Object")


def _find(name, under):
    if under is None:
        hits = [o for o in _proj().find(name, True) if o.get_name() == name]
    else:
        hits = [o for o in vp.walk(_resolve(under), 0, 20) if o.get_name() == name]
    if len(hits) > 1:
        # A task's call entry shares its program's name; the object with a declaration is the one asked for.
        decl = [o for o in hits if getattr(o, "has_textual_declaration", False)]
        if decl:
            hits = decl
    if len(hits) != 1:
        raise ProbeError("find '%s'%s: %d objects have that name" % (name, "" if under is None else " under " + under, len(hits)))
    return hits[0]


def _keep(handle, o, created):
    _H[handle] = {"guid": _guid(o), "created": created}
    _ORDER.append(handle)


def _child_named(parent, name):
    for c in parent.get_children():
        if c.get_name() == name:
            return c
    return None


_DUT = {"struct": "Structure", "enum": "Enumeration", "union": "Union", "alias": "Alias"}
_POU = {"program": "Program", "function_block": "FunctionBlock", "function": "Function"}


_LANG = {"ST": "st", "FBD": "fbd", "LD": "ld"}


def _create(step):
    o = _make(_resolve(step["parent"]), step["kind"], step["name"], step)
    _keep(step["as"], o, "script")
    if step.get("decl") is not None:
        o.textual_declaration.replace(step["decl"])
    if step.get("impl") is not None:
        o.textual_implementation.replace(step["impl"])


def _make(parent, kind, name, step):
    """One object of `kind` named `name` under `parent`, through the scripting factory the driver calls."""
    lang = step.get("language") or "ST"
    if lang not in _LANG:
        raise ProbeError("unknown language '%s'" % lang)
    lang = getattr(_Lang, _LANG[lang])
    if kind == "folder":
        parent.create_folder(name)                  # returns None on SP21; found again by name
        o = _child_named(parent, name)
    elif kind == "dut":
        seed = step.get("seed") or "struct"
        if seed not in _DUT:
            raise ProbeError("unknown DUT seed '%s'" % seed)
        if seed == "alias":
            o = parent.create_dut(name, getattr(_DutType, _DUT[seed]), "INT")
        else:
            o = parent.create_dut(name, getattr(_DutType, _DUT[seed]))
    elif kind in _POU:
        if kind == "function":
            o = parent.create_pou(name=name, type=_PouType.Function, language=lang, return_type="INT")
        else:
            o = parent.create_pou(name=name, type=getattr(_PouType, _POU[kind]), language=lang)
    elif kind == "interface":
        o = parent.create_interface(name)
    elif kind == "gvl":
        o = parent.create_gvl(name)
    elif kind == "method":
        o = parent.create_method(name)
    elif kind == "property":
        o = parent.create_property(name, "INT")
    elif kind == "action":
        o = parent.create_action(name)
    elif kind == "transition":
        o = parent.create_transition(name)
    else:
        raise ProbeError("CODESYS has no create for kind '%s'" % kind)
    if o is None:
        raise ProbeError("create %s '%s' returned nothing and no child of that name exists" % (kind, name))
    return o


_TRIED = []      # the last tryNames step's (name, outcome) pairs, for the `tried` read right after it


def _try_names(step):
    """Each name alone: made under the parent, read back, removed. A vendor exception is the NAME's verdict; a failed
    remove is a probe fault (it would leave the name taken for the next one)."""
    del _TRIED[:]
    for name in step["names"]:
        parent = _resolve(step["parent"])
        try:
            o = _make(parent, step["kind"], name, step)
        except ProbeError:
            raise
        except Exception as e:
            _TRIED.append((name, "refused: " + _why(e)))
            continue
        got = o.get_name()
        _TRIED.append((name, "created" if got == name else "created as " + got))
        o.remove()


def _name_refusal(name, outcome):
    """Whether `outcome` is CODESYS's refusal of the NAME - its own sentence for exactly that name, the one every
    reserved word and every non-identifier shape answered (vendor-facts.codesys.json, identifier-shapes). Anything else
    (a kind refusal 'is not accepted by parent object', a scripting fault) is no verdict on the name."""
    if not outcome.startswith("refused: "):
        return False
    rest = outcome[len("refused: "):]
    msg = rest.split(": ", 1)[1] if ": " in rest else rest
    return msg == "The name '%s' is not valid for this object." % name


def _tried(what):
    if what == "outcomes":
        return dict(_TRIED)
    if what == "verdicts":
        return {"accepted": sorted(n for n, o in _TRIED if o == "created"),
                "refused": sorted(n for n, o in _TRIED if _name_refusal(n, o)),
                "other": sorted("%s -> %s" % (n, o[len("created as "):]) for n, o in _TRIED if o.startswith("created as ")),
                "unexplained": sorted("%s: %s" % (n, o[len("refused: "):]) for n, o in _TRIED
                                      if o.startswith("refused: ") and not _name_refusal(n, o))}
    raise ProbeError("unknown tried read '%s'" % what)


# ---- paths --------------------------------------------------------------------------------------------------------

class _Raised(Exception):
    pass


def _split(path):
    """`a.b("x.y", 1).c[0]` -> ["a", 'b("x.y", 1)', "c[0]"]: dots inside parentheses or quotes do not split."""
    out, cur, depth, quote = [], "", 0, False
    for ch in path:
        if ch == '"':
            quote = not quote
        if not quote and ch == "(":
            depth += 1
        if not quote and ch == ")":
            depth -= 1
        if ch == "." and depth == 0 and not quote:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def _find_type(name):
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = a.GetType(name, False)
        except Exception:
            t = None
        if t is not None:
            return t
    return None


def _root_of(segs, on):
    """The value a path starts from, and the segments left to walk. A static root names a TYPE (the longest dotted
    prefix that is one); its first segment is then a STATIC member."""
    head = segs[0]
    if head.startswith("static:"):
        parts = [head[len("static:"):]] + segs[1:]
        for n in range(len(parts), 0, -1):
            t = _find_type(".".join(parts[:n]))
            if t is not None:
                return ("static", t), parts[n:]
        raise ProbeError("no type loaded in this IDE is named by '%s'" % ".".join(parts))
    if head == "script":
        return _resolve(_need(on, head)), segs[1:]
    if head == "object":
        return _iobject(_resolve(_need(on, head)))[1], segs[1:]
    if head == "meta":
        return _iobject(_resolve(_need(on, head)))[0], segs[1:]
    if head == "project":
        return _proj(), segs[1:]
    if head in ("app", "root"):
        return _app(), segs[1:]
    raise ProbeError("unknown path root '%s' (script, object, meta, project, app, static:<type>)" % head)


def _need(on, root):
    if not on:
        raise ProbeError("path root '%s' needs a subject (`on`)" % root)
    return on


def _args(text):
    try:
        return json.loads("[" + text + "]")
    except Exception:
        raise ProbeError("arguments '%s' are not JSON" % text)


def _static_member(t, name):
    flags = _B.Public | _B.NonPublic | _B.Static | _B.FlattenHierarchy
    p = t.GetProperty(name, flags)
    if p is not None:
        return p.GetValue(None, None)
    f = t.GetField(name, flags)
    if f is not None:
        return f.GetValue(None)
    return None


def _type_name(v):
    try:
        return v.GetType().FullName
    except Exception:
        return clr.GetClrType(type(v)).FullName


def _step_seg(v, seg):
    static = isinstance(v, tuple) and len(v) == 2 and v[0] == "static"
    target = v[1] if static else v
    if seg.startswith("$"):
        name, _, rest = seg.partition("(")
        if name == "$type":
            return _type_name(target)
        if name == "$base":
            return vp.unwrap(target)
        if name == "$interfaces":
            return sorted(set(i.Name for i in target.GetType().GetInterfaces()))
        if name == "$methods":
            prefix = _args(rest[:-1])[0] if rest else ""
            t = target.GetType()
            return sorted(set(m.Name for s in [t] + list(t.GetInterfaces()) for m in s.GetMethods(vp.bf()) if m.Name.startswith(prefix)))
        if name == "$constructors":
            if not static:
                raise ProbeError("$constructors needs a static: type")
            return sorted(", ".join(p.ParameterType.Name for p in c.GetParameters())
                          for c in target.GetConstructors(_B.Public | _B.NonPublic | _B.Instance))
        if name == "$enumNames":
            if not static or not target.IsEnum:
                raise ProbeError("$enumNames needs a static: enum type")
            return list(System.Enum.GetNames(target))
        if name == "$count":
            return len(list(target))
        if name == "$extension":
            return os.path.splitext(str(target))[1]
        if name == "$xmlElements":
            # The element names of an XML string, in document order - its skeleton without the attribute values.
            doc = System.Xml.XmlDocument()
            doc.LoadXml(str(target))
            return [n.LocalName for n in doc.SelectNodes("//*")]
        raise ProbeError("unknown path segment '%s'" % seg)
    index = None
    if seg.endswith("]") and "[" in seg:
        seg, _, ix = seg[:-1].partition("[")
        index = int(ix)
    if "(" in seg:
        name, _, rest = seg.partition("(")
        out = _call(target, name, _args(rest[:-1]), static)
    elif static:
        out = _static_member(target, seg)
    else:
        out = vp.prop(target, seg)
    if index is not None and out is not None:
        out = list(out)[index]
    return out


def _call(target, name, args, static=False):
    if static:
        m = target.GetMethod(name, _B.Public | _B.NonPublic | _B.Static)
        if m is None:
            return None
        return m.Invoke(None, System.Array[System.Object](args))
    f = getattr(target, name, None)
    if f is not None and callable(f):
        return f(*args)
    ok, out = vp.call(target, name, args)
    if not ok:
        if out.startswith("no method") or out.startswith("no " + name):
            return None
        raise _Raised(out)
    return out


def _eval(path, on):
    segs = _split(path)
    v, rest = _root_of(segs, on)
    for seg in rest:
        if v is None:
            return None
        try:
            v = _step_seg(v, seg)
        except ProbeError:
            raise
        except _Raised as e:
            return {"raised": str(e)}
        except Exception as e:
            return {"raised": _why(e)}
    if isinstance(v, tuple) and len(v) == 2 and v[0] == "static":
        return v[1]
    return v


def _why(e):
    inner = getattr(e, "InnerException", None)
    while inner is not None and getattr(inner, "InnerException", None) is not None:
        inner = inner.InnerException
    src = inner if inner is not None else e
    try:
        tn = src.GetType().Name
    except Exception:
        tn = type(src).__name__
    msg = getattr(src, "Message", None) or str(src)
    return "%s: %s" % (tn, str(msg).replace("\r\n", "\n").strip())


_MAX_ITEMS = 500


def _render(v, depth=0):
    """The JSON form of a value. A vendor object that is not a collection renders as its type name. A value that would
    not render WHOLE is a probe fault, never a cut: a collection of more than _MAX_ITEMS items (read `$count` or a
    narrower path), or one nested deeper than two levels."""
    if v is None:
        return None
    if isinstance(v, dict):
        return dict((k, _render(x, depth)) for k, x in v.items())
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, long, float)):
        return v
    if isinstance(v, (str, unicode)):
        return v
    try:
        t = v.GetType()
    except Exception:
        t = None
    if t is not None:
        if t == clr.GetClrType(System.Boolean):
            return bool(v)
        if t.IsEnum or t == clr.GetClrType(System.Guid):
            return str(v)
        if t.IsPrimitive or t == clr.GetClrType(System.Decimal):
            return float(v) if "." in str(v) else int(str(v))
        if t == clr.GetClrType(System.String):
            return str(v)
        if isinstance(v, System.Type):
            return v.FullName
    try:
        items = list(v)
    except Exception:
        items = None
    if items is not None:
        what = t.FullName if t is not None else type(v).__name__
        if depth >= 2:
            raise ProbeError("a %s collection nested deeper than two levels does not render whole: read a narrower path" % what)
        if len(items) > _MAX_ITEMS:
            raise ProbeError("a %s of %d items (more than %d) does not render whole: read $count or a narrower path"
                             % (what, len(items), _MAX_ITEMS))
        return [_render(x, depth + 1) for x in items]
    return "<%s>" % (t.FullName if t is not None else type(v).__name__)


def _value(arg):
    if isinstance(arg, dict) and "enum" in arg:
        full = arg["enum"]
        tname, _, member = full.rpartition(".")
        t = _find_type(tname)
        if t is None or not t.IsEnum:
            raise ProbeError("no enum type '%s' loaded" % tname)
        return System.Enum.Parse(t, member)
    if isinstance(arg, dict) and "callback" in arg:
        raise ProbeError("a callback is an argument to a call, not a value to set")
    return arg


# ---- steps ----------------------------------------------------------------------------------------------------------

def _invoke(step):
    on = step.get("on")
    segs = _split(step["path"])
    owner_path, last = ".".join(segs[:-1]), segs[-1]
    owner = _eval(owner_path, on) if len(segs) > 1 else None
    if owner is None or (isinstance(owner, dict) and "raised" in owner):
        raise ProbeError("invoke %s: '%s' reads %r" % (step["path"], owner_path, owner))
    if isinstance(owner, System.Type):
        raise ProbeError("invoke on a static: type is not supported")
    if "set" in step:
        val = _value(step["set"])
        try:
            setattr(owner, last, val)
        except AttributeError:
            p = owner.GetType().GetProperty(last, vp.bf())
            if p is None:
                raise ProbeError("invoke %s: no member '%s' to set" % (step["path"], last))
            p.SetValue(owner, val, None)
        return
    args = step.get("args") or []
    if not any(isinstance(a, dict) and "callback" in a for a in args):
        _call_strict(owner, last, [_value(a) for a in args])
        return
    # A callback: the delegate type comes from the vendor method's own parameter.
    t = owner.GetType()
    ms = [m for s in [t] + list(t.GetInterfaces()) for m in s.GetMethods(vp.bf()) if m.Name == last and len(m.GetParameters()) == len(args)]
    if len(ms) != 1:
        raise ProbeError("invoke %s: %d methods '%s' of arity %d" % (step["path"], len(ms), last, len(args)))
    m = ms[0]
    real = []
    for a, p in zip(args, m.GetParameters()):
        if isinstance(a, dict) and "callback" in a:
            meth = a["callback"]
            real.append(clr.GetPythonType(p.ParameterType)(lambda x, meth=meth: getattr(x, meth)()))
        else:
            real.append(_value(a))
    m.Invoke(owner, System.Array[System.Object](real))


def _call_strict(owner, name, args):
    f = getattr(owner, name, None)
    if f is not None and callable(f):
        return f(*args)
    ok, out = vp.call(owner, name, args)
    if not ok:
        raise ProbeError("no method %s(%d args) on %s: %s" % (name, len(args), _type_name(owner), out))
    return out


def _same_path(a, b):
    return bool(a) and bool(b) and os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def _open(path):
    p = _P.primary
    if p is not None:
        p.close()
    _P.open(path)


def _step(step, req):
    op = step["op"]
    if op == "create":
        if step.get("via") != "script":
            raise ProbeError("a push create is the runner's, not the core's")
        _create(step)
    elif op == "find":
        _keep(step["as"], _find(step["name"], step.get("under")), "found")
    elif op == "setText":
        o = _resolve(step["on"])
        if step.get("decl") is not None:
            o.textual_declaration.replace(step["decl"])
        if step.get("impl") is not None:
            o.textual_implementation.replace(step["impl"])
        if step.get("appendImpl") is not None:
            o.textual_implementation.append(step["appendImpl"])
        if step.get("implFrom") is not None:
            o.textual_implementation.replace(_resolve(step["implFrom"]).textual_implementation.text)
    elif op == "tryNames":
        if step.get("via") != "script":
            raise ProbeError("tryNames is script-only")
        _try_names(step)
    elif op == "rename":
        _resolve(step["on"]).rename(step["to"])
    elif op == "move":
        _resolve(step["on"]).move(_resolve(step["to"]))
    elif op == "delete":
        _resolve(step["on"]).remove()
    elif op == "open":
        path = req.get("fixturePath")
        if not path:
            raise ProbeError("open: the runner sent no fixture copy")
        if _ROW["saved_base"]:
            # Cleanup reopens the run's own copy from disk, which now holds this row's objects: refused by name.
            raise ProbeError("open after a reload saved the run's own copy: the row must open a fresh copy before it reloads")
        _ROW["opened"] = True
        _open(path)
    elif op == "close":
        _ROW["opened"] = True
        _proj().close()
    elif op == "build":
        _app().build()
    elif op == "reload":
        path = _proj().path
        if _same_path(path, _BASE) and _ROW["opened"]:
            raise ProbeError("reload of the run's own copy after an open: open a fresh copy first")
        _proj().save()
        _ROW["reloaded"] = True
        _ROW["saved_base"] = _ROW["saved_base"] or _same_path(path, _BASE)
        _open(path)
    elif op == "invoke":
        _invoke(step)
    else:
        raise ProbeError("unknown step op '%s'" % op)


# ---- reads ----------------------------------------------------------------------------------------------------------

def _lmm():
    t = _find_type("_3S.CoDeSys.Core.SystemInstances")
    m = t.GetProperty("LanguageModelMgr").GetValue(None, None) if t is not None else None
    if m is None:
        raise ProbeError("LanguageModelMgr unavailable")
    return m


def _signature(o):
    m = _lmm()
    fs = [mi for s in [m.GetType()] + list(m.GetType().GetInterfaces()) for mi in s.GetMethods(vp.bf())
          if mi.Name == "FindSignature" and len(mi.GetParameters()) == 2]
    if not fs:
        raise ProbeError("LanguageModelMgr has no FindSignature(guid, x)")
    sig = fs[0].Invoke(m, System.Array[System.Object]([_guid(o), None]))
    if sig is None:
        return None
    return "%s/%s" % (vp.prop(sig, "POUType"), vp.prop(sig, "Flags"))


def _parse(text):
    m = _lmm()
    scanners = [mi for s in [m.GetType()] + list(m.GetType().GetInterfaces()) for mi in s.GetMethods(vp.bf()) if mi.Name == "CreateScanner"]
    parsers = [mi for s in [m.GetType()] + list(m.GetType().GetInterfaces()) for mi in s.GetMethods(vp.bf())
               if mi.Name == "CreateParser" and len(mi.GetParameters()) == 1]
    if not scanners or not parsers:
        raise ProbeError("LanguageModelMgr has no CreateScanner / CreateParser(scanner)")
    scanner = None
    for mi in scanners:
        args = []
        for p in mi.GetParameters():
            if p.ParameterType == clr.GetClrType(System.String):
                args.append(text)
            elif p.ParameterType == clr.GetClrType(System.Boolean):
                args.append(False)
            else:
                args.append(None)
        try:
            scanner = mi.Invoke(m, System.Array[System.Object](args))
            break
        except Exception:
            continue
    if scanner is None:
        raise ProbeError("no CreateScanner overload took the text")
    parser = parsers[0].Invoke(m, System.Array[System.Object]([scanner]))
    # The parser's type AND its interfaces: `ParseInterface()` is `IParser`'s (the deleted probe searched both).
    pi = [mi for s in [parser.GetType()] + list(parser.GetType().GetInterfaces()) for mi in s.GetMethods(vp.bf())
          if mi.Name == "ParseInterface" and len(mi.GetParameters()) == 0]
    if not pi:
        raise ProbeError("the parser has no ParseInterface()")
    try:
        r = pi[0].Invoke(parser, None)
    except Exception as e:
        return {"raised": _why(e)}
    if r is None:
        return None
    pt = vp.prop(r, "POUType")
    return None if pt is None else str(pt)


def _row_guids():
    out = set()
    for h in list(_H.keys()):
        try:
            o = _resolve(h)
        except ProbeError:
            continue
        out.add(str(_guid(o)))
        for d in vp.walk(o, 0, 20):
            try:
                out.add(str(_guid(d)))
            except ProbeError:
                pass
    return out


def _diagnostics(fields, mentioning):
    t = _find_type("_3S.CoDeSys.ScriptDriverSystem.APEnvironment")
    store = t.GetProperty("MessageStorage", _B.Public | _B.NonPublic | _B.Static).GetValue(None, None) if t is not None else None
    if store is None:
        raise ProbeError("MessageStorage unreachable")
    mine = _row_guids()
    out = []
    for cat in (vp.prop(store, "Categories") or []):
        ok, msgs = vp.call(store, "GetMessages", [cat])
        if not ok:
            raise ProbeError("GetMessages failed: %s" % msgs)
        for msg in (msgs or []):
            if vp.prop(msg, "Number") is None:
                continue
            g = vp.prop(msg, "ObjectGuid")
            text = str(vp.prop(msg, "Text"))
            if str(g) not in mine and not (mentioning and mentioning.lower() in text.lower()):
                continue
            d = {"code": "%s%04d" % (vp.prop(msg, "Prefix") or "", int(vp.prop(msg, "Number"))),
                 "severity": str(vp.prop(msg, "Severity")), "text": text}
            if "guid" in fields:
                d["guid"] = {"$guid": str(g)}
            if "position" in fields:
                d["position"] = {"position": _render(vp.prop(msg, "Position")), "offset": _render(vp.prop(msg, "PositionOffset")),
                                 "length": _render(vp.prop(msg, "Length"))}
            out.append(d)
    return out


def _process(what):
    if what == "exe":
        fvi = Process.GetCurrentProcess().MainModule.FileVersionInfo
        return {"exe": os.path.basename(Process.GetCurrentProcess().MainModule.FileName), "ProductName": fvi.ProductName,
                "ProductVersion": fvi.ProductVersion, "FileVersion": fvi.FileVersion, "CompanyName": fvi.CompanyName}
    if what == "assembly":
        t = _find_type("_3S.CoDeSys.Core.SystemInstances")
        if t is None:
            raise ProbeError("_3S.CoDeSys.Core.SystemInstances is not loaded")
        return {"assembly": t.Assembly.GetName().Name, "version": str(t.Assembly.GetName().Version)}
    if what == "culture":
        # Read on the UI thread the timer answers on: the thread the IDE's own messages are formatted on.
        return {"CurrentUICulture": System.Globalization.CultureInfo.CurrentUICulture.Name}
    raise ProbeError("CODESYS has no '%s' process read" % what)


def _read(r):
    op, on = r["op"], r.get("on")
    if op == "member":
        v = _eval(r["path"], on)
        if r["key"] not in _CACHE:
            _CACHE[r["key"]] = v
        return _render(v)
    if op == "class":
        o = _eval(r.get("path") or "object", on)
        return None if o is None else _type_name(o)
    if op == "guid":
        return {"$guid": str(_guid(_resolve(on)))}
    if op == "parent":
        p = _resolve(on).parent
        return None if p is None else p.get_name()
    if op == "children":
        return [c.get_name() for c in _resolve(on).get_children()]
    if op == "signature":
        return _signature(_resolve(on))
    if op == "parse":
        text = r.get("text")
        if text is None:
            text = _resolve(on).textual_declaration.text
        return _parse(text)
    if op == "same":
        if r["as"] not in _CACHE:
            raise ProbeError("same: no earlier member read '%s' in this row" % r["as"])
        return System.Object.ReferenceEquals(_eval(r["path"], on), _CACHE[r["as"]])
    if op == "diagnostics":
        return _diagnostics(r.get("fields") or [], r.get("mentioning"))
    if op == "process":
        return _process(r["what"])
    if op == "tried":
        return _tried(r["what"])
    raise ProbeError("CODESYS has no read '%s'" % op)


def _path(on):
    o = _resolve(on)
    names = []
    while o is not None and not hasattr(o, "active_application"):
        names.append(o.get_name())
        o = o.parent
    names.reverse()
    return names


def _cleanup():
    if _ROW["opened"]:
        _open(_BASE)
    else:
        for h in reversed(_ORDER):
            if _H[h]["created"] != "script":
                continue
            try:
                o = _resolve(h)
            except ProbeError:
                continue                         # deleted by the row itself, or inside one already removed
            o.remove()
        if _ROW["reloaded"]:
            _proj().save()
    _begin()


# ---- the request loop -----------------------------------------------------------------------------------------------

def _handle(req):
    kind = req["kind"]
    if kind == "begin":
        _begin()
        return {}
    if kind == "step":
        step = req["step"]
        before = _H.get(step.get("as")) if step.get("as") else None
        try:
            _step(step, req)
        except ProbeError:
            raise
        except Exception as e:
            # A create that raised AFTER the object was made (its declaration write threw): the object is there, and the
            # runner keeps the subject so reads reach it.
            made = step["op"] == "create" and _H.get(step.get("as")) is not None and _H.get(step.get("as")) is not before
            return {"outcome": "refused: " + _why(e), "made": made}
        return {"outcome": "accepted"}
    if kind == "read":
        return {"value": _read(req["read"])}
    if kind == "path":
        return {"value": _path(req["on"])}
    if kind == "adopt":
        _keep(req["as"], _find(req["name"], None), "adopted")
        return {}
    if kind == "cleanup":
        _cleanup()
        return {}
    raise ProbeError("unknown request '%s'" % kind)


_REQ = os.path.join(_DIR, "request")
_BUSY = [False]


def _ascii(s, quote=True):
    """`s` in printable ASCII: every other character as a \\uXXXX escape. With `quote`, a JSON string body (quotes and
    backslashes escaped too); without, plain text that keeps its line breaks (an error file)."""
    out = []
    for ch in s:
        o = ord(ch)
        if quote and ch == '"':
            out.append('\\"')
        elif quote and ch == "\\":
            out.append("\\\\")
        elif not quote and ch in "\r\n\t":
            out.append(ch)
        elif o < 0x20 or o > 0x7e:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return "".join(out)


def _dumps(v):
    """JSON in ASCII. Not `json.dumps`: IronPython 2.7's encoder decodes every `str` as UTF-8 bytes, and a name with a
    character past ASCII (C28's `Fööbar`) is a str of UTF-16 code units there - it raises UnicodeDecodeError."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, long)):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, basestring):
        return '"' + _ascii(v) + '"'
    if isinstance(v, dict):
        return "{" + ",".join('"%s":%s' % (_ascii(unicode(k)), _dumps(x)) for k, x in v.items()) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(_dumps(x) for x in v) + "]"
    raise ProbeError("a %s does not render as JSON" % type(v).__name__)


def _write(path, text):
    """Written whole, then renamed into place: the runner polls for the name and must never read a half-written file."""
    with open(path + ".tmp", "w") as f:
        f.write(text)
    os.rename(path + ".tmp", path)


def _tick(sender, args):
    if _BUSY[0] or not os.path.exists(_REQ):
        return
    _BUSY[0] = True
    seq = None
    try:
        with open(_REQ) as f:
            req = json.loads(f.read())
        os.remove(_REQ)
        seq = str(req["seq"])
        _log("vendor-facts %s %s %s" % (seq, req.get("kind"), _dumps(req.get("step") or req.get("read") or "")[:160]))
        answer = _handle(req)
        _write(os.path.join(_DIR, seq + ".out"), _dumps(answer))
        open(os.path.join(_DIR, seq + ".done"), "w").close()
    except Exception as e:
        if seq is not None:
            _write(os.path.join(_DIR, seq + ".error"),
                   _ascii("%s\n%s" % (e if isinstance(e, ProbeError) else _why(e), traceback.format_exc()), False))
    finally:
        _BUSY[0] = False


_timer = Timer()
_timer.Interval = 100
_timer.Tick += _tick
_timer.Start()
# Pinned outside this script's scope: the script engine may drop its globals once the runscript returns, and a
# collected Timer stops ticking without a word.
System.AppDomain.CurrentDomain.SetData("volt.vendor-facts.timer", _timer)
with open(os.path.join(_DIR, "ready"), "w") as _f:
    _f.write(str(Process.GetCurrentProcess().Id))
_log("vendor-facts core watching %s" % _DIR)
