# Where does CODESYS keep an item's KIND (a DUT's subtype; a POU's kind) - and which source is right right after
# an in-place change, after a build, and for a text that declares nothing?
#
# openspec `push-without-header-check` section 5 (pull reads the kind from the IDE, never from the text) and the
# owner's question "the IDE must store the correct info". One item of every kind is created in a fixture COPY and
# EVERY source the in-proc API reaches is dumped side by side, so the differences between kinds show where the kind
# lives: the scripting object's type, the IObject's CLR type / interfaces / TypeGuid, every simple property of the
# IObject and of its IMetaObject (only the ones that DIFFER across items are printed), the object's own
# ILanguageModelProvider.GetLanguageModel() (the IDE's language-model snippet for it), and the language model's
# precompile signature (LanguageModelMgr.GetPrecompileContext(app).GetSignature(object): POUType + Flags). DIALECT
# C2g.
#
# Launched by ide.ps1 (never by hand), so the IDE runs on a COPY that ide.ps1 tracks and closes:
#   ide.ps1 up -Vendor codesys -Instance kind-probe -Fixture <Pro2193 project> -RunScript scripts\probe-kind-source.py
# It opens $VOLT_FIXTURE_PROJECT, then arms a timer that reads one command per request file
# (%LOCALAPPDATA%\volt-bridge\kind-probe.req): create | extra | dump <label> | change | build | libflags |
# lmraw <name,name> | exit.
# Between commands the IDE is idle, so its navigator can be read from outside (UI Automation).
#
# ASCII ONLY (IronPython 2.7).
from __future__ import print_function
import os
import sys
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "kind-source.log")
_REQ = os.path.join(os.environ.get("LOCALAPPDATA", _HERE), "volt-bridge", "kind-probe.req")

# Captured now: the runscript's injected globals may not outlive the script body the timer outlives.
_P = projects
_SYS = system
_DutType = DutType
_PouType = PouType
_Severity = Severity


def log(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


DECL = {
    "struct": "TYPE %s :\nSTRUCT\n\talpha : INT;\n\tbeta : BOOL;\nEND_STRUCT\nEND_TYPE\n",
    "enum": "TYPE %s :\n(\n\tRed,\n\tGreen,\n\tBlue\n);\nEND_TYPE\n",
    "enumb": "{attribute 'qualified_only'}\n{attribute 'strict'}\nTYPE %s :\n(\n\tOne := 1,\n\tTwo := 2\n) UDINT;\nEND_TYPE\n",
    "union": "TYPE %s :\nUNION\n\ti : INT;\n\trv : REAL;\nEND_UNION\nEND_TYPE\n",
    "alias": "TYPE %s : STRING(80);\nEND_TYPE\n",
    "unclosed": "(* doc\nTYPE %s :\nSTRUCT\n\talpha : INT;\nEND_STRUCT\nEND_TYPE\n",
    "typeend": "TYPE %s : END_TYPE\n",
    "empty": "",
    "prose": "this is not a declaration\n",
    "badmember": "TYPE %s :\nSTRUCT\n\talpha : NoSuchType;\nEND_STRUCT\nEND_TYPE\n",
    "badalias": "TYPE %s : NoSuchType;\nEND_TYPE\n",
    "dupenum": "TYPE %s :\n(\n\tRed,\n\tRed\n);\nEND_TYPE\n",
}
# The `extra` command: shapes that DO declare a subtype but carry an error inside it (is HasErrors "no answer"?).
EXTRA = [("VltK_XS", "badmember"), ("VltK_XA", "badalias"), ("VltK_XE", "dupenum")]
# name -> (DutType member the object is created with, declaration). The first five are what the IDE's own
# "Add DUT" dialog makes; the V* are Volt's push-create (Structure seed, other declaration written after).
DUTS = [
    ("VltK_S", "Structure", "struct"), ("VltK_E", "Enumeration", "enum"), ("VltK_EB", "Enumeration", "enumb"),
    ("VltK_U", "Union", "union"), ("VltK_A", "Alias", "alias"),
    ("VltK_VE", "Structure", "enum"), ("VltK_VU", "Structure", "union"), ("VltK_VA", "Structure", "alias"),
    ("VltK_BC", "Structure", "unclosed"), ("VltK_BT", "Structure", "typeend"), ("VltK_BE", "Structure", "empty"),
    ("VltK_BX", "Structure", "prose"),
]
POUS = [
    ("VltK_P", "Program", "PROGRAM VltK_P\nVAR\nEND_VAR\n"),
    ("VltK_F", "Function", "FUNCTION VltK_F : INT\nVAR_INPUT\nEND_VAR\n"),
    ("VltK_FB", "FunctionBlock", "FUNCTION_BLOCK VltK_FB\nVAR\nEND_VAR\n"),
    ("VltK_BP", "Program", "(* doc\nPROGRAM VltK_BP\nVAR\nEND_VAR\n"),
    ("VltK_PF", "Program", "FUNCTION_BLOCK VltK_PF\nVAR\nEND_VAR\n"),
    ("VltK_FP", "FunctionBlock", "PROGRAM VltK_FP\nVAR\nEND_VAR\n"),
]
CHANGE_DUT = [("VltK_S", "enum"), ("VltK_E", "struct"), ("VltK_U", "alias"), ("VltK_A", "struct"),
              ("VltK_VE", "struct"), ("VltK_EB", "union")]
CHANGE_POU = [("VltK_P", "FUNCTION_BLOCK VltK_P\nVAR\nEND_VAR\n"), ("VltK_FB", "PROGRAM VltK_FB\nVAR\nEND_VAR\n")]
CONTROLS = ["IQSlices"]   # an IDE-authored ITextListEnumerationObject in Pro2193 (DIALECT C2e)


def app():
    return _P.primary.active_application


def folder():
    hits = [c for c in app().get_children() if c.get_name() == "VltKind"]
    return hits[0] if hits else None


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


def simple(v):
    try:
        import System
        if v is None:
            return "null"
        t = v.GetType()
        if t.IsPrimitive or t.IsEnum or t == System.String or t == System.Guid:
            return str(v)
    except Exception:
        pass
    return None


def props(o):
    """name -> simple value, for every readable non-indexed property of `o` (type + interfaces)."""
    out = {}
    if o is None:
        return out
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for p in src.GetProperties(vp.bf()):
            if p.GetIndexParameters().Length != 0 or not p.CanRead or p.Name in out:
                continue
            try:
                s = simple(p.GetValue(o, None))
            except Exception as e:
                s = "<raised>"
            if s is not None:
                out[p.Name] = s
    return out


SKIP = set(["Name", "Guid", "ObjectGuid", "UniqueIdGeneratorString", "Timestamp", "TimeStamp", "Id", "Index",
            "ProjectHandle", "ParentObjectGuid", "Handle", "MessageGuid", "Checksum", "ChecksumNoInit", "Size",
            "PrecompileId", "PrecompileParentId", "OrgName"])


def describe(mgr, ctx, o):
    rec = {"name": o.get_name(), "script": type(o).__name__}
    raw = vp.unwrap(o)
    guid = vp.prop(raw, "guid")
    handle = vp.prop(raw, "handle")
    ok, meta = vp.call(mgr, "GetObjectToRead", [handle, guid])
    if not ok:
        rec["error"] = "GetObjectToRead failed: %s" % meta
        return rec
    iobj = vp.prop(meta, "Object")
    rec["clr"] = iobj.GetType().FullName
    rec["ifaces"] = "+".join(sorted(i.Name for i in iobj.GetType().GetInterfaces()
                                    if i.Name.endswith("Object") and i.Name not in ("IObject", "IGenericObject")))
    rec["TypeGuid"] = str(vp.prop(iobj, "TypeGuid"))
    rec["meta.ObjectType"] = str(vp.prop(meta, "ObjectType"))
    mp = vp.prop(meta, "Properties")
    try:
        rec["meta.Properties"] = ",".join(sorted(p.GetType().Name for p in mp)) if mp is not None else "null"
    except Exception:
        rec["meta.Properties"] = "?"
    rec["obj"] = props(iobj)
    rec["meta"] = props(meta)
    # The object's OWN language-model snippet - what it hands the compiler (ILanguageModelProvider).
    okl, lm = vp.call(iobj, "GetLanguageModel", [])
    rec["lm"] = (lm if okl else "<GetLanguageModel failed: %s>" % lm) or ""
    # The language model's signature for it (no build needed).
    sig = None
    if ctx is not None:
        oks, sig = vp.call(ctx, "GetSignature", [guid])
        if not oks:
            sig = None
            rec["sig"] = "<GetSignature failed>"
    if sig is not None:
        rec["sig"] = "POUType=%s Flags=%s Name='%s' msgs=%s" % (
            vp.prop(sig, "POUType"), vp.prop(sig, "Flags"), vp.prop(sig, "Name"),
            len(list(vp.prop(sig, "Messages") or [])))
        rec["sigp"] = props(sig)
    elif "sig" not in rec:
        rec["sig"] = "None"
    try:
        decl = o.textual_declaration.text
    except Exception:
        decl = "<no textual_declaration>"
    rec["decl"] = " | ".join([l.strip() for l in (decl or "").split("\n") if l.strip()][:3])
    return rec


def lm_summary(lm):
    """The language-model snippet's element/attribute skeleton: the tags and the attributes that could carry a
    kind (type, kind, subtype, ...), not the whole document."""
    if not lm or lm.startswith("<GetLanguageModel failed"):
        return lm
    tags = []
    for m in re.finditer(r"<([A-Za-z_][\w\-]*)([^>]*)>", lm):
        tag, attrs = m.group(1), m.group(2)
        keep = re.findall(r'(\w*(?:type|kind|Type|Kind|flags|Flags|pou|Pou)\w*)="([^"]*)"', attrs)
        tags.append(tag + ("{" + ",".join("%s=%s" % kv for kv in keep) + "}" if keep else ""))
        if len(tags) >= 14:
            break
    return "len %d: %s" % (len(lm), " ".join(tags))


def dump(label):
    mgr = vp.object_manager()
    m = lmm()
    a = vp.unwrap(app())
    ctx = None
    okc, ctx = vp.call(m, "GetPrecompileContext", [vp.prop(a, "guid")]) if m is not None else (False, None)
    if not okc:
        ctx = None
    log("")
    log("==== %s  (precompile context: %s)" % (label, "yes" if ctx is not None else "NONE"))
    items = []
    f = folder()
    if f is not None:
        items += list(f.get_children())
    items += [o for o in vp.walk(_P.primary) if o.get_name() in CONTROLS and getattr(o, "has_textual_declaration", True)]
    recs = [describe(mgr, ctx, o) for o in items]
    # Which IObject / IMetaObject / signature properties DIFFER across the items (identity props skipped).
    def varying(key):
        names = set()
        for r in recs:
            names |= set((r.get(key) or {}).keys())
        out = []
        for n in sorted(names - SKIP):
            vals = set((r.get(key) or {}).get(n, "-") for r in recs)
            if len(vals) > 1:
                out.append(n)
        return out
    vo, vm, vs = varying("obj"), varying("meta"), varying("sigp")
    log("   IObject properties that differ across items: %s" % (", ".join(vo) or "(none)"))
    log("   IMetaObject properties that differ across items: %s" % (", ".join(vm) or "(none)"))
    log("   signature properties that differ across items: %s" % (", ".join(vs) or "(none)"))
    for r in recs:
        log("")
        log("-- %s  [%s]" % (r["name"], r.get("script")))
        if "error" in r:
            log("   " + r["error"])
            continue
        log("   IObject: %s  ifaces=%s  TypeGuid=%s  meta.ObjectType=%s  meta.Properties=[%s]" % (
            r["clr"], r["ifaces"], r["TypeGuid"], r["meta.ObjectType"], r["meta.Properties"]))
        if vo:
            log("   IObject varying: " + "; ".join("%s=%s" % (n, r["obj"].get(n, "-")) for n in vo))
        if vm:
            log("   IMetaObject varying: " + "; ".join("%s=%s" % (n, r["meta"].get(n, "-")) for n in vm))
        log("   signature: " + r["sig"])
        if vs and r.get("sigp"):
            log("   signature varying: " + "; ".join("%s=%s" % (n, r["sigp"].get(n, "-")) for n in vs))
        log("   GetLanguageModel: " + lm_summary(r["lm"]))
        log("   declaration: " + r["decl"])


def create():
    a = app()
    f = folder()
    if f is None:
        a.create_folder("VltKind")
        f = folder()
    log("create_dut: %s" % (getattr(f.create_dut, "__doc__", "") or "").strip().replace("\n", " ")[:300])
    for name, dtype, key in DUTS:
        try:
            if dtype == "Alias":
                d = f.create_dut(name, getattr(_DutType, dtype), "INT")
            else:
                d = f.create_dut(name, getattr(_DutType, dtype))
        except Exception as e:
            log("create %s (%s) REFUSED: %s" % (name, dtype, e))
            continue
        d.textual_declaration.replace(DECL[key] % name if "%s" in DECL[key] else DECL[key])
        log("created %s as DutType.%s, declaration '%s' written" % (name, dtype, key))
    for name, ptype, text in POUS:
        try:
            if ptype == "Function":
                p = f.create_pou(name=name, type=getattr(_PouType, ptype), return_type="INT")
            else:
                p = f.create_pou(name=name, type=getattr(_PouType, ptype))
            p.textual_declaration.replace(text)
            log("created %s as PouType.%s" % (name, ptype))
        except Exception as e:
            log("create %s REFUSED: %s" % (name, e))
    try:
        i = f.create_interface("VltK_I")
        log("created VltK_I (create_interface)")
    except Exception as e:
        log("create_interface REFUSED: %s" % e)
    try:
        g = f.create_gvl("VltK_G")
        g.textual_declaration.replace("VAR_GLOBAL\n\tvS : VltK_S;\n\tvE : VltK_E;\n\tvU : VltK_U;\n\tvA : VltK_A;\nEND_VAR\n")
        log("created VltK_G (create_gvl)")
    except Exception as e:
        log("create_gvl REFUSED: %s" % e)
    # A text-list enumeration through the DUT factory's own door, if it opens to a script.
    try:
        import System
        t = None
        for asm in System.AppDomain.CurrentDomain.GetAssemblies():
            t = t or asm.GetType("_3S.CoDeSys.DUTObject.DUTObjectFactory")
        fac = System.Activator.CreateInstance(t) if t is not None else None
        for args in (["VltK_TL"], ["VltK_TL", "Enumeration", "", "TextList"], ["VltK_TL", "2", "", "True"]):
            ok, r = vp.call(fac, "WillBeTextListEnumerationObject", [System.Array[System.String](args)])
            log("DUTObjectFactory.WillBeTextListEnumerationObject(%r) -> %s %s" % (args, ok, r))
    except Exception as e:
        log("text-list factory probe: %s" % e)


def extra():
    f = folder()
    if f is None:
        app().create_folder("VltKind")
        f = folder()
    for name, key in EXTRA:
        d = f.create_dut(name, _DutType.Structure)
        d.textual_declaration.replace(DECL[key] % name)
        log("created %s (Structure seed), declaration '%s' written" % (name, key))
    p = f.create_pou(name="VltK_XP", type=_PouType.Program)
    p.textual_declaration.replace("PROGRAM VltK_XP\nVAR\n\tv : NoSuchType;\nEND_VAR\n")
    log("created VltK_XP (Program) with an unknown variable type")


def lmraw(names):
    """The whole GetLanguageModel() string of the named items."""
    mgr = vp.object_manager()
    f = folder()
    for o in f.get_children():
        if o.get_name() not in names:
            continue
        raw = vp.unwrap(o)
        ok, meta = vp.call(mgr, "GetObjectToRead", [vp.prop(raw, "handle"), vp.prop(raw, "guid")])
        okl, lm = vp.call(vp.prop(meta, "Object"), "GetLanguageModel", [])
        log("")
        log("-- GetLanguageModel(%s):" % o.get_name())
        log(lm if okl else "<failed: %s>" % lm)


def change():
    f = folder()
    for name, key in CHANGE_DUT:
        o = [c for c in f.get_children() if c.get_name() == name][0]
        o.textual_declaration.replace(DECL[key] % name)
        log("in place: %s <- %s declaration" % (name, key))
    for name, text in CHANGE_POU:
        o = [c for c in f.get_children() if c.get_name() == name][0]
        o.textual_declaration.replace(text)
        log("in place: %s <- %s" % (name, text.split("\n")[0]))


def build():
    a = app()
    a.build()
    msgs = []
    for cat in _SYS.get_message_categories(True):
        for sev in (_Severity.FatalError, _Severity.Error):
            for m in _SYS.get_message_objects(cat, sev):
                t = getattr(m, "text", str(m))
                if "VltK_" in t:
                    msgs.append("[%s] %s" % (sev, t))
    log("")
    log("==== build: %d error(s) naming a VltK_ item" % len(msgs))
    for t in msgs[:40]:
        log("   " + t)


def libflags():
    """Question 3: do LIBRARY DUT signatures carry the subtype in Flags? Tally (POUType, subtype flags)."""
    m = lmm()
    ok, sigs = vp.call(m, "AllPrecompiledSignatures", [True, True])
    tally = {}
    examples = {}
    for s in (sigs if ok else []):
        if vp.prop(s, "IsLibraryObject") is not True:
            continue
        pt = str(vp.prop(s, "POUType"))
        if pt not in ("Type", "VarGlobal"):
            continue
        fl = str(vp.prop(s, "Flags"))
        sub = "+".join(x for x in ("Structure", "Enum", "Alias", "Union") if x in fl) or "-"
        key = "%s/%s" % (pt, sub)
        tally[key] = tally.get(key, 0) + 1
        examples.setdefault(key, []).append(str(vp.prop(s, "Name")))
    log("")
    log("==== library signatures (AllPrecompiledSignatures, IsLibraryObject, POUType Type|VarGlobal): POUType/subtype-flags")
    for k in sorted(tally):
        log("   %-22s %5d   e.g. %s" % (k, tally[k], ", ".join(examples[k][:4])))


def _tick(sender, args):
    if not os.path.exists(_REQ):
        return
    try:
        with open(_REQ) as f:
            line = f.read().strip()
        os.remove(_REQ)
        cmd, _, rest = line.partition(" ")
        log("")
        log(">> %s" % line)
        if cmd == "create":
            create()
        elif cmd == "dump":
            dump(rest or "dump")
        elif cmd == "change":
            change()
        elif cmd == "build":
            build()
        elif cmd == "extra":
            extra()
        elif cmd == "lmraw":
            lmraw(rest.split(","))
        elif cmd == "libflags":
            libflags()
        elif cmd == "exit":
            import System
            System.Environment.Exit(0)
        log("<< done %s" % cmd)
    except Exception:
        import traceback
        log(traceback.format_exc())


try:
    src = os.environ.get("VOLT_FIXTURE_PROJECT")
    log("probe-kind-source.py - project %s" % src)
    _P.open(src)
    log("opened: %s; application %s" % (_P.primary.path, app().get_name()))
    import clr
    clr.AddReference("System.Windows.Forms")
    import System
    from System.Windows.Forms import Timer
    _timer = Timer()
    _timer.Interval = 1000
    _timer.Tick += _tick
    _timer.Start()
    System.AppDomain.CurrentDomain.SetData("volt.probe.kind-source", _timer)
    log("probe timer armed; request file: " + _REQ)
except Exception:
    import traceback
    log(traceback.format_exc())
