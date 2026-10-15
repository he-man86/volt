# -*- coding: utf-8 -*-
# RECORD WHAT THE NWL COMPLETENESS ORACLE CANNOT TAKE FROM ITS DOUBLES (openspec ld-fbd-coverage gate 1b-3), into
# test/fixtures/nwl-corpus/live.codesys.xml, read by test/Volt.Ide.Codesys.Tests/CodesysNwlCompletenessOracleTests.cs:
#
#   <fresh>   every NWL object the SHIPPED writer constructs, made as it makes it - the bridge's own NwlInterop.New over
#             a live NWL object, `Operand` with its text argument - and its whole archive as GetSerializableValue
#             answers it (the format of record-nwl-corpus.py). The oracle's doubles stand for these fresh objects:
#             a member the writer never sets is judged against THIS, not against a double's initial value.
#   <reader>  every network of the project's LD/FBD bodies that holds a stored symbol comment, read by the SHIPPED
#             reader (Volt.Ide.Codesys.dll, CodesysNetworkReader.ReadNetwork, through the bridge's own NwlInterop
#             reflection over the real _3S.CoDeSys.NWLObject objects) - the comments it read, and what the shipped
#             rebuild refusal (NetworkText.RefuseSymbolCommentLoss) answers for that model.
#
# Run in a CODESYS that ide.ps1 launched (its own instance; the project is opened as a COPY). ide.ps1 builds the
# bridge first and hands its DLL in VOLT_BRIDGE_DLL - the DLL the reader is loaded from:
#
#   $env:VOLT_PROBE_PROJECTS = "pro2193=<repo>\packages\volt-cli\test\fixtures\Pro2193-94-95-96_COdesys.project"
#   $env:VOLT_NWL_CORPUS_OUT = "<repo>\packages\volt-cli\test\fixtures\nwl-corpus"
#   $env:VOLT_PROBE_LOG      = "<scratch>\record-nwl-live.log"
#   powershell -File packages/volt-cli/scripts/ide.ps1 up -Vendor codesys -Instance <yours> -RunScript <this file>
#   (wait for "done" in the log, with a timeout) ; powershell -File ... ide.ps1 down -Vendor codesys -Instance <yours>
#
# ASCII only (IronPython 2.7); every non-ASCII or control character is written as a character reference.
from __future__ import print_function
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
import clr
import System
from System.Reflection import BindingFlags, Assembly, TargetInvocationException

log, done = vp.logger("record-nwl-live.log")
STATIC = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static



def esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch == "&":
            out.append("&amp;")
        elif ch == "<":
            out.append("&lt;")
        elif ch == ">":
            out.append("&gt;")
        elif ch == '"':
            out.append("&quot;")
        elif o < 0x20 or o > 0x7e:
            out.append("&#x%X;" % o)
        else:
            out.append(ch)
    return "".join(out)


def sget(o, n):
    ok, v = vp.call(o, "GetSerializableValue", [n])
    if not ok:
        raise Exception("GetSerializableValue(%s) on %s raised: %s" % (n, o.GetType().Name, v))
    return v


def scalar(v):
    if v is None:
        return "null"
    t = v.GetType()
    if t == clr.GetClrType(System.Boolean):
        return "b:" + ("true" if v else "false")
    if t == clr.GetClrType(System.String):
        return "s:" + unicode(v)
    if t == clr.GetClrType(System.Int32):
        return "i:" + str(v)
    if t == clr.GetClrType(System.Int64):
        return "l:" + str(v)
    if t.IsEnum:
        return "e:" + str(v)
    if t.IsPrimitive or t == clr.GetClrType(System.Guid):
        raise Exception("a scalar of type %s has no form in the file (%r)" % (t.FullName, v))
    return None


def is_list(v):
    return isinstance(v, System.Collections.IEnumerable) and not isinstance(v, System.Collections.IDictionary) \
        and v.GetType() != clr.GetClrType(System.String)


def node(o, member, w, depth=0):
    """The record-nwl-corpus.py archive form, without its API comparison (a fresh object has nothing to compare)."""
    if depth > 50:
        raise Exception("deeper than 50")
    cls = o.GetType().Name
    names = [str(n) for n in vp.prop(o, "SerializableValueNames")]
    attrs, kids = [], []
    for n in names:
        v = sget(o, n)
        s = scalar(v)
        if s is not None:
            attrs.append((n, s))
        elif is_list(v):
            kids.append(("l", n, v))
        else:
            kids.append(("o", n, v))
    head = '<o t="%s"' % esc(cls) + ("" if member is None else ' m="%s"' % esc(member))
    head += "".join(' %s="%s"' % (esc(n), esc(s)) for n, s in attrs)
    if not kids:
        w(head + "/>")
        return
    w(head + ">")
    for kind, n, v in kids:
        if kind == "o":
            node(v, n, w, depth + 1)
        else:
            w('<l m="%s">' % esc(n))
            for x in list(v):
                s = scalar(x)
                if x is None:
                    w("<null/>")
                elif s is not None:
                    w('<x v="%s"/>' % esc(s))
                else:
                    node(x, None, w, depth + 1)
            w("</l>")
    w("</o>")


def invoke(t, name, args):
    m = t.GetMethod(name, STATIC)
    if m is None:
        raise Exception("%s has no method %s" % (t.FullName, name))
    try:
        return True, m.Invoke(None, System.Array[System.Object](args))
    except TargetInvocationException as e:
        return False, e.InnerException


def bodies_of(proj):
    handle = None
    for c in proj.get_children():
        handle = vp.prop(vp.unwrap(c), "handle")
        if handle is not None:
            break
    om = vp.object_manager()
    ok, guids = vp.call(om, "GetAllObjects", [handle])
    if not ok:
        raise Exception("GetAllObjects: %s" % guids)
    names, parents, metas = {}, {}, []
    for g in guids:
        ok, meta = vp.call(om, "GetObjectToRead", [handle, g])
        if not ok or meta is None:
            raise Exception("unreadable object %s: %s" % (g, meta))
        names[str(g)] = vp.prop(meta, "Name")
        parents[str(g)] = str(vp.prop(meta, "ParentObjectGuid"))
        metas.append((str(g), meta))
    out = []
    for g, meta in metas:
        obj = vp.prop(meta, "Object")
        if obj is None or not vp.prop(obj, "SerializableValueNames"):
            continue
        if "Implementation" not in [str(n) for n in vp.prop(obj, "SerializableValueNames")]:
            continue
        impl = sget(obj, "Implementation")
        if impl is None or impl.GetType().Name != "NWLImplementationObject":
            continue
        path, p = [], g
        while p in names:
            path.insert(0, names[p])
            p = parents.get(p)
        out.append(("/".join(path), impl))
    out.sort(key=lambda b: b[0])
    return out


def operands(o):
    """Every Operand under an archive node, by walking its archive."""
    if o is None or scalar(o) is not None:
        return
    if is_list(o):
        for x in list(o):
            for y in operands(x):
                yield y
        return
    if o.GetType().Name == "Operand":
        yield o
    names = vp.prop(o, "SerializableValueNames")
    if names is None:
        return
    for n in names:
        for y in operands(sget(o, str(n))):
            yield y


try:
    out_dir = os.environ["VOLT_NWL_CORPUS_OUT"]
    dll = os.environ["VOLT_BRIDGE_DLL"]
    bridge = Assembly.LoadFrom(dll)
    log("bridge: %s (%s)" % (dll, bridge.FullName))
    nwl_interop = bridge.GetType("Volt.Ide.Codesys.NwlInterop", True)
    reader = bridge.GetType("Volt.Ide.Codesys.CodesysNetworkReader", True)
    network_text = None   # Volt.Engine's: the bundle carries it inside, so it is found through the first model read

    lines = []
    w = lines.append
    specs = [s for s in os.environ["VOLT_PROBE_PROJECTS"].split(";") if s.strip()]
    if len(specs) != 1:
        raise Exception("one project, the corpus whose networks hold the symbol comments (pro2193)")
    name, src = [x.strip() for x in specs[0].split("=", 1)]
    proj = vp.open_copy(projects, src, "nwl-live-" + name)
    log("opened %s (copy of %s)" % (name, src))
    bodies = bodies_of(proj)
    if not bodies:
        raise Exception("%s holds no LD/FBD body" % name)

    # ---- the fresh objects, made by the shipped NwlInterop.New over a live NWL object -------------------------------
    sample = bodies[0][1]
    w("<fresh>")
    for cls, args in [("Network", []), ("BoxTreeOperand", [None]), ("BoxTreeAssign", []), ("BoxTreeBox", []),
                      ("BoxTreeDemux", []), ("BoxTreeTerminator", []), ("BoxTreeParallel", []), ("STSnippet", []),
                      ("Operand", ["x"])]:
        if cls == "BoxTreeOperand":
            ok, op = invoke(nwl_interop, "New", [sample, "Operand", System.Array[System.Object](["x"])])
            if not ok:
                raise Exception("New(Operand): %s" % op)
            args = [op]
        ok, o = invoke(nwl_interop, "New", [sample, cls, System.Array[System.Object](args)])
        if not ok:
            raise Exception("New(%s): %s" % (cls, o))
        node(o, None, w)
    w("</fresh>")

    # ---- the shipped reader over every network holding a stored symbol comment -------------------------------------
    w('<reader corpus="%s" bridge="%s">' % (esc(name), esc(bridge.GetName().Version.ToString())))
    witnessed = 0
    for path, impl in bodies:
        nets = list(sget(impl, "NetworkList"))
        for i, net in enumerate(nets):
            stored = [unicode(sget(o, "SymbolComment") or "") for o in operands(net)]
            stored = [c for c in stored if c.strip() and not (c.startswith("Constant_") and c.endswith("_Serialization_Value"))]
            if not stored:
                continue
            ok, model = invoke(reader, "ReadNetwork", [net, i])
            if not ok:
                w('<network path="%s" index="%d" stored="%d" read-refused="%s"/>' % (esc(path), i, len(stored), esc(unicode(model.Message))))
                continue
            if network_text is None:
                network_text = model.GetType().Assembly.GetType("Volt.Engine.Format.Network.NetworkText", True)
                operands_of = network_text.GetMethod("OperandsOf", STATIC)
            read = []
            for tree in list(vp.prop(model, "Trees")):
                for op in list(operands_of.Invoke(None, System.Array[System.Object]([tree]))):
                    c = vp.prop(op, "Comment")
                    if c:
                        read.append((unicode(vp.prop(op, "Text")), unicode(c)))
            ok, err = invoke(network_text, "RefuseSymbolCommentLoss", ["CODESYS", model])
            refusal = "none" if ok else unicode(err.Message)
            w('<network path="%s" index="%d" stored="%d" read="%d" refusal="%s">' % (esc(path), i, len(stored), len(read), esc(refusal)))
            for text, c in read:
                w('<comment operand="%s" text="%s"/>' % (esc(text), esc(c)))
            w("</network>")
            witnessed += 1
    w("</reader>")
    proj.close()

    target = os.path.join(out_dir, "live.codesys.xml")
    f = open(target + ".tmp", "w")
    f.write('<?xml version="1.0" encoding="us-ascii"?>\n<nwl-live ide="CODESYS %s">\n' % esc(os.environ.get("VOLT_CODESYS_VERSION", "3.5.21.40"))
            + "\n".join(lines) + "\n</nwl-live>\n")
    f.close()
    if os.path.exists(target):
        os.remove(target)
    os.rename(target + ".tmp", target)
    log("%s: %d networks with a stored symbol comment read by the shipped reader -> %s" % (name, witnessed, target))
    log("done")
    done()
except Exception:
    done(True)
