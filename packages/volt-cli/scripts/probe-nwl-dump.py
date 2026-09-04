# Dump the raw NWL item tree of NAMED POUs from a real project, member by member - the shape an
# adapter must actually read, rather than the shape its doubles were written to.
#
#   pwsh> $env:VOLT_PROBE_PROJECT="...\Some.project"; $env:VOLT_PROBE_POUS="ATD_FQI,SpeedCalculationDryer"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packagesolt-cli\scripts\probe-nwl-dump.py"
#
# The project is COPIED first and the original is never opened. Log next to this file (VOLT_PROBE_LOG
# overrides). ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7 and one non-ASCII byte is a
# SyntaxError before line 1 runs.
#
# This is the probe that settled the RETURN-coil bug: `out[0] = '???' type='BOOL' flags=Return` - the
# control-flow bit on the target OPERAND, which the readers lifted for Jump and not for Return.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-dump.log")
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

FLAGBITS = ("Negation", "Set", "Jump", "Return", "Rtrig", "Ftrig")
WANT = [w.strip() for w in (os.environ.get("VOLT_PROBE_POUS") or "").split(",") if w.strip()]

def flagstr(fl):
    if fl is None:
        return "-"
    on = [b for b in FLAGBITS if prop(fl, b)]
    return "+".join(on) if on else "none"

def opdump(o):
    if o is None:
        return "<null>"
    return "%r type=%r flags=%s" % (prop(o, "OperandExpr"), prop(o, "Type"), flagstr(prop(o, "Flags")))

def dump(n, depth, tag):
    if n is None:
        log("  " * depth + tag + ": <null>")
        return
    tn = n.GetType().Name
    head = "  " * depth + tag + ": " + tn + "  itemflags=" + flagstr(prop(n, "Flags"))
    bt = prop(n, "BoxType")
    if bt:
        head += "  BoxType=%r" % str(bt)
    log(head)

    op = prop(n, "Operand")
    if op is not None:
        log("  " * (depth + 1) + "Operand = " + opdump(op))

    if tn.startswith("BoxTreeBox"):
        insn = prop(n, "Instance")
        if insn is not None:
            log("  " * (depth + 1) + "Instance = %r" % (prop(insn, "OperandExpr"),))
        en = prop(n, "En")
        log("  " * (depth + 1) + "En  = %r (%s)" % (en, en.GetType().Name if en is not None else "null"))
        eno = prop(n, "Eno")
        log("  " * (depth + 1) + "Eno = %r (%s)" % (eno, eno.GetType().Name if eno is not None else "null"))
        log("  " * (depth + 1) + "EnEno=%r  EnEnoPossible=%r" % (prop(n, "EnEno"), prop(n, "EnEnoPossible")))
        pss = prop(n, "ProvidesSTSnippet")
        sn = prop(n, "STSnippet")
        log("  " * (depth + 1) + "ProvidesSTSnippet=%r  STSnippet=%r" % (pss, sn))
        if sn is not None:
            for mm in sorted(sn.GetType().GetProperties(_bf()), key=lambda x: x.Name):
                try: v = mm.GetValue(sn, None)
                except Exception: v = "<threw>"
                log("  " * (depth + 2) + "snippet.%-22s = %r" % (mm.Name, v))
            inner = prop(sn, "Snippet")
            log("  " * (depth + 2) + ">> Get(snippet,'Snippet') -> %r" % (inner,))
            if inner is not None:
                for mm in sorted(inner.GetType().GetProperties(_bf()), key=lambda x: x.Name):
                    try: v = mm.GetValue(inner, None)
                    except Exception: v = "<threw>"
                    sv = repr(v)
                    log("  " * (depth + 3) + "impl.%-26s = %s" % (mm.Name, sv[:200]))
        ip = prop(n, "InputParams")
        names = None
        if ip is not None:
            try:
                names = list(prop(ip, "Names") or [])
            except Exception:
                names = "<threw>"
        items = prop(n, "InputItemList")
        cnt = 0
        try:
            cnt = len(list(items))
        except Exception:
            pass
        op_names = None
        opp = prop(n, "OutputParams")
        if opp is not None:
            try:
                op_names = [str(x) for x in (prop(opp, "Names") or [])]
            except Exception:
                op_names = "<threw>"
        log("  " * (depth + 1) + "InputItemList count=%d   InputParams.Names=%r" % (cnt, names))
        log("  " * (depth + 1) + "OutputParams.Names=%r  MainOutputIndex=%r  MainInputIndex=%r"
            % (op_names, prop(n, "MainOutputIndex"), prop(n, "MainInputIndex")))
        try:
            for i, x in enumerate(list(items)):
                dump(x, depth + 2, "in[%d]" % i)
        except Exception:
            pass

    rv = prop(n, "RValue")
    if rv is not None:
        dump(rv, depth + 1, "RValue")
    outs = prop(n, "Outputs")
    if outs is not None:
        lst = prop(outs, "List")
        if lst is not None:
            for i, x in enumerate(lst):
                log("  " * (depth + 1) + "out[%d] = %s" % (i, opdump(x)))
    for single in ("Input", "Merger"):
        c = prop(n, single)
        if c is not None:
            dump(c, depth + 1, single)
    tr = prop(n, "Trees")
    if tr is not None:
        try:
            for i, x in enumerate(list(tr)):
                dump(x, depth + 1, "branch[%d]" % i)
        except Exception:
            pass

try:
    import clr
    import System
    import shutil

    if not SRC or not os.path.exists(SRC):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % SRC)
        raise SystemExit

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

    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-dump.project")
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copyfile(SRC, dst)
    log("probe of: " + os.path.basename(SRC))
    log("wanted POUs: %r" % WANT)
    proj = projects.open(dst)                                    # noqa: F821
    log("opened (a copy; the original is never touched)")

    def visit(node, depth):
        if depth > 12:
            return
        try:
            kids = list(node.get_children())
        except Exception:
            return
        for k in kids:
            try:
                nm = str(k.get_name())
            except Exception:
                nm = "?"
            if nm in WANT:
                u = unwrap(k)
                g = prop(u, "guid")
                if g is not None:
                    try:
                        meta = objmgr.GetObjectToRead(prop(u, "handle") or 0, g)
                        iobj = prop(meta, "Object")
                        impl = prop(iobj, "Implementation") if iobj is not None else None
                        nets = prop(impl, "NetworkList") if impl is not None else None
                        if nets is not None:
                            log("")
                            log("=" * 78)
                            log("POU %s  (%d networks)" % (nm, len(nets)))
                            log("=" * 78)
                            for i in range(len(nets)):
                                net = nets[i]
                                log("")
                                log("-- NETWORK %d  title=%r label=%r comment=%r" %
                                    (i, prop(net, "Title"), prop(net, "Label"), prop(net, "Comment")))
                                cnt = int(prop(net, "NetworkItemCount") or 0)
                                for j in range(cnt):
                                    ok, tree = call(net, "GetTree", [j])
                                    if ok and tree is not None:
                                        dump(tree, 1, "tree[%d]" % j)
                    except Exception:
                        log("  !! " + traceback.format_exc())
            visit(k, depth + 1)

    visit(proj, 0)
    log("")
    log("done")
    proj.close()
except SystemExit:
    pass
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System
        System.Environment.Exit(0)
    except Exception:
        pass
