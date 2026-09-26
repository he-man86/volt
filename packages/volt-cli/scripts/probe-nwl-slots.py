# THE OUTPUT-SLOT QUESTION (openspec network-text-literal-nwl, task 1.6 / review 7.3): when a box is CONSUMED -
# nested as an assign's value, a box input, a Demux or Parallel input - WHICH of its output slots is its consumer
# wired to? NWL stores the nesting and not the answer, so the answer is taken from the vendor's own word: its
# PLCopen export, where every consumer names the output it reads (`<connection refLocalId=.. formalParameter=..>`).
#
# Side A counts every consumed box in NWL (enabled?, MainOutputIndex, parent, language). Side B exports every POU
# that holds one and tallies, per consumed BLOCK, the formalParameter its consumers read - split by whether the
# block has an EN input and by where that parameter sits among the block's outputs. The v2 text depends on two
# answers: is an enabled box EVER read by something other than ENO (then "no suffix = main output" is real), and
# is a box without EN ever read by an output other than its main one (then the marker route is exercised).
#
#   $env:VOLT_PROBE_PROJECTS = "<a.project>;<b.project>"; $env:VOLT_PROBE_LOG = "...\nwl-slots.log"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-nwl-slots.py"'
#
# Every project is COPIED first (vp.open_copy). ASCII ONLY - IronPython 2.7.
import os
import re
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("nwl-slots.log")

C = {}
EX = {}


def bump(k, ex=None):
    C[k] = C.get(k, 0) + 1
    if ex is not None and k not in EX:
        EX[k] = ex


def kind(n):
    return n.GetType().Name if hasattr(n, "GetType") else type(n).__name__


def enabled(n):
    # IronPython hands a CLR Boolean back as a python bool, which has no GetType - compare the text.
    return str(vp.prop(n, "En")) == "True"


DUMPED = [0]


def walk(n, where, lang, depth, parent):
    if n is None:
        return
    tn = kind(n)
    if tn.startswith("BoxTreeBox"):
        consumed = depth > 0
        if consumed:
            bt = str(vp.prop(n, "BoxType") or "")
            outs = vp.prop(n, "Outputs")
            lst = vp.prop(outs, "List") if outs is not None else None
            occ = "".join("n" if x is None else ("e" if not str(vp.prop(x, "OperandExpr") or "") else "R")
                          for x in (lst or []))
            onames = []
            try:
                onames = [str(x) for x in (vp.prop(vp.prop(n, "OutputParams"), "Names") or [])]
            except Exception:
                pass
            bump("A %s consumed box, parent=%s En=%s Eno=%s MainOutputIndex=%s slots=%s slot0=%s"
                 % (lang, parent, enabled(n), str(vp.prop(n, "Eno")) == "True", vp.prop(n, "MainOutputIndex"), occ,
                    (onames[0].strip() or "''") if onames else "-"), "%s %s %r" % (where, bt, onames))
            if DUMPED[0] < 2 and enabled(n):
                DUMPED[0] += 1
                log("dump of a consumed enabled box at %s (%s):" % (where, bt))
                vp.dump(n, log)
        try:
            for x in list(vp.prop(n, "InputItemList") or []):
                walk(x, where, lang, depth + 1, "Box.input")
        except Exception:
            pass
        return
    if tn.startswith("BoxTreeAssign"):
        walk(vp.prop(n, "RValue"), where, lang, depth + 1, "Assign")
        return
    if tn.startswith("BoxTreeDemux"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Demux")
        return
    if tn.startswith("BoxTreeParallel"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Parallel.IN")
        try:
            for x in list(vp.prop(n, "Trees") or []):
                walk(x, where, lang, depth + 1, "Parallel.branch")
        except Exception:
            pass
        return
    if tn.startswith("BoxTreeTerminator"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Terminator")


def plcopen(proj, obj, pou):
    """Side B: the vendor's own statement of which output each consumer reads."""
    import System
    out = os.path.join(tempfile.gettempdir(), "volt-slots-%s.xml" % re.sub(r"[^A-Za-z0-9_]", "_", pou))
    if os.path.exists(out):
        os.remove(out)
    proj.export_xml([obj], out)
    doc = System.Xml.XmlDocument()
    doc.Load(out)
    blocks = {}
    for b in doc.SelectNodes("//*[local-name()='block']"):
        lid = b.GetAttribute("localId")
        ins = [v.GetAttribute("formalParameter") for v in
               b.SelectNodes("*[local-name()='inputVariables']/*[local-name()='variable']")]
        outs = [v.GetAttribute("formalParameter") for v in
                b.SelectNodes("*[local-name()='outputVariables']/*[local-name()='variable']")]
        blocks[lid] = (b.GetAttribute("typeName"), ins, outs)
    for c in doc.SelectNodes("//*[local-name()='connection']"):
        ref = c.GetAttribute("refLocalId")
        if ref not in blocks:
            continue
        tn, ins, outs = blocks[ref]
        fp = c.GetAttribute("formalParameter")
        hasen = "EN" in [i.upper() for i in ins]
        pos = outs.index(fp) if fp in outs else -1
        # the consumer is the element that owns the connectionPointIn
        owner = c.ParentNode
        while owner is not None and owner.LocalName in ("connectionPointIn", "connection", "variable",
                                                         "inputVariables", "inOutVariables"):
            owner = owner.ParentNode
        cons = owner.LocalName if owner is not None else "?"
        what = "ENO" if fp.upper() == "ENO" else ("(none)" if not fp else "output #%d of %d" % (pos, len(outs)))
        haseno = "ENO" in [o.upper() for o in outs]
        bump("B %s/%s-block read by %s via %s" % ("EN" if hasen else "noEN", "ENO" if haseno else "noENO", cons, what),
             "%s %s(%s)->%s" % (pou, tn, ",".join(outs), fp))


try:
    srcs = vp.projects_from_env()
    if not srcs:
        log("VOLT_PROBE_PROJECTS not set")
        raise SystemExit
    objmgr = vp.object_manager()
    for idx, src in enumerate(srcs):
        log("=== %s" % os.path.basename(src))
        proj = vp.open_copy(projects, src, "nwl-slots-%d" % idx)
        pous = {}
        for k in vp.walk(proj):
            try:
                nm = str(k.get_name())
            except Exception:
                continue
            u = vp.unwrap(k)
            g = vp.prop(u, "guid")
            if g is None:
                continue
            try:
                meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, g)
                impl = vp.prop(vp.prop(meta, "Object"), "Implementation")
                nl = vp.prop(impl, "NetworkList") if impl is not None else None
            except Exception:
                continue
            if nl is None:
                continue
            # LD and FBD share one network model; the vendor names the editor in DefaultViewMode (as the driver reads it).
            lang = str(vp.prop(impl, "DefaultViewMode") or "?").upper()
            before = sum(v for k2, v in C.items() if k2.startswith("A "))
            for i in range(len(nl)):
                net = nl[i]
                for j in range(int(vp.prop(net, "NetworkItemCount") or 0)):
                    ok, tree = vp.call(net, "GetTree", [j])
                    if ok and tree is not None:
                        walk(tree, "%s net%d" % (nm, i), lang, 0, "top")
            if sum(v for k2, v in C.items() if k2.startswith("A ")) > before:
                pous[nm] = k
        log("POUs with a consumed box: %d" % len(pous))
        for nm, obj in sorted(pous.items()):
            try:
                plcopen(proj, obj, nm)
            except Exception:
                bump("B export threw", nm + ": " + traceback.format_exc().splitlines()[-1][:80])
        proj.close()
    log("")
    for k in sorted(C):
        log("%-100s %5d   e.g. %s" % (k, C[k], EX.get(k, "")))
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
