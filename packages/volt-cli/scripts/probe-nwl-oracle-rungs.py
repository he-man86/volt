# THE LADDER ORACLE RUNGS, dumped fact by fact (openspec network-text-literal-nwl, task 2.4): every network the
# v2 goldens pin from lenze-mid, with EVERY fact network text v2 spells or refuses on - item class and nesting,
# BoxType, instance, InputParams / OutputParams names and types, the output slots as stored (null, empty, wired),
# MainOutputIndex, En/Eno, InputFlags, operand and target flags, Demux VarIds, a Parallel's Mode and feed, and the
# network's title, label, comment and OutCommented. The corpus holds these rungs as v1 TEXT, which carries none of
# the v2 facts (which X AND (a OR b) is a Parallel, which box has an ENO output, which slot a pin is on); a golden
# model built from the text alone would be a guess, so it is built from this dump.
#
#   pwsh> $env:VOLT_PROBE_PROJECT="...\Lenze_MID-S100_V5_00_602_T51.project"
#         $env:VOLT_PROBE_NETS="Mach1_MIDS:0,10,13,82;TrayFiller:1,6,8"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-oracle-rungs.py"
#
# The project is COPIED first and the original is never opened (vp.open_copy). Network numbers are list
# positions, 0-based - the order the corpus's v1 `NETWORK <n>` headers carry. ASCII ONLY (IronPython 2.7).
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("nwl-oracle-rungs.log")

FLAGBITS = ("Negation", "Set", "Jump", "Return", "Rtrig", "Ftrig")


def bits(fl):
    if fl is None:
        return "-"
    on = [b for b in FLAGBITS if vp.prop(fl, b)]
    return "+".join(on) if on else "none"


def kind(n):
    return n.GetType().Name if n is not None else "null"


def params(o, member):
    p = vp.prop(o, member)
    if p is None:
        return "null"
    names = [str(x) for x in (vp.prop(p, "Names") or [])]
    types = [str(x) for x in (vp.prop(p, "Types") or [])]
    return "Names=%r Types=%r" % (names, types)


def operand(o):
    if o is None:
        return "<null>"
    return "%r type=%r flags=%s" % (vp.prop(o, "OperandExpr"), vp.prop(o, "Type"), bits(vp.prop(o, "Flags")))


def dump(n, pad, label):
    t = kind(n)
    head = "%s%s: %s" % (pad, label, t)
    if n is None:
        log(head)
        return
    itemflags = bits(vp.prop(n, "Flags")) if t != "BoxTreeOperand" else "(none held)"
    if t == "BoxTreeOperand":
        log("%s  Operand = %s" % (head, operand(vp.prop(n, "Operand"))))
        return
    if t == "BoxTreeDemux":
        log("%s  VarId=%s itemflags=%s" % (head, vp.prop(n, "VarId"), itemflags))
        inp = vp.prop(n, "Input")
        if inp is not None:
            dump(inp, pad + "    ", "Input")
        return
    if t == "BoxTreeTerminator":
        log("%s  itemflags=%s" % (head, itemflags))
        inp = vp.prop(n, "Input")
        if inp is not None:
            dump(inp, pad + "    ", "Input")
        return
    if t == "BoxTreeParallel":
        log("%s  Mode=%s itemflags=%s" % (head, vp.prop(n, "Mode"), itemflags))
        inp = vp.prop(n, "Input")
        if inp is None:
            log(pad + "    Input: none")
        else:
            dump(inp, pad + "    ", "Input")
        trees = list(vp.prop(n, "Trees") or [])
        for i, x in enumerate(trees):
            dump(x, pad + "    ", "branch[%d]" % i)
        return
    if t == "BoxTreeAssign":
        log("%s  itemflags=%s" % (head, itemflags))
        dump(vp.prop(n, "RValue"), pad + "    ", "RValue")
        lst = vp.prop(vp.prop(n, "Outputs"), "List")
        for i, x in enumerate(list(lst or [])):
            log("%s    out[%d] = %s" % (pad, i, operand(x)))
        return
    if t == "BoxTreeBox":
        log("%s  BoxType=%r itemflags=%s" % (head, vp.prop(n, "BoxType"), itemflags))
        log("%s    Instance = %s  CallType=%s" % (pad, operand(vp.prop(n, "Instance")), vp.prop(n, "CallType")))
        log("%s    En=%r Eno=%r EnEno=%r MainOutputIndex=%r" % (
            pad, vp.prop(n, "En"), vp.prop(n, "Eno"), vp.prop(n, "EnEno"), vp.prop(n, "MainOutputIndex")))
        log("%s    InputParams  %s" % (pad, params(n, "InputParams")))
        log("%s    OutputParams %s" % (pad, params(n, "OutputParams")))
        iflags = vp.prop(n, "InputFlags")
        log("%s    InputFlags = %s" % (pad, "null" if iflags is None else [bits(x) for x in list(iflags)]))
        snip = vp.prop(n, "STSnippet")
        if snip is not None:
            log("%s    STSnippet present" % pad)
        for i, x in enumerate(list(vp.prop(n, "InputItemList") or [])):
            dump(x, pad + "    ", "in[%d]" % i)
        lst = vp.prop(vp.prop(n, "Outputs"), "List")
        for i, x in enumerate(list(lst or [])):
            log("%s    out[%d] = %s" % (pad, i, operand(x)))
        return
    log("%s  (unknown item kind)" % head)


try:
    src = (os.environ.get("VOLT_PROBE_PROJECT") or "").strip()
    wanted = {}
    for part in (os.environ.get("VOLT_PROBE_NETS") or "").split(";"):
        if ":" in part:
            pou, nums = part.split(":", 1)
            wanted[pou.strip()] = [int(x) for x in nums.split(",") if x.strip()]
    if not src or not os.path.exists(src) or not wanted:
        log("set VOLT_PROBE_PROJECT and VOLT_PROBE_NETS (got %r, %r)" % (src, wanted))
    else:
        objmgr = vp.object_manager()
        proj = vp.open_copy(projects, src, "nwl-oracle-rungs")   # noqa: F821 - injected by --runscript
        log("probe of: %s (a copy; the original is never opened)" % os.path.basename(src))
        for k in vp.walk(proj):
            try:
                nm = str(k.get_name())
            except Exception:
                continue
            if nm not in wanted:
                continue
            nets = vp.nwl_read(objmgr, k)
            if nets is None:
                continue
            log("")
            log("=" * 78)
            log("POU %s  (%d networks)" % (nm, len(nets)))
            log("=" * 78)
            for i in wanted[nm]:
                net = nets[i]
                log("")
                log("-- NETWORK %d  title=%r label=%r comment=%r OutCommented=%r" % (
                    i, vp.prop(net, "Title"), vp.prop(net, "Label"), vp.prop(net, "Comment"), vp.prop(net, "OutCommented")))
                cnt = int(vp.prop(net, "NetworkItemCount") or 0)
                for j in range(cnt):
                    ok, tree = vp.call(net, "GetTree", [j])
                    if ok and tree is not None:
                        dump(tree, "  ", "tree[%d]" % j)
                ok, sp = vp.call(net, "GetSplitPoint", [0])
                if ok and sp is not None:
                    log("  SPLIT POINT present")
        log("")
        log("done")
        proj.close()
    done()
except SystemExit:
    done()
except Exception:
    done(error=True)
