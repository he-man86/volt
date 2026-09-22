# HOW OFTEN DOES ONE ASSIGNMENT DRIVE MORE THAN ONE TARGET - AND WHAT IS ON THOSE TARGETS?
#
# Two format decisions hang on this one census, and neither can be taken without it:
#
# 1. FAN-OUT. Network text spells an N-target `BoxTreeAssign` and a real `BoxTreeDemux` IDENTICALLY
#    (`LET g1 := v; o1 := g1; o2 := g1;`), and the reader turns any `g<n>` LET back into a Demux - by the
#    PREFIX, not the use count. So a multi-output assign cannot survive a round trip: TwinCAT's `Unhoist`
#    guesses it back into one item, CODESYS builds a Demux. Whichever guess is wrong, the engineer's drawn
#    shape changes. Distinguishing them costs a second name family (`m<n>`) and a canonical-form change that
#    diffs every already-pulled workspace holding a fan-out - worth paying IF the shape occurs.
#
# 2. THE MIXED RUNG. A rung driving a coil AND a jump loses the coil in the pulled text, so it now materializes
#    as a MARKER instead (`NetworkTextWriter.Unspellable`). A marker is honest and it is also a POU the
#    engineer can no longer edit as text - so if the shape is COMMON, the marker is the wrong answer and the
#    spelling has to be built instead. This says which.
#
# It also answers the question that prompted the run: does any of this cost DATA LOSS on a real project?
#
#   pwsh> $env:VOLT_PROBE_PROJECTS="C:\...\a.project;C:\...\b.project"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#             --profile="CODESYS V3.5 SP21 Patch 4" --noUI `
#             --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-assign-outputs.py"
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("nwl-assign-outputs.log")

# The two bits that make a target CONTROL FLOW rather than a coil.
CONTROL = ("Jump", "Return")


def targets_of(assign):
    """The assignment's output operands, or []. `Outputs` is an `OutputItemList` wrapping the real list."""
    outs = vp.prop(assign, "Outputs")
    lst = vp.prop(outs, "List") if outs is not None else None
    if lst is None:
        return []
    try:
        return [x for x in lst if x is not None]
    except Exception:
        return []


def is_control(operand):
    fl = vp.prop(operand, "Flags")
    if fl is None:
        return False
    return any(vp.prop(fl, b) for b in CONTROL)


def text_of(o):
    for name in ("OperandExpr", "Operand", "Text", "Name"):
        v = vp.prop(o, name)
        if v is not None and str(v):
            return str(v)[:40]
    return "?"


try:
    srcs = vp.projects_from_env()
    if not srcs:
        log("VOLT_PROBE_PROJECTS is empty")
        done()

    objmgr = vp.object_manager()
    if objmgr is None:
        log("ObjectMgr NOT reachable - the walk cannot reach an implementation aspect")
        done()

    grand = {}

    def bump(k, n=1):
        grand[k] = grand.get(k, 0) + n

    # Every multi-target rung, so the log SHOWS the shapes rather than only counting them. A census that
    # reports "3" and cannot say of what is a number nobody can act on.
    examples = []

    for src in srcs:
        label = os.path.basename(src)
        if not os.path.exists(src):
            log("!! missing: %s" % src)
            continue

        proj = vp.open_copy(projects, src, "assignoutputs")   # noqa: F821 - CODESYS injects `projects`
        per = {}

        def note(k, n=1):
            per[k] = per.get(k, 0) + n
            bump(k, n)

        def walk_node(n, pou):
            if n is None:
                return
            try:
                tn = n.GetType().Name
            except Exception:
                return
            note("tree nodes")

            if tn == "BoxTreeDemux":
                note("BoxTreeDemux (a real fan-out wire)")

            if tn == "BoxTreeAssign":
                note("BoxTreeAssign")
                ts = targets_of(n)
                note("assign targets", len(ts))
                if len(ts) > 1:
                    ctrl = sum(1 for t in ts if is_control(t))
                    note("MULTI-OUTPUT assigns")
                    if ctrl == 0:
                        note("  ...all coils (the fan-out question)")
                    elif ctrl == len(ts):
                        note("  ...all control flow (two jumps on a rung)")
                    else:
                        note("  ...MIXED coil + control flow (the marker question)")
                    if len(examples) < 40:
                        examples.append((label, pou, len(ts), ctrl,
                                         ", ".join(text_of(t) for t in ts)))

            for single in ("RValue", "Input", "Merger", "Operand"):
                c = vp.prop(n, single)
                if c is not None:
                    walk_node(c, pou)
            for coll in ("InputItemList", "Trees", "Branches"):
                c = vp.prop(n, coll)
                if c is not None:
                    try:
                        for x in c:
                            walk_node(x, pou)
                    except Exception:
                        pass

        for k in vp.walk(proj):
            try:
                nm = str(k.get_name())
            except Exception:
                nm = "?"
            u = vp.unwrap(k)
            g = vp.prop(u, "guid")
            if g is None:
                continue
            try:
                meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, g)
                iobj = vp.prop(meta, "Object")
                impl = vp.prop(iobj, "Implementation") if iobj is not None else None
                nl = vp.prop(impl, "NetworkList") if impl is not None else None
                if nl is None:
                    continue
                note("POUs with a NetworkList")
                for i in range(len(nl)):
                    net = nl[i]
                    note("networks")
                    # The vendor's own split point - the construct the CODESYS reader REFUSES (and which
                    # TwinCAT's reader does not look for at all). Counting it here says whether that
                    # asymmetry can ever bite.
                    ok, sp = vp.call(net, "GetSplitPoint", [0])
                    if ok and sp is not None:
                        note("networks carrying a SPLIT POINT")
                    cnt = int(vp.prop(net, "NetworkItemCount") or 0)
                    for j in range(cnt):
                        ok, tree = vp.call(net, "GetTree", [j])
                        if ok and tree is not None:
                            walk_node(tree, nm)
            except Exception:
                note("objects the walk could not read")

        log("== %s" % label)
        for kk in sorted(per, key=lambda x: -per[x]):
            log("     %-46s %d" % (kk, per[kk]))
        log("")
        proj.close()

    log("=== TOTAL ACROSS %d PROJECT(S) ===" % len(srcs))
    for kk in sorted(grand, key=lambda x: -grand[x]):
        log("     %-46s %d" % (kk, grand[kk]))

    log("")
    log("=== EVERY MULTI-TARGET RUNG FOUND (up to 40) ===")
    if not examples:
        log("     none")
    for (proj_label, pou, n, ctrl, ts) in examples:
        kind = "all coils" if ctrl == 0 else ("all control flow" if ctrl == n else "MIXED")
        log("     %-22s %-28s %d targets  %-18s %s" % (proj_label, pou, n, kind, ts))
except Exception:
    done(error=True)
else:
    done()
