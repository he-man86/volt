# -*- coding: utf-8 -*-
# RECORD THE NWL CORPUS (openspec ld-fbd-coverage 1b.3): every LD/FBD body of each CODESYS corpus project, its WHOLE
# archive (SerializableValueNames / GetSerializableValue, recursively), as test/fixtures/nwl-corpus/<corpus>.nwl.xml -
# the input of the completeness oracle (test/Volt.Ide.Codesys.Tests/CodesysNwlCompletenessOracleTests.cs). The
# TwinCAT half needs no recording: its corpus archives ARE the committed .TcPOU files of TwinCAT Project14.
#
# Run in a CODESYS that ide.ps1 launched (its own instance, a fixture copy; the projects below are opened as COPIES):
#
#   $env:VOLT_PROBE_PROJECTS = "lenze-mid=C:\...\Lenze_MID-S100_V5_00_602_T51_Codesys.project;pro2193=...;..."
#   $env:VOLT_NWL_CORPUS_OUT = "<repo>\packages\volt-cli\test\fixtures\nwl-corpus"
#   $env:VOLT_PROBE_LOG      = "<scratch>\record-nwl-corpus.log"
#   pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys -Instance <yours> -NoBuild -RunScript <this file>
#   (wait for "done" in the log, with a timeout) ; pwsh ... ide.ps1 down -Vendor codesys -Instance <yours>
#
# The corpus projects are the ones `volt-lsp-iec/scripts/refresh-corpus.ts` names (the VARIANT files: pro2193 <-
# Pro2193-94-95-96_COdesys.project, lenze-mid <- Lenze_MID-S100_V5_00_602_T51_Codesys.project, awa-palletizer <-
# AWA_Palletizer 09_1.project; bakon-nano <- Bakon Nano new VISU v00_90.project; CodesysTestProject <-
# test/fixtures/CodesysTestProject.3.5.21.40.project). The body count each file holds is the check: it must match the
# corpus's %LANGUAGE LD|FBD bodies (census 1b.1: 40 / 2 / 1 / 1 / 0).
#
# THE FILE FORMAT (read by test/shared/NwlArchive.cs):
#   <nwl-corpus corpus=… source=… ide=… bodies=…>
#     <body guid=… path="<object names from the application down>" owner="<the object's class>">
#       <o t="NWLImplementationObject"> …                     a node: t = its class (the CLR type's short name)
#   A node's SCALAR members are its attributes, typed by prefix: s:<string>  b:true|false  i:<Int32>  l:<Int64>
#   e:<enum member>; a null member is the bare value `null`. A NODE member is a child <o m="<member>" t=…>, a LIST
#   member a child <l m="<member>"> holding <o …/> nodes, <null/> and scalars <x v="<typed>"/>.
#   Members named `api.<X>` are NOT archive members: they are what the live object answers through its API where the
#   archive has no member the reader could use - `api.MainOutputIndex` on a box (DIALECT N16), and on an Execute box's
#   snippet document `api.Text` plus <l m="api.Lines"> of <o t="Line" Id= Tag=/> (GetLineId / GetLineTag; the archive
#   holds the text only as the editor caches LineInfoPersistence / TextBlobForSerialisation, null as read).
#   <api-mismatch …/> lines record where an API member the reader uses did NOT answer what its archive member holds
#   (with the property the product's type-first lookup found, and what the INTERFACE property answers); <api-answers
#   … count=…/> counts the same where the archive holds no value (empty, null or the archive sentinel), one line per
#   shape. The oracle hydrates its doubles from the archive and the API from these lines, so every answer the reader
#   gets is a recorded one.
#
# ASCII only (IronPython 2.7); every non-ASCII or control character is written as a character reference.
from __future__ import print_function
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
import clr
import System

log, done = vp.logger("record-nwl-corpus.log")


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


def has(o, name):
    t = o.GetType()
    if t.GetProperty(name, vp.bf()) is not None:
        return True
    return any(i.GetProperty(name) is not None for i in t.GetInterfaces())


def snames(o):
    if not has(o, "SerializableValueNames"):
        return None
    return [str(n) for n in vp.prop(o, "SerializableValueNames")]


def sget(o, n):
    ok, v = vp.call(o, "GetSerializableValue", [n])
    if not ok:
        raise Exception("GetSerializableValue(%s) on %s raised: %s" % (n, o.GetType().Name, v))
    return v


def scalar(v):
    """The typed text of a scalar, or None when `v` is not one."""
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


# What the reader asks the live object, against the archive member it stands for (CodesysNetworkReader /
# CodesysNetworkWriter; the oracle maps one onto the other). Compared on every node, every corpus.
API = {
    "Network": [("Title", "Title"), ("Label", "Label"), ("Comment", "Comment"), ("OutCommented", "OutCommented")],
    "Operand": [("Operand", "OperandExpr"), ("Type", "Type"), ("SymbolComment", "SymbolComment"),
                ("LValue", "IsLValue"), ("IsInstance", "IsInstance"), ("Address", "Address")],
    "BoxTreeBox": [("BoxType", "BoxType"), ("EN", "En"), ("ENO", "Eno"), ("CallType", "CallType"),
                   ("ProvidesSTSnippet", "ProvidesSTSnippet")],
    "BoxTreeDemux": [("VarId", "VarId")],
    "BoxTreeParallel": [("Mode", "Mode")],
}
# List members: the archive list against the API list the reader enumerates (compared by count and by item class).
API_LISTS = {
    "BoxTreeBox": [("InputItems", "InputItemList")],
    "Network": [("NetworkItems", None)],   # the API hands trees out by index: NetworkItemCount / GetTree(i)
}

mismatches = []
# Mismatches of one shape - (class, member, api, what the archive holds: empty / sentinel / a value, what the API
# answered) - counted rather than listed when the archive holds no value: SP21 answers the archive SENTINEL through
# `Operand.SymbolComment` / `.Address` on every operand (first recording 2026-10-15), ten thousand identical lines.
counted = {}


def text_of(v):
    return "null" if v is None else unicode(v)


def sentinel(s):
    return s.startswith("Constant_") and s.endswith("_Serialization_Value")


def by_interface(o, name):
    """What the vendor's INTERFACE property answers - the public contract - beside what the type-first lookup the
    product's NwlInterop.Get uses answers (a concrete type may declare a non-public property of the same name)."""
    for i in o.GetType().GetInterfaces():
        p = i.GetProperty(name)
        if p is not None:
            return "%s: %s" % (i.FullName, text_of(p.GetValue(o, None)))
    return "(no interface declares it)"


def declared_by(o, name):
    p = o.GetType().GetProperty(name, vp.bf())
    if p is None:
        return "(interface only)"
    g = p.GetGetMethod(True)
    return "%s (%s)" % (p.DeclaringType.FullName, "public" if g is not None and g.IsPublic else "non-public")


def check_api(o, cls, path):
    for arch, api in API.get(cls, []):
        a = sget(o, arch)
        b = vp.prop(o, api)
        if text_of(a) == text_of(b):
            continue
        held = "empty" if a is None or text_of(a) == "" else ("sentinel" if sentinel(text_of(a)) else None)
        if held is not None:
            k = (cls, arch, api, held, text_of(b))
            counted[k] = counted.get(k, 0) + 1
        else:
            mismatches.append((path, cls, arch, api, text_of(a), text_of(b),
                               declared_by(o, api), by_interface(o, api)))
    if cls == "Network":
        items = list(sget(o, "NetworkItems"))
        count = vp.prop(o, "NetworkItemCount")
        trees = []
        for i in range(int(count or 0)):
            ok, t = vp.call(o, "GetTree", [i])
            trees.append(t if ok else None)
        same = len(items) == len([t for t in trees if t is not None]) and all(
            x is not None and y is not None and x.GetType().Name == y.GetType().Name for x, y in zip(items, trees))
        if not same:
            mismatches.append((path, cls, "NetworkItems", "GetTree", "%d items" % len(items), "%r trees" % count, "", ""))
    if cls == "BoxTreeBox":
        items = list(sget(o, "InputItems"))
        api = list(vp.prop(o, "InputItemList") or [])
        if len(items) != len(api):
            mismatches.append((path, cls, "InputItems", "InputItemList", "%d" % len(items), "%d" % len(api), "", ""))
        outs = sget(o, "OutputItems")
        arch_outs = list(sget(outs, "OutputItems")) if outs is not None else None
        api_outs = vp.prop(vp.prop(o, "Outputs"), "List")
        api_outs = list(api_outs) if api_outs is not None else None
        if (arch_outs is None) != (api_outs is None) or (arch_outs is not None and len(arch_outs) != len(api_outs)):
            mismatches.append((path, cls, "OutputItems", "Outputs.List", text_of(arch_outs and len(arch_outs)),
                               text_of(api_outs and len(api_outs)), "", ""))
        for arch, api in (("InputParam", "InputParams"), ("OutputParam", "OutputParams")):
            pa = sget(o, arch)
            pb = vp.prop(o, api)
            for m in ("Names", "Types"):
                xa = list(sget(pa, m)) if pa is not None else None
                xb = list(vp.prop(pb, m) or []) if pb is not None else None
                if (xa is None) != (xb is None) or (xa is not None and [unicode(x) for x in xa] != [unicode(x) for x in xb]):
                    mismatches.append((path, cls, arch + "." + m, api + "." + m, text_of(xa), text_of(xb), "", ""))
        # The pin flags: the archive's `InputFlags` against the list the reader enumerates (CodesysNetworkReader
        # .PinFlags). A null archive answered as a list of unset flags, one per input, is counted; anything else listed.
        fa = sget(o, "InputFlags")
        fb = vp.prop(o, "InputFlags")
        fb = list(fb) if fb is not None else None
        bits = lambda f: None if f is None else sum(
            b for n, b in (("Negation", 1), ("Set", 2), ("Jump", 4), ("Return", 8), ("Rtrig", 16), ("Ftrig", 32))
            if vp.prop(f, n))
        if fa is None and fb is not None and len(fb) == len(items) and all(
                f is not None and not any(vp.prop(f, n) for n in ("Negation", "Set", "Jump", "Return", "Rtrig", "Ftrig"))
                for f in fb):
            k = (cls, "InputFlags", "InputFlags", "null", "a list of unset flags, one per input")
            counted[k] = counted.get(k, 0) + 1
        elif fa is not None and fb is not None and [bits(f) for f in fa] == [bits(f) for f in fb]:
            pass
        elif not (fa is None and fb is None):
            mismatches.append((path, cls, "InputFlags", "InputFlags",
                               text_of(fa and [bits(f) for f in fa]), text_of(fb and len(fb)), "", ""))


def node(o, member, path, w, depth):
    if depth > 200:
        raise Exception("deeper than 200 at %s" % path)
    cls = o.GetType().Name
    names = snames(o)
    if names is None:
        raise Exception("<%s> at %s has no archive" % (cls, path))
    attrs = []
    kids = []
    for n in names:
        v = sget(o, n)
        s = scalar(v)
        if s is not None:
            attrs.append((n, s))
        elif is_list(v):
            kids.append(("l", n, v))
        else:
            kids.append(("o", n, v))
    check_api(o, cls, path)
    if cls == "BoxTreeBox":
        mi = vp.prop(o, "MainOutputIndex")
        attrs.append(("api.MainOutputIndex", "null" if mi is None else "i:%d" % int(mi)))
    doc_lines = None
    if cls == "TextDocument":
        attrs.append(("api.Text", "s:" + unicode(vp.prop(o, "Text") or "")))
        count = int(vp.prop(o, "LineCount") or 0)
        doc_lines = []
        for i in range(count):
            ok1, lid = vp.call(o, "GetLineId", [i])
            ok2, tag = vp.call(o, "GetLineTag", [i])
            if not ok1 or not ok2:
                raise Exception("line %d of the snippet document at %s: %s / %s" % (i, path, lid, tag))
            doc_lines.append((scalar(lid), scalar(tag)))
    head = '<o t="%s"' % esc(cls) + ("" if member is None else ' m="%s"' % esc(member))
    head += "".join(' %s="%s"' % (esc(n), esc(s)) for n, s in attrs)
    if not kids and doc_lines is None:
        w(head + "/>")
        return
    w(head + ">")
    for kind, n, v in kids:
        if kind == "o":
            node(v, n, path + "." + n, w, depth + 1)
        else:
            w('<l m="%s">' % esc(n))
            for i, x in enumerate(list(v)):
                s = scalar(x)
                if x is None:
                    w("<null/>")
                elif s is not None:
                    w('<x v="%s"/>' % esc(s))
                else:
                    node(x, None, "%s.%s[%d]" % (path, n, i), w, depth + 1)
            w("</l>")
    if doc_lines is not None:
        w('<l m="api.Lines">')
        for lid, tag in doc_lines:
            w('<o t="Line" Id="%s" Tag="%s"/>' % (esc(lid), esc(tag)))
        w("</l>")
    w("</o>")


def record(name, src, out_dir):
    del mismatches[:]
    counted.clear()
    proj = vp.open_copy(projects, src, "nwl-corpus-" + name)
    log("opened %s (copy of %s)" % (name, src))
    handle = None
    for c in proj.get_children():
        handle = vp.prop(vp.unwrap(c), "handle")
        if handle is not None:
            break
    om = vp.object_manager()
    ok, guids = vp.call(om, "GetAllObjects", [handle])
    if not ok:
        raise Exception("GetAllObjects: %s" % guids)
    names = {}
    parents = {}
    metas = []
    for g in guids:
        ok, meta = vp.call(om, "GetObjectToRead", [handle, g])
        if not ok or meta is None:
            raise Exception("unreadable object %s: %s" % (g, meta))
        names[str(g)] = vp.prop(meta, "Name")
        parents[str(g)] = str(vp.prop(meta, "ParentObjectGuid"))
        metas.append((str(g), meta))
    bodies = []
    for g, meta in metas:
        obj = vp.prop(meta, "Object")
        if obj is None:
            continue
        on = snames(obj)
        if on is None or "Implementation" not in on:
            continue
        impl = sget(obj, "Implementation")
        if impl is None or impl.GetType().Name != "NWLImplementationObject":
            continue
        path = []
        p = g
        while p in names:
            path.insert(0, names[p])
            p = parents.get(p)
        bodies.append((g, "/".join(path), obj.GetType().Name, impl))
    bodies.sort(key=lambda b: (b[1], b[0]))
    lines = []
    w = lines.append
    for g, path, owner, impl in bodies:
        w('<body guid="%s" path="%s" owner="%s">' % (esc(g), esc(path), esc(owner)))
        node(impl, None, path, w, 0)
        w("</body>")
    for m in mismatches:
        w('<api-mismatch path="%s" class="%s" member="%s" api="%s" archive="%s" answered="%s" declared-by="%s" interface="%s"/>'
          % tuple(esc(x) for x in m))
    for k in sorted(counted):
        w('<api-answers class="%s" member="%s" api="%s" archive="%s" answered="%s" count="%d"/>'
          % (tuple(esc(x) for x in k) + (counted[k],)))
    head = '<nwl-corpus corpus="%s" source="%s" ide="CODESYS %s" bodies="%d">' % (
        esc(name), esc(os.path.basename(src)), esc(os.environ.get("VOLT_CODESYS_VERSION", "3.5.21.40")), len(bodies))
    target = os.path.join(out_dir, name + ".nwl.xml")
    f = open(target + ".tmp", "w")
    f.write('<?xml version="1.0" encoding="us-ascii"?>\n' + head + "\n" + "\n".join(lines) + "\n</nwl-corpus>\n")
    f.close()
    if os.path.exists(target):
        os.remove(target)
    os.rename(target + ".tmp", target)
    log("%s: %d bodies, %d api mismatches, %d counted -> %s" % (name, len(bodies), len(mismatches), sum(counted.values()), target))
    proj.close()


try:
    out_dir = os.environ["VOLT_NWL_CORPUS_OUT"]
    for spec in [s for s in os.environ["VOLT_PROBE_PROJECTS"].split(";") if s.strip()]:
        name, src = spec.split("=", 1)
        record(name.strip(), src.strip(), out_dir)
    log("done")
    done()
except Exception:
    done(True)
