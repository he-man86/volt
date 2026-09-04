# Census the NWL box contract across EVERY network in a real project: where the EN pin actually
# arrives, whether the vendor names it, and which output slots are null. Counts, not examples -
# a rule an adapter relies on has to hold on all of them, not on the one that was dumped.
#
#   pwsh> $env:VOLT_PROBE_PROJECT="...\Some.project"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packagesolt-cli\scripts\probe-nwl-census.py"
#
# The project is COPIED first and the original is never opened. Log next to this file (VOLT_PROBE_LOG
# overrides). ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7 and one non-ASCII byte is a
# SyntaxError before line 1 runs.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-census.log")
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

C = {}
EX = {}
def bump(k, ex=None):
    C[k] = C.get(k, 0) + 1
    if ex is not None and k not in EX:
        EX[k] = ex

def names_of(n):
    ip = prop(n, "InputParams")
    if ip is None:
        return None
    try:
        return [str(x) for x in (prop(ip, "Names") or [])]
    except Exception:
        return "<threw>"

def walk(n, where):
    if n is None:
        return
    tn = n.GetType().Name
    fl = prop(n, "Flags")
    if fl is not None:
        for b in FLAGBITS:
            if prop(fl, b):
                bump("itemflag:" + b, where)

    op = prop(n, "Operand")
    if op is not None:
        ofl = prop(op, "Flags")
        if ofl is not None:
            for b in FLAGBITS:
                if prop(ofl, b):
                    bump("operandflag:" + b, where)
        walk(op, where)

    if tn.startswith("BoxTreeBox"):
        en = prop(n, "En")
        ent = "null" if en is None else en.GetType().Name
        bump("En.type=" + ent, where)
        if ent == "Boolean":
            bump("En.bool=" + str(bool(en)), where)
        nm = names_of(n)
        items = []
        try:
            items = list(prop(n, "InputItemList") or [])
        except Exception:
            pass
        cnt = len(items)
        has_en_name = bool(nm) and len(nm) > 0 and nm[0] == "EN"
        if ent == "Boolean" and bool(en):
            bump("EnTrue: Names[0]==EN -> %s" % has_en_name, where)
            bump("EnTrue: inputs==len(Names) -> %s" % (cnt == len(nm or [])), where)
            bump("EnTrue: inputs-len(Names) = %d" % (cnt - len(nm or [])), where)
        else:
            bump("EnNotTrue: Names[0]==EN -> %s" % has_en_name, where)
            bump("EnNotTrue: inputs==len(Names) -> %s" % (cnt == len(nm or [])), where)
        outs = prop(n, "Outputs")
        lst = prop(outs, "List") if outs is not None else None
        if lst is not None:
            n_null = sum(1 for x in lst if x is None)
            bump("box.outputs.count=%d null=%d (EnTrue=%s)" % (len(lst), n_null, ent == "Boolean" and bool(en)), where)
        for x in items:
            walk(x, where)

    for single in ("RValue", "Input", "Merger"):
        c = prop(n, single)
        if c is not None:
            walk(c, where)
    outs = prop(n, "Outputs")
    if outs is not None:
        lst = prop(outs, "List")
        if lst is not None:
            for x in lst:
                if x is None:
                    bump("assign/box null output entry", where)
                else:
                    ofl = prop(x, "Flags")
                    if ofl is not None:
                        for b in FLAGBITS:
                            if prop(ofl, b):
                                bump("outputflag:" + b, where)
    tr = prop(n, "Trees")
    if tr is not None:
        try:
            for x in list(tr):
                walk(x, where)
        except Exception:
            pass

try:
    import clr, System, shutil
    if not SRC or not os.path.exists(SRC):
        log("VOLT_PROBE_PROJECT missing: %r" % SRC); raise SystemExit
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
    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-census.project")
    if os.path.exists(dst): os.remove(dst)
    shutil.copyfile(SRC, dst)
    log("census of: " + os.path.basename(SRC))
    proj = projects.open(dst)
    pous = [0]
    nets = [0]
    def visit(node, depth):
        if depth > 12: return
        try: kids = list(node.get_children())
        except Exception: return
        for k in kids:
            try: nm = str(k.get_name())
            except Exception: nm = "?"
            u = unwrap(k); g = prop(u, "guid")
            if g is not None:
                try:
                    meta = objmgr.GetObjectToRead(prop(u, "handle") or 0, g)
                    iobj = prop(meta, "Object")
                    impl = prop(iobj, "Implementation") if iobj is not None else None
                    nl = prop(impl, "NetworkList") if impl is not None else None
                    if nl is not None:
                        pous[0] += 1
                        for i in range(len(nl)):
                            net = nl[i]; nets[0] += 1
                            cnt = int(prop(net, "NetworkItemCount") or 0)
                            for j in range(cnt):
                                ok, tree = call(net, "GetTree", [j])
                                if ok and tree is not None:
                                    walk(tree, "%s net%d" % (nm, i))
                except Exception:
                    pass
            visit(k, depth + 1)
    visit(proj, 0)
    log("POUs with networks: %d   networks: %d" % (pous[0], nets[0]))
    log("")
    for k in sorted(C):
        log("%-52s %6d   e.g. %s" % (k, C[k], EX.get(k, "")))
    proj.close()
except SystemExit:
    pass
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System; System.Environment.Exit(0)
    except Exception: pass
