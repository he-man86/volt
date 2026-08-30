# Probe: what does an FBD network's COMMENT actually live on?
#
#   pwsh> & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI `
#           --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-comments.py"
#
# WHY. A user fixture holds an FBD method (`fbdmeth`) whose network carries a comment, and Volt renders that
# body as an EMPTY `NETWORK 0 FBD / END_NETWORK` - so something in it is being dropped. The NWL model exposes
# exactly two comment members (reflected): `INetwork.Comment`, which Volt already reads and writes, and
# `INWLImplementationObject.NWLComment`, which Volt does not model at all. This says which one holds it, and
# whether the network also carries ITEMS that Volt's reader is skipping.
#
# Operates on a COPY. Writes its log next to itself (override with VOLT_PROBE_LOG).
# CODESYS compiles this as ASCII IronPython 2.7 - one non-ASCII byte is a SyntaxError before line 1 runs.
import os
import shutil
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("VOLT_PROBE_PROJECT") or os.path.join(HERE, "..", "test", "Untitled1.project")
WANT = os.environ.get("VOLT_PROBE_POU") or "POU_comments"

LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-comments.log")
f = open(LOG, "w")


def log(s):
    f.write(str(s) + "\n")
    f.flush()


BF = None


def _bf():
    global BF
    if BF is None:
        from System.Reflection import BindingFlags as B
        BF = B.Public | B.NonPublic | B.Instance | B.FlattenHierarchy
    return BF


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
    return None


def tname(o):
    try:
        return o.GetType().Name
    except Exception:
        return "?"


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


def names(root, out, depth=0):
    if depth > 14:
        return
    try:
        out.append(("  " * depth) + str(root.get_name()))
    except Exception:
        pass
    try:
        kids = list(root.get_children())
    except Exception:
        return
    for k in kids:
        names(k, out, depth + 1)


def dump(o, depth, lvl=0):
    """Walk an NWL tree node, reporting the TYPE of every member the reader dispatches on."""
    if o is None or lvl > depth:
        return
    pad = "          " + ("  " * lvl)
    for m in ("RValue", "Operand", "Instance", "En", "Input", "Trees", "Outputs", "InputItemList", "BoxType"):
        try:
            v = prop(o, m)
        except Exception:
            continue
        if v is None:
            continue
        log("%s%s: %s = %r" % (pad, m, tname(v), v))
        if tname(v).startswith("BoxTree"):
            dump(v, depth, lvl + 1)


def find(root, want, depth=0):
    if depth > 14:
        return None
    try:
        if str(root.get_name()) == want:
            return root
    except Exception:
        pass
    try:
        kids = list(root.get_children())
    except Exception:
        return None
    for k in kids:
        r = find(k, want, depth + 1)
        if r is not None:
            return r
    return None


try:
    dst = os.path.join(tempfile.gettempdir(), "volt-probe-comments.project")
    shutil.copyfile(os.path.abspath(SRC), dst)
    log("copied %s -> %s" % (SRC, dst))

    import System

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
    log("ObjectMgr: %s" % ("ok" if objmgr is not None else "NOT REACHABLE"))

    proj = projects.open(dst)                                    # noqa: F821

    tree = []
    names(proj, tree)
    log("--- project tree ---")
    for n in tree:
        log("   " + n)
    log("--- end tree ---")

    # Compare the object TYPE of the POU Volt drops against ones it lists.
    log("--- object types ---")
    for nm in ("PLC_PRG", "POU", "POU_comments", "FB_GraphicalChild"):
        o = find(proj, nm)
        if o is None:
            log("   %-18s NOT FOUND" % nm)
            continue
        u2 = unwrap(o)
        log("   %-18s type=%s is_folder=%s guid=%s" % (
            nm, getattr(u2, "type", None), getattr(u2, "is_folder", None), getattr(u2, "guid", None)))
    log("--- end types ---")

    pou = find(proj, WANT)
    log("pou '%s': %s" % (WANT, "FOUND" if pou is not None else "NOT FOUND"))
    if pou is None:
        raise SystemExit(0)

    # The ONLY path that reaches the aspect: unwrap the script object, then ask the ObjectMgr for the real one.
    u = unwrap(pou)
    log("unwrapped: %s" % (u.GetType().FullName if u is not None else "None"))
    try:
        props = sorted([pp.Name for pp in u.GetType().GetProperties(_bf())])
        log("   props: " + ", ".join(props[:40]))
    except Exception:
        pass

    # IronPython surfaces these as plain attributes; the reflection helper does not see them.
    h = getattr(u, "handle", None) or getattr(pou, "handle", None)
    g = getattr(u, "guid", None) or getattr(pou, "guid", None)
    log("   handle=%r guid=%r" % (h, g))
    if g is None:
        log("no guid - cannot reach the aspect")
        raise SystemExit(0)

    meta = objmgr.GetObjectToRead(h or 0, g)
    impl = prop(prop(meta, "Object"), "Implementation")
    log("implementation object: %s" % tname(impl))

    # THE BODY-LEVEL COMMENT - the member Volt does not model.
    log("  NWLComment      = %r" % (prop(impl, "NWLComment"),))

    nets = prop(impl, "NetworkList")
    try:
        nets = list(nets)
    except Exception:
        nets = []
    log("  networks        = %d" % len(nets))

    for i, net in enumerate(nets):
        log("  --- network %d (%s) ---" % (i, tname(net)))
        for m in ("Comment", "Title", "Label", "OutCommented"):
            log("      %-12s = %r" % (m, prop(net, m)))
        cnt = prop(net, "NetworkItemCount")
        log("      NetworkItemCount = %r" % (cnt,))
        try:
            n = int(cnt)
        except Exception:
            n = 0
        for j in range(max(n, 1)):
            try:
                t = net.GetTree(j)
                log("        GetTree(%d) -> %s  value=%r" % (j, tname(t), t))
                dump(t, 4)
            except Exception as ex:
                log("        GetTree(%d) THREW %s" % (j, ex))

    log("OK")
except Exception:
    log("FAILED:\n" + traceback.format_exc())
finally:
    try:
        f.close()
    except Exception:
        pass
