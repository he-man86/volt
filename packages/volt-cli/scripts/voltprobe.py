# -*- coding: utf-8 -*-
# The half of every CODESYS probe that is not the question it asks.
#
# A probe is a one-file tool aimed at ONE vendor fact, and the answer it produces is evidence a source comment
# or a DIALECT row then cites. What surrounds that question was copied from probe to probe: the same
# BindingFlags, the same `BaseObject` unwrap, the same reflection property read (IronPython denies a non-public
# property that the same object's own reflection listing shows), the same log-open/flush/exit dance. Twelve
# copies of the reflection helpers and seventeen of the exit boilerplate, drifting independently - and a probe
# whose helper is subtly wrong does not fail, it reports something untrue, which is the one thing a probe must
# never do.
#
# Imported by adding this directory to sys.path, which a probe run through `--runscript` must do itself:
#
#     import os, sys
#     sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
#     import voltprobe as vp
#
#     log, done = vp.logger("my-probe.log")
#     try:
#         proj = vp.open_copy(src, "my-probe")
#         ...
#     finally:
#         done()
#
# ASCII ONLY - CODESYS compiles this as IronPython 2.7. No f-strings, no `nonlocal`.
#
# AN IMPORTED MODULE IS STRICTER THAN THE RUNSCRIPT ITSELF, which is not obvious and cost a debugging round:
# `start_volt_codesys.py` carries 8 non-ASCII characters and runs fine as the `--runscript` target, but the
# same character HERE is a hard `SyntaxError: Non-ASCII character (a 0xE2 lead byte) ... but no encoding declared` (PEP
# 263) that fails the import - and therefore every probe in this directory at once, before any of them can
# even open its log. Hence the declaration below as well as the rule above: the rule is the intent, the
# declaration is what stops one stray em-dash from breaking the whole toolkit.
import os
import shutil
import tempfile
import traceback

_BF = None


def bf():
    """Public | NonPublic | Instance | FlattenHierarchy - the flags every vendor read needs."""
    global _BF
    if _BF is None:
        from System.Reflection import BindingFlags as B
        _BF = B.Public | B.NonPublic | B.Instance | B.FlattenHierarchy
    return _BF


def unwrap(o):
    """Follow `BaseObject` down to the underlying vendor object. Scripting hands out wrappers; the object model
    lives below them, and `guid`/`handle` are only there."""
    for _ in range(10):
        if o is None:
            return None
        try:
            bp = o.GetType().GetProperty("BaseObject", bf())
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
    """Read a property by name, through REFLECTION first.

    Attribute access is not enough and the difference is not cosmetic: IronPython answers
    "'ScriptPouObjectList' object has no attribute 'PouObjectList'" for a non-public property that the same
    object's own reflection listing prints one line earlier. A probe that only tried `getattr` there concluded
    the field did not exist."""
    if o is None:
        return None
    try:
        t = o.GetType()
    except Exception:
        return None
    try:
        p = t.GetProperty(name, bf())
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
    """Invoke a method by name and arity, on the type OR any interface it implements (explicit
    implementations live only on the interface). Returns (ok, result); when `ok` is False the second value is
    the REASON, which a probe must be able to tell apart from a method that legitimately returned None.

    THIS IS THE UNION OF FOUR DRIFTED COPIES, and the drift was not cosmetic. Twelve probes carried this
    helper and it had forked into four versions - one of which searched `GetMethods()` with NO BindingFlags,
    so it could only see PUBLIC methods. In a toolkit whose entire job is reading non-public vendor surfaces,
    that version answers "no such method" for a method that is right there, and a probe does not fail on a
    wrong helper: it reports something untrue. The superset wins on both axes - `bf()` so non-public methods
    are found, and the reason string so a failure says which kind it was."""
    import System
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods(bf()):
            if m.Name != name or len(m.GetParameters()) != len(args):
                continue
            try:
                return True, m.Invoke(o, System.Array[System.Object](list(args)))
            except Exception:
                return False, traceback.format_exc().strip().split(chr(10))[-1]
    return False, "no method " + name


def dump(o, log, indent="      "):
    """Every readable property of an object, plus its method names - the discovery pass that precedes every
    census. A field a probe does not know to ask for cannot hide from this."""
    if o is None:
        log(indent + "<null>")
        return
    try:
        t = o.GetType()
    except Exception:
        log(indent + "<no type>")
        return
    log(indent + "type: " + t.FullName)
    seen = set()
    for src in [t] + list(t.GetInterfaces()):
        for p in src.GetProperties(bf()):
            if p.GetIndexParameters().Length != 0 or not p.CanRead or p.Name in seen:
                continue
            seen.add(p.Name)
            try:
                v = p.GetValue(o, None)
            except Exception as e:
                log(indent + "  %-28s <raised %s>" % (p.Name, str(e)[:40]))
                continue
            log(indent + "  %-28s %s%s" % (p.Name, repr(v)[:90], "" if p.CanWrite else "   (read-only)"))
    ms = sorted(set(m.Name for src in [t] + list(t.GetInterfaces()) for m in src.GetMethods(bf())
                    if not m.Name.startswith("get_") and not m.Name.startswith("set_")))
    log(indent + "  methods: " + ", ".join(ms)[:400])


def object_manager():
    """The vendor's `ObjectMgr` static, or None. It is the door to an object's aspects (the implementation
    aspect, the network list) that the scripting tree does not expose."""
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("ObjectMgr")
        if p is None:
            continue
        mgr = p.GetValue(None, None)
        if mgr is not None:
            return mgr
    return None


def open_copy(projects_api, src, tag):
    """Open a COPY of the project, never the engineer's own file - a scripting open can dirty it, and a probe
    that leaves a project modified has changed the thing it was measuring.

    `projects_api` is the `projects` global CODESYS injects into a runscript; it cannot be imported."""
    dst = os.path.join(tempfile.gettempdir(), "volt-%s.project" % tag)
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copyfile(src, dst)
    return projects_api.open(dst)


def walk(node, depth=0, limit=14):
    """Every descendant of a scripting node, depth-first. `get_children` throws on nodes that have none, which
    is not an error and must not end the walk."""
    if depth > limit:
        return
    try:
        kids = list(node.get_children())
    except Exception:
        return
    for k in kids:
        yield k
        for x in walk(k, depth + 1, limit):
            yield x


def logger(default_name):
    """Open the probe's log and return (log, done).

    `done()` closes the file and EXITS THE PROCESS. Without that exit a `--runscript` CODESYS stays open with
    the project loaded, so the next probe in a batch finds the IDE busy and the caller waits on a pipe that
    will never come. Call it from a `finally`, and let it report the traceback: a probe that dies silently
    leaves a log that reads like a measurement of nothing."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.environ.get("VOLT_PROBE_LOG") or os.path.join(here, default_name)
    f = open(path, "w")

    def log(s):
        f.write(str(s) + "\n")
        f.flush()

    def done(error=False):
        if error:
            log(traceback.format_exc())
        f.close()
        try:
            import System
            System.Environment.Exit(0)
        except Exception:
            pass

    return log, done


def projects_from_env():
    """The `VOLT_PROBE_PROJECTS` list (semicolon-separated), or the single `VOLT_PROBE_PROJECT`."""
    many = os.environ.get("VOLT_PROBE_PROJECTS") or ""
    if many.strip():
        return [s.strip() for s in many.split(";") if s.strip()]
    one = (os.environ.get("VOLT_PROBE_PROJECT") or "").strip()
    return [one] if one else []


def build_messages(app, system_api, severity):
    """Build `app` and return every error and warning the build left, as "[Severity] text" lines.

    `system_api` and `severity` are the `system` and `Severity` globals CODESYS injects into a runscript; like
    `projects`, they cannot be imported here. Every category is read, not only the compiler's, because a refusal
    can come from the object tree (a label, a POU name) before the compiler ever sees the code."""
    app.build()
    out = []
    for cat in system_api.get_message_categories(True):
        for sev in (severity.FatalError, severity.Error, severity.Warning):
            for m in system_api.get_message_objects(cat, sev):
                out.append("[%s] %s" % (sev, getattr(m, "text", m)))
    return out


def nwl_new(sample, type_name, *args):
    """A fresh NWL object (`Network`, `BoxTreeAssign`, `Operand`, ...) from the assembly `sample` lives in - the
    same lookup the C# writer's `NwlInterop.New` does, so a probe builds exactly what the driver would."""
    import System
    for t in sample.GetType().Assembly.GetTypes():
        if t.Name == type_name and t.IsClass and not t.IsAbstract:
            return System.Activator.CreateInstance(t, System.Array[System.Object](list(args)))
    raise Exception("no NWL type " + type_name)


def nwl_set(o, name, value):
    """Set a (possibly non-public) property by reflection - IronPython refuses some the listing shows."""
    for src in [o.GetType()] + list(o.GetType().GetInterfaces()):
        p = src.GetProperty(name, bf()) if src is o.GetType() else src.GetProperty(name)
        if p is not None and p.CanWrite:
            p.SetValue(o, value, None)
            return
    raise Exception("no writable %s on %s" % (name, o.GetType().Name))


def nwl_edit(objmgr, pou, fn):
    """Open `pou`'s graphical implementation for writing, hand it to `fn`, and commit - the object-manager round
    trip the scripting API has no door for. `fn(impl)` builds networks with `nwl_new`."""
    u = unwrap(pou)
    meta = objmgr.GetObjectToModify(prop(u, "handle") or 0, prop(u, "guid"))
    try:
        fn(prop(prop(meta, "Object"), "Implementation"))
    finally:
        objmgr.SetObject(meta, True, None)


def nwl_read(objmgr, pou):
    """The committed NetworkList of `pou`, read fresh through the object manager."""
    u = unwrap(pou)
    meta = objmgr.GetObjectToRead(prop(u, "handle") or 0, prop(u, "guid"))
    return prop(prop(prop(meta, "Object"), "Implementation"), "NetworkList")
