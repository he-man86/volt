# CORRELATE the NWL coil flag-bits with the vendor's OWN name for each coil kind.
#
# `IFlags` has Negation and Set and no Reset, so what a RESET coil looks like in the model is not
# something to infer from the logic around it. CODESYS's PLCopen export spells coil storage outright
# (`<coil negated=".." storage="set|reset|none">`), so exporting every POU that has a coil and pairing
# the two views per POU is the vendor answering in its own words.
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-coils.log")
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

def combo(fl):
    if fl is None:
        return "none"
    on = [b for b in FLAGBITS if prop(fl, b)]
    return "+".join(on) if on else "none"

try:
    import clr, System, shutil, re
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

    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-coils.project")
    if os.path.exists(dst): os.remove(dst)
    shutil.copyfile(SRC, dst)
    proj = projects.open(dst)
    log("opened a copy of " + os.path.basename(SRC))

    # ---- side A: every assignment TARGET's flag combo, per POU -------------------------------
    coils = {}          # pou -> {combo: count}
    objs = {}           # pou -> scripting object

    def note(pou, c):
        coils.setdefault(pou, {})
        coils[pou][c] = coils[pou].get(c, 0) + 1

    def walk(n, pou):
        if n is None: return
        tn = n.GetType().Name
        if tn == "BoxTreeAssign":
            outs = prop(n, "Outputs")
            lst = prop(outs, "List") if outs is not None else None
            if lst is not None:
                for x in lst:
                    if x is not None:
                        note(pou, combo(prop(x, "Flags")))
        for single in ("RValue", "Input", "Merger", "Operand"):
            c = prop(n, single)
            if c is not None: walk(c, pou)
        for coll in ("InputItemList", "Trees"):
            c = prop(n, coll)
            if c is not None:
                try:
                    for x in c: walk(x, pou)
                except Exception: pass

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
                        objs[nm] = k
                        for i in range(len(nl)):
                            net = nl[i]
                            cnt = int(prop(net, "NetworkItemCount") or 0)
                            for j in range(cnt):
                                ok, tree = call(net, "GetTree", [j])
                                if ok and tree is not None:
                                    walk(tree, nm)
                except Exception:
                    pass
            visit(k, depth + 1)
    visit(proj, 0)

    # ---- side B: the vendor's own word, for every POU that has a non-plain coil --------------
    interesting = sorted([p for p, d in coils.items() if any(c != "none" for c in d)])
    log("POUs with a non-plain coil: %d" % len(interesting))
    log("")
    log("%-28s %-34s %s" % ("POU", "NWL target flags", "PLCopen <coil negated/storage>"))
    log("-" * 110)
    for pou in interesting:
        obj = objs.get(pou)
        nwl = ", ".join("%s x%d" % (c, n) for c, n in sorted(coils[pou].items()))
        out = os.path.join(tempfile.gettempdir(), "volt-coilx-%s.xml" % re.sub(r"[^A-Za-z0-9_]", "_", pou))
        plc = "<export failed>"
        try:
            if os.path.exists(out):
                os.remove(out)
        except Exception:
            out = out + "2"
        try:
            proj.export_xml([obj], out)
            xml = open(out, "rb").read().decode("utf-8", "replace")
            seen = {}
            for m in re.finditer(r'<coil\b[^>]*negated="(\w+)"[^>]*storage="(\w+)"', xml):
                key = "neg=%s/%s" % m.groups()
                seen[key] = seen.get(key, 0) + 1
            plc = ", ".join("%s x%d" % (k, v) for k, v in sorted(seen.items())) or "<no coils>"
        except Exception:
            plc = "<export threw: %s>" % traceback.format_exc().splitlines()[-1][:60]
        log("%-28s %-34s %s" % (pou[:28], nwl[:34], plc))
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
