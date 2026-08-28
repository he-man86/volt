# Probe: can a graphical network be CONSTRUCTED from nothing through the 3S NWL object model,
# committed, and survive a project reload - with the VENDOR agreeing it is a valid FBD network?
# Gates the CODESYS adapter (openspec/changes/pou-transport-per-vendor/tasks.md 1b.10).
#
#   pwsh> & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI `
#           --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-construct.py"
#
# Log next to this file (override with VOLT_PROBE_LOG). Works on a COPY of the fixture project.
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7; one non-ASCII byte is a SyntaxError
# before line 1 runs, and the previous log silently stays in place.
#
# Concrete types live in NWLObject.plugin (the NWLObject assembly holds only interfaces), and they
# are public with real constructors - so nothing here needs a private-reflection trick.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(HERE, "..", "test")

LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-construct.log")
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

try:
    import clr
    import System
    import shutil

    objmgr = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            t = None
        if t is None:
            continue
        p = t.GetProperty("ObjectMgr")
        if p is not None:
            objmgr = p.GetValue(None, None)
        if objmgr is not None:
            break
    if objmgr is None:
        log("ObjectMgr NOT reachable")
        raise SystemExit

    SRC = os.path.join(TEST, "CodesysTestProject.project")
    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-construct.project")
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copyfile(SRC, dst)
    proj = projects.open(dst)                                    # noqa: F821
    app = find(proj, "Application")

    L = getattr(ImplementationLanguages, "fbd")                  # noqa: F821
    pou = app.create_pou(name="VLT_CTOR", type=PouType.FunctionBlock, language=L)   # noqa: F821
    pou.textual_declaration.replace("FUNCTION_BLOCK VLT_CTOR\nVAR\n  a : INT;\n  b : INT;\nEND_VAR")
    node = unwrap(pou)
    h = prop(node, "handle") or 0
    g = prop(node, "guid")
    log("created VLT_CTOR with VAR a, b")

    meta = objmgr.GetObjectToModify(h, g)
    impl = prop(prop(meta, "Object"), "Implementation")
    nets = prop(impl, "NetworkList")
    plug = nets[0].GetType().Assembly
    log("implementation assembly: " + plug.GetName().Name)

    T = {}
    for t in plug.GetTypes():
        if t.Name in ("BoxTreeAssign", "BoxTreeOperand", "Operand", "Network", "Flags"):
            T[t.Name] = t

    log("")
    log("=== construct:  a := b  ===")
    net0 = nets[0]
    validity(net0, "before")

    # public constructors, no reflection tricks
    src_op = System.Activator.CreateInstance(T["Operand"], System.Array[System.Object](["b"]))
    dst_op = System.Activator.CreateInstance(T["Operand"], System.Array[System.Object](["a"]))
    bto = System.Activator.CreateInstance(T["BoxTreeOperand"], System.Array[System.Object]([src_op]))
    asg = System.Activator.CreateInstance(T["BoxTreeAssign"], System.Array[System.Object]([]))
    log("  built Operand('b'), Operand('a'), BoxTreeOperand(b), BoxTreeAssign()")

    # the r-value is a settable property; the assign target lives in the Outputs collection
    rp = asg.GetType().GetProperty("RValue", _bf())
    rp.SetValue(asg, bto, None)
    log("  RValue <- BoxTreeOperand(b)")

    # OutputItemList is not IList: it exposes AppendOutputItem / InsertOutputItem / RemoveOutputItem,
    # and enumerates through `List` (IOperand[]). Measured, not guessed.
    outs = prop(asg, "Outputs")
    ok, res = call(outs, "AppendOutputItem", [dst_op])
    log("  Outputs.AppendOutputItem('a') -> %s %s" % (ok, "" if ok else res))
    log("  Outputs.List = %r" % ([prop(x, "OperandExpr") for x in (prop(outs, "List") or [])],))

    ok, res = call(net0, "AppendTree", [asg])
    log("  AppendTree -> %s %s" % (ok, "" if ok else res))
    validity(net0, "after append")

    objmgr.SetObject(meta, True, None)
    log("  committed")

    log("")
    log("=== reload and verify ===")
    proj.save()
    proj.close()
    proj2 = projects.open(dst)                                   # noqa: F821
    pou2 = find(proj2, "VLT_CTOR")
    if pou2 is None:
        log(">>> VLT_CTOR GONE after reload")
        raise SystemExit
    n2 = unwrap(pou2)
    meta2 = objmgr.GetObjectToRead(prop(n2, "handle") or 0, prop(n2, "guid"))
    impl2 = prop(prop(meta2, "Object"), "Implementation")
    nets2 = prop(impl2, "NetworkList")
    net2 = nets2[0]
    validity(net2, "after reload")

    ok, tree = call(net2, "GetTree", [0])
    if ok and tree is not None:
        rv = prop(tree, "RValue")
        op = prop(rv, "Operand")
        tgts = prop(prop(tree, "Outputs"), "List")
        log("  tree=%s  RValue.Operand.OperandExpr=%r  Outputs=%r"
            % (tree.GetType().Name,
               prop(op, "OperandExpr"),
               [prop(x, "OperandExpr") for x in (tgts or [])]))
    else:
        log("  GetTree(0) -> %s" % tree)

    ok, can = call(net2, "CanConvertToIL", [prop(n2, "guid")])
    log("  CanConvertToIL -> %s %s" % (can if ok else "FAILED", "" if ok else can))

    log("")
    log("--- the IDE's own verdict: build ---")
    try:
        appn = find(proj2, "Application")
        appn.build()
        log("  build() returned without raising")
    except Exception:
        log("  build raised: " + traceback.format_exc().strip().split(chr(10))[-1])
    # scripting message store, if this host exposes one
    for nm in ("get_error_count", "error_count", "get_message_count"):
        try:
            v = getattr(system, nm)                              # noqa: F821
            log("  system.%s -> %s" % (nm, v() if callable(v) else v))
        except Exception:
            pass

    proj2.close()
    log("")
    log("=== done ===")
except Exception:
    log(traceback.format_exc())
f.close()
try:
    system.exit()                                                # noqa: F821
except Exception:
    pass
