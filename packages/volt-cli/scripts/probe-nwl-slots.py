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
# Sides A and B are TALLIES, each side on its own: they do not say the two sides agree on any one connection.
# Side C does. It pairs each NWL box with the export block it is (same POU, same network, same type and instance,
# the n-th of that key in the network on both sides) and checks, connection by connection, that the output the
# export names IS the box's MainOutputIndex. Where the export names no output it says so and is counted apart: an
# LD coil fed by several branches (a wired OR) lists every incoming connection with the COIL's variable as its
# formalParameter, so the export does not state the slot for those, and no agreement is claimed for them.
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
# (pou, network) -> every box of the network, inputs before their box: [key, consumed, MainOutputIndex, names]
NETS = {}
# pou -> its NWL network count, to check the export's network split lines up before pairing anything
NWLCOUNT = {}


def box_key(bt, inst):
    return "%s|%s" % (bt.strip().upper(), inst.strip().upper())


def record(n, net, consumed):
    names = []
    try:
        names = [str(x) for x in (vp.prop(vp.prop(n, "OutputParams"), "Names") or [])]
    except Exception:
        pass
    ins = vp.prop(n, "Instance")
    inst = str(vp.prop(ins, "OperandExpr") or "") if ins is not None else ""
    mio = vp.prop(n, "MainOutputIndex")
    NETS.setdefault(net, []).append([box_key(str(vp.prop(n, "BoxType") or ""), inst), consumed,
                                     None if mio is None else int(mio), names])


def walk(n, where, lang, depth, parent, net):
    if n is None:
        return
    tn = kind(n)
    if tn.startswith("BoxTreeBox"):
        consumed = depth > 0
        # Inputs first: the export lists a block after the blocks feeding it, and pairing by order needs one order.
        try:
            for x in list(vp.prop(n, "InputItemList") or []):
                walk(x, where, lang, depth + 1, "Box.input", net)
        except Exception:
            pass
        record(n, net, consumed)
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
        return
    if tn.startswith("BoxTreeAssign"):
        walk(vp.prop(n, "RValue"), where, lang, depth + 1, "Assign", net)
        return
    if tn.startswith("BoxTreeDemux"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Demux", net)
        return
    if tn.startswith("BoxTreeParallel"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Parallel.IN", net)
        try:
            for x in list(vp.prop(n, "Trees") or []):
                walk(x, where, lang, depth + 1, "Parallel.branch", net)
        except Exception:
            pass
        return
    if tn.startswith("BoxTreeTerminator"):
        walk(vp.prop(n, "Input"), where, lang, depth + 1, "Terminator", net)


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
    agree(doc, pou)


def agree(doc, pou):
    """Side C: pair each export block with the NWL box it is, and check every connection to a consumed one."""
    body = None
    for b in doc.SelectNodes("//*[local-name()='body']"):
        if b.ParentNode is not None and b.ParentNode.GetAttribute("name") == pou:
            body = b
            break
    if body is None:
        bump("C export has no body named for its POU - not paired", pou)
        return
    graph = None
    for ch in body.ChildNodes:
        if ch.LocalName in ("LD", "FBD"):
            graph = ch
    if graph is None:
        bump("C body is neither LD nor FBD - not paired", pou)
        return
    # The vendor opens every LD network with a `networktitle` vendorElement; a block after the n-th is in network
    # n. Not every export has them (an FBD action body does not), and a split that does not line up with the NWL
    # network count is not trusted: then the scope is the whole POU - both sides list blocks in network order.
    net, blocks = -1, []
    for el in graph.ChildNodes:
        if el.LocalName == "vendorElement" and "networktitle" in (el.InnerXml or ""):
            net += 1
            continue
        if el.LocalName == "block":
            outs = [v.GetAttribute("formalParameter") for v in
                    el.SelectNodes("*[local-name()='outputVariables']/*[local-name()='variable']")]
            blocks.append((net, el.GetAttribute("localId"),
                           box_key(el.GetAttribute("typeName"), el.GetAttribute("instanceName")), outs))
    per_net = NWLCOUNT.get(pou) == net + 1
    if NWLCOUNT.get(pou, -1) < 0:
        ids = set(b[1] for b in blocks)
        for c in graph.SelectNodes(".//*[local-name()='connection']"):
            if c.GetAttribute("refLocalId") in ids:
                bump("C connection in a POU whose name two objects share - not paired", pou)
        return
    scope = "network" if per_net else "POU"
    if not per_net:
        bump("C network split does not line up (export titles vs NWL) - paired over the whole POU",
             "%s %s vs %s" % (pou, net + 1, NWLCOUNT.get(pou)))
    nwl = {}
    for (p, n), lst in sorted(NETS.items()):
        if p == pou:
            for b in lst:
                nwl.setdefault((n if per_net else None, b[0]), []).append(b)
    xblocks, order = {}, {}
    for n, lid, k, outs in blocks:
        lst = xblocks.setdefault((n if per_net else None, k), [])
        order[lid] = (n if per_net else None, k, len(lst), outs)
        lst.append(lid)
    for c in graph.SelectNodes(".//*[local-name()='connection']"):
        ref = c.GetAttribute("refLocalId")
        if ref not in order:
            continue
        n, k, idx, outs = order[ref]
        boxes = nwl.get((n, k), [])
        if len(boxes) != len(xblocks[(n, k)]):
            bump("C connection to a %s block whose key count differs between the sides - not paired" % k.split("|")[0],
                 "%s net%s %s nwl=%d export=%d" % (pou, n, k, len(boxes), len(xblocks[(n, k)])))
            continue
        key, consumed, mio, names = boxes[idx]
        how = ("unique" if len(boxes) == 1 else "by order") + " in its " + scope
        fp = c.GetAttribute("formalParameter")
        if not consumed:
            bump("C connection to a TOP-LEVEL box (a result pin, not a consumer slot)", "%s net%s %s->%s" % (pou, n, k, fp))
            continue
        if fp not in outs:
            nm = names[mio] if mio is not None and mio < len(names) else "?"
            bump("C export names no output (an LD join names the coil): MainOutputIndex=%s (%s) of %d output(s)"
                 % (mio, nm.strip() or "''", len(outs)), "%s net%s %s->%s" % (pou, n, k, fp))
            continue
        pos = outs.index(fp)
        if mio is None:
            bump("C operator box (NWL stores no MainOutputIndex), export reads output #%d of %d" % (pos, len(outs)),
                 "%s net%s %s->%s" % (pou, n, k, fp))
        elif pos == mio:
            bump("C AGREES: export output #%d = MainOutputIndex, paired %s" % (pos, how),
                 "%s net%s %s(%s)->%s" % (pou, n, k, ",".join(outs), fp))
        else:
            bump("C DISAGREES: export output #%d, MainOutputIndex %d, paired %s" % (pos, mio, how),
                 "%s net%s %s(%s)->%s" % (pou, n, k, ",".join(outs), fp))


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
                        walk(tree, "%s net%d" % (nm, i), lang, 0, "top", (nm, i))
            # Two objects of one name (a method in two FBs) cannot be told apart by name: pair neither.
            NWLCOUNT[nm] = -1 if nm in NWLCOUNT else len(nl)
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
