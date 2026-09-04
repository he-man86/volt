# Probe: can an EXECUTE box (ST inside FBD/LD) be CONSTRUCTED?
#
# The CODESYS writer refuses one today, and the refusal says why: "constructing one is not measured".
# The read side is known - ProvidesSTSnippet + STSnippet.Snippet -> STImplementationObject -> TextDocument
# -> Text. This asks whether the same chain can be BUILT: make the snippet, set its text, hang it on a box,
# commit, reload, and read the ST back.
#
# Works on a COPY of the committed fixture project. ASCII ONLY (IronPython 2.7).
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(HERE, "..", "test")

LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-execute-create.log")
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
    """Invoke a method declared on the type OR on any interface (explicit implementations)."""
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods():
            if m.Name != name or len(m.GetParameters()) != len(args):
                continue
            try:
                import System
                return True, m.Invoke(o, System.Array[System.Object](list(args)))
            except Exception:
                return False, traceback.format_exc().strip().split(chr(10))[-1]
    return False, "no method " + name

def seq(o):
    """A vendor collection as a python list, via reflection (they are not IronPython-iterable)."""
    if o is None:
        return None
    n = prop(o, "Count")
    if n is None:
        return None
    out = []
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        p = src.GetProperty("Item")
        if p is not None:
            for i in range(int(n)):
                try:
                    out.append(p.GetValue(o, [i]))
                except Exception:
                    return out
            return out
    return out

def find(root, want, depth=0):
    if depth > 9:
        return None
    try:
        kids = list(root.get_children())
    except Exception:
        return None
    for k in kids:
        try:
            if str(k.get_name()) == want:
                return k
        except Exception:
            pass
        r = find(k, want, depth + 1)
        if r is not None:
            return r
    return None

def validity(net, tag):
    log("  %-22s FBDValid=%s ILValid=%s ILActive=%s items=%s"
        % (tag, prop(net, "FBDValid"), prop(net, "ILValid"),
           prop(net, "ILActive"), prop(net, "NetworkItemCount")))



ST = "iCount := iCount + 1;\nIF iCount > 10 THEN\n\tiCount := 0;\nEND_IF"

try:
    import clr, System, shutil

    objmgr = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try: t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception: t = None
        if t is None: continue
        p = t.GetProperty("ObjectMgr")
        if p is not None: objmgr = p.GetValue(None, None)
        if objmgr is not None: break
    if objmgr is None:
        log("ObjectMgr NOT reachable"); raise SystemExit

    SRC = os.path.join(TEST, "fixtures", "CodesysTestProject.project")
    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-executecreate.project")
    if os.path.exists(dst): os.remove(dst)
    shutil.copyfile(SRC, dst)
    proj = projects.open(dst)
    app = find(proj, "Application")

    L = getattr(ImplementationLanguages, "fbd")
    pou = app.create_pou(name="VLT_EXEC", type=PouType.FunctionBlock, language=L)
    pou.textual_declaration.replace("FUNCTION_BLOCK VLT_EXEC\nVAR\n  iCount : INT;\n  rung : BOOL;\nEND_VAR")
    node = unwrap(pou)
    meta = objmgr.GetObjectToModify(prop(node, "handle") or 0, prop(node, "guid"))
    impl = prop(prop(meta, "Object"), "Implementation")
    nets = prop(impl, "NetworkList")
    plug = nets[0].GetType().Assembly

    T = {}
    for t in plug.GetTypes():
        T[t.Name] = t
    log("BoxTreeBox present: %r   STSnippet present: %r" % ("BoxTreeBox" in T, "STSnippet" in T))

    # 1) Can an STSnippet be constructed at all?
    if "STSnippet" not in T:
        log("no STSnippet type in %s - looking wider" % plug.GetName().Name)
        for asm in System.AppDomain.CurrentDomain.GetAssemblies():
            try:
                tt = asm.GetType("_3S.CoDeSys.NWLObject.STSnippet")
            except Exception:
                tt = None
            if tt is not None:
                T["STSnippet"] = tt
                log("  found STSnippet in %s" % asm.GetName().Name)
                break
    if "STSnippet" not in T:
        log("STSnippet type NOT FOUND"); raise SystemExit

    log("")
    log("=== constructing STSnippet ===")
    for c in T["STSnippet"].GetConstructors(_bf()):
        log("  ctor(%s)" % ", ".join(x.ParameterType.Name for x in c.GetParameters()))
    snip = None
    try:
        snip = System.Activator.CreateInstance(T["STSnippet"], System.Array[System.Object]([]))
        log("  STSnippet() -> %r" % (snip,))
    except Exception:
        log("  STSnippet() threw: " + traceback.format_exc().splitlines()[-1])

    if snip is not None:
        inner = prop(snip, "Snippet")
        log("  .Snippet on a fresh snippet = %r" % (inner,))

        log("")
        log("=== can .Snippet be SET? ===")
        setter = None
        for src2 in [snip.GetType()] + list(snip.GetType().GetInterfaces()):
            for pr in src2.GetProperties():
                if pr.Name.endswith("Snippet") and pr.CanWrite:
                    setter = pr
                    log("  settable: %s.%s" % (src2.Name, pr.Name))
        if setter is None:
            log("  NO settable Snippet property; members are:")
            for pr in snip.GetType().GetProperties(_bf()):
                log("     %-40s canWrite=%r" % (pr.Name, pr.CanWrite))

        log("")
        log("=== can an STImplementationObject be constructed? ===")
        sti = None
        for asm in System.AppDomain.CurrentDomain.GetAssemblies():
            try: tt = asm.GetType("_3S.CoDeSys.STObject.STImplementationObject")
            except Exception: tt = None
            if tt is not None:
                log("  type in %s" % asm.GetName().Name)
                for c in tt.GetConstructors(_bf()):
                    log("    ctor(%s)" % ", ".join(x.ParameterType.Name for x in c.GetParameters()))
                try:
                    sti = System.Activator.CreateInstance(tt, System.Array[System.Object]([]))
                    log("    STImplementationObject() -> %r" % (sti,))
                except Exception:
                    log("    ctor threw: " + traceback.format_exc().splitlines()[-1])
                break
        if sti is not None:
            log("    .TextDocument = %r" % (prop(sti, "TextDocument"),))
            if setter is not None:
                try:
                    setter.SetValue(snip, sti, None)
                    log("    set snip.Snippet -> ok; now %r" % (prop(snip, "Snippet"),))
                    inner = prop(snip, "Snippet")
                except Exception:
                    log("    set snip.Snippet threw: " + traceback.format_exc().splitlines()[-1])
        if inner is not None:
            td = prop(inner, "TextDocument")
            log("  .TextDocument = %r" % (td,))
            if td is not None:
                try:
                    td.GetType().GetProperty("Text", _bf()).SetValue(td, ST, None)
                    ok, res = True, ""
                except Exception:
                    ok, res = False, traceback.format_exc().splitlines()[-1]
                log("  TextDocument.Text = st -> %s %s" % (ok, res))
                if not ok:
                    for m in td.GetType().GetMethods(_bf()):
                        if "Text" in m.Name or m.Name in ("Replace", "SetText", "Insert"):
                            log("      td.%s(%s)" % (m.Name, ", ".join(x.ParameterType.Name for x in m.GetParameters())))
                log("  TextDocument.Text now = %r" % (prop(td, "Text"),))

    # 2) hang it on a box and commit
    if snip is not None:
        box = System.Activator.CreateInstance(T["BoxTreeBox"], System.Array[System.Object]([]))
        box.GetType().GetProperty("BoxType", _bf()).SetValue(box, "EXECUTE", None)
        for nm in ("STSnippet", "ProvidesSTSnippet"):
            pr = box.GetType().GetProperty(nm, _bf())
            log("  BoxTreeBox.%s settable: %r" % (nm, pr is not None and pr.CanWrite))
        try:
            box.GetType().GetProperty("STSnippet", _bf()).SetValue(box, snip, None)
            log("  set box.STSnippet -> ok; ProvidesSTSnippet now %r" % (prop(box, "ProvidesSTSnippet"),))
        except Exception:
            log("  set box.STSnippet threw: " + traceback.format_exc().splitlines()[-1])

        ok, res = call(nets[0], "AppendTree", [box])
        log("  AppendTree -> %s %s" % (ok, "" if ok else res))
        objmgr.SetObject(meta, True, None)
        proj.save()
        proj.close()

        log("")
        log("=== reload and read the ST back ===")
        proj = projects.open(dst)
        pou2 = find(proj, "VLT_EXEC")
        n2 = unwrap(pou2)
        meta2 = objmgr.GetObjectToRead(prop(n2, "handle") or 0, prop(n2, "guid"))
        impl2 = prop(prop(meta2, "Object"), "Implementation")
        nets2 = prop(impl2, "NetworkList")
        cnt = int(prop(nets2[0], "NetworkItemCount") or 0)
        for j in range(cnt):
            ok, tree = call(nets2[0], "GetTree", [j])
            if ok and tree is not None and tree.GetType().Name == "BoxTreeBox":
                sn = prop(tree, "STSnippet")
                log("  BoxType=%r ProvidesSTSnippet=%r" % (prop(tree, "BoxType"), prop(tree, "ProvidesSTSnippet")))
                if sn is not None:
                    i2 = prop(sn, "Snippet")
                    td2 = prop(i2, "TextDocument") if i2 is not None else None
                    log("  ST read back = %r" % (prop(td2, "Text") if td2 is not None else None,))
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
