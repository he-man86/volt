# THE NETWORK-TEXT V2 CENSUS (openspec network-text-literal-nwl, tasks section 1): every fact the new
# spelling depends on, counted across EVERY network of a real project - not one dumped example.
#
#   pwsh> $env:VOLT_PROBE_PROJECT="...\Some.project"; $env:VOLT_PROBE_LOG="...\census.log"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-census-v2.py"
#
# The project is COPIED first and the original is never opened. ASCII ONLY - CODESYS compiles this as
# ASCII IronPython 2.7 and one non-ASCII byte is a SyntaxError before line 1 runs.
import os
import re
import tempfile
import traceback
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-census-v2.log")
SRC = os.environ.get("VOLT_PROBE_PROJECT") or ""

f = open(LOG, "w")
def log(s):
    f.write(str(s) + "\n"); f.flush()

FLAGBITS = ("Negation", "Set", "Jump", "Return", "Rtrig", "Ftrig")
OPERATORS = set("AND OR XOR NOT ADD SUB MUL DIV MOD GT GE LT LE EQ NE MOVE SEL MUX LIMIT MIN MAX SHL SHR ROL ROR".split())
TOKEN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")

C = {}
EX = {}
def bump(k, ex=None):
    C[k] = C.get(k, 0) + 1
    if ex is not None and k not in EX:
        EX[k] = ex

def bits(fl):
    out = []
    if fl is None:
        return out
    for b in FLAGBITS:
        try:
            if vp.prop(fl, b):
                out.append(b)
        except Exception:
            pass
    return out

def names_of(obj, member):
    ip = vp.prop(obj, member)
    if ip is None:
        return None
    try:
        return [str(x) for x in (vp.prop(ip, "Names") or [])]
    except Exception:
        return None

def operand_text(o):
    if o is None:
        return None
    try:
        return str(vp.prop(o, "OperandExpr") or "")
    except Exception:
        return None

def kind(n):
    return n.GetType().Name if n is not None else "null"

def producer(n):
    k = kind(n)
    if k.startswith("BoxTreeOperand"):
        t = operand_text(vp.prop(n, "Operand")) or ""
        if t.upper() in ("TRUE", "FALSE"):
            return "Operand(literal bool)"
        return "Operand(variable)"
    if k.startswith("BoxTreeBox"):
        return "Box(%s)" % (str(vp.prop(n, "BoxType") or "?"))
    return k

JUMP_TARGETS = []
LABELS = []

def walk(n, where, depth, parent):
    if n is None:
        return
    tn = kind(n)
    ib = bits(vp.prop(n, "Flags"))
    for b in ib:
        bump("1.1 item flag %s on %s (depth %s)" % (b, tn, "0" if depth == 0 else ">0"), where)
    if "Rtrig" in ib and "Ftrig" in ib:
        bump("7.8 item Rtrig+Ftrig together on %s" % tn, where)

    if tn.startswith("BoxTreeOperand"):
        op = vp.prop(n, "Operand")
        ob = bits(vp.prop(op, "Flags"))
        for b in ob:
            bump("7.12 operand flag %s (parent %s)" % (b, parent), where)
        if "Rtrig" in ob and "Ftrig" in ob:
            bump("7.8 operand Rtrig+Ftrig together", where)
        t = operand_text(op) or ""
        if "`" in t:
            bump("7.4 operand text holds a backtick", where)
        if t and not TOKEN.match(t) and not re.match(r"^[0-9]", t) and "#" not in t and t != "???":
            bump("opaque operand text (not a token)", where + ": " + t[:40])
        return

    if tn.startswith("BoxTreeBox"):
        bt = str(vp.prop(n, "BoxType") or "")
        inst = operand_text(vp.prop(n, "Instance")) or ""
        if inst and not TOKEN.match(inst) and inst != "???":
            bump("1.12 instance text not a token", where + ": " + inst[:40])
        ins = names_of(n, "InputParams")
        outs_names = names_of(n, "OutputParams")
        if bt.upper() in OPERATORS:
            bump("1.5 operator %s InputParams.Names=%r" % (bt.upper(), ins), where)
        # 7.1 per-pin flags - the CODESYS field the reader never reads
        iflags = vp.prop(n, "InputFlags")
        if iflags is None:
            bump("7.1 InputFlags member = null", where)
        else:
            try:
                lst = list(iflags)
                bump("7.1 InputFlags present, len=%d" % len(lst), where)
                items = list(vp.prop(n, "InputItemList") or [])
                for i, fl in enumerate(lst):
                    fb = bits(fl)
                    feed = kind(items[i]) if i < len(items) else "past-end"
                    for b in fb:
                        bump("7.1 PIN FLAG %s on %s input %d fed by %s" % (b, bt, i, feed), where)
                        # the question that decides data loss today: is the SAME bit also on the feeding
                        # operand (which the reader reads), or ONLY on the pin (which it drops)?
                        if i < len(items) and feed.startswith("BoxTreeOperand"):
                            ofb = bits(vp.prop(vp.prop(items[i], "Operand"), "Flags"))
                            ifb = bits(vp.prop(items[i], "Flags"))
                            bump("7.1 pin %s ALSO on operand=%s item=%s" % (b, b in ofb, b in ifb),
                                 where + ": " + (operand_text(vp.prop(items[i], "Operand")) or ""))
            except Exception:
                bump("7.1 InputFlags not enumerable (%s)" % kind(iflags), where)
        mo = vp.prop(n, "MainOutputIndex")
        bump("7.3 MainOutputIndex=%s (%s)" % (mo, "operator" if bt.upper() in OPERATORS else "call"), where)
        outs = vp.prop(n, "Outputs")
        lst = vp.prop(outs, "List") if outs is not None else None
        if lst is not None:
            occ = "".join("n" if x is None else ("e" if not operand_text(x) else "R") for x in lst)
            bump("7.3 output slots pattern %s" % occ, where)
            for x in lst:
                if x is not None:
                    for b in bits(vp.prop(x, "Flags")):
                        bump("box output flag %s" % b, where)
        en = vp.prop(n, "En")
        enabled = (kind(en) == "Boolean" and bool(en))
        snip = vp.prop(n, "STSnippet")
        if snip is not None:
            bump("1.11 execute box at %s (depth %d, enabled=%s)" % (parent, depth, enabled), where)
        if depth > 0 or parent == "Assign.RValue":
            bump("1.6 consumed box (parent %s) enabled=%s" % (parent, enabled), where)
        elif lst is not None and any(x is not None and operand_text(x) for x in lst):
            bump("1.6 top-level box with a wired output pin", where)
        try:
            for x in list(vp.prop(n, "InputItemList") or []):
                walk(x, where, depth + 1, "Box.input")
        except Exception:
            pass
        return

    if tn.startswith("BoxTreeAssign"):
        rv = vp.prop(n, "RValue")
        if rv is None:
            bump("1.2 Assign with RValue null", where)
        elif kind(rv).startswith("BoxTreeTerminator") and vp.prop(rv, "Input") is None:
            bump("1.2 Assign with RValue Terminator(null)", where)
        outs = vp.prop(n, "Outputs")
        lst = vp.prop(outs, "List") if outs is not None else None
        targets = [x for x in (lst or []) if x is not None]
        bump("assign targets=%d" % len(targets), where)
        storages = set()
        jumps = 0
        for x in targets:
            tb = bits(vp.prop(x, "Flags"))
            for b in tb:
                bump("1.7 target flag %s" % b, where)
            if "Jump" in tb:
                jumps += 1
                JUMP_TARGETS.append((where, operand_text(x)))
            if "Return" in tb:
                jumps += 1
            if "Negation" in tb and "Set" not in tb:
                bump("1.7 negation-only coil", where)
            storages.add("S" if "Set" in tb and "Negation" not in tb else ("R" if "Set" in tb else "="))
        if len(storages) > 1:
            bump("mixed storage multi-target assign", where)
        if jumps and len(targets) > 1:
            bump("coil+jump or two jumps on one rung", where)
        walk(rv, where, depth + 1, "Assign.RValue")
        return

    if tn.startswith("BoxTreeDemux"):
        inp = vp.prop(n, "Input")
        if inp is None:
            bump("1.8 demux reference (depth %s)" % ("0" if depth == 0 else ">0"), where)
        else:
            bump("1.8 demux DEFINITION at depth %s" % ("0" if depth == 0 else ">0"), where)
            bump("WIRE TYPE producer %s" % producer(inp), where)
            walk(inp, where, depth + 1, "Demux.Input")
        return

    if tn.startswith("BoxTreeParallel"):
        inp = vp.prop(n, "Input")
        trees = []
        try:
            trees = list(vp.prop(n, "Trees") or [])
        except Exception:
            pass
        bump("1.3 parallel Mode=%s fed=%s branches=%d" % (vp.prop(n, "Mode"), inp is not None, len(trees)), where)
        walk(inp, where, depth + 1, "Parallel.Input")
        for x in trees:
            walk(x, where, depth + 1, "Parallel.branch")
        return

    if tn.startswith("BoxTreeTerminator"):
        inp = vp.prop(n, "Input")
        if inp is not None:
            bump("1.4 TERMINATOR WITH INPUT (%s)" % kind(inp), where)
            walk(inp, where, depth + 1, "Terminator.Input")
        else:
            bump("terminator without input (parent %s)" % parent, where)
        return

    bump("OTHER item kind %s" % tn, where)

try:
    import clr, System, shutil
    if not SRC or not os.path.exists(SRC):
        log("VOLT_PROBE_PROJECT missing: %r" % SRC); raise SystemExit
    objmgr = vp.object_manager()
    if objmgr is None:
        log("ObjectMgr NOT reachable"); raise SystemExit
    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-census-v2.project")
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
            u = vp.unwrap(k); g = vp.prop(u, "guid")
            if g is not None:
                try:
                    meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, g)
                    iobj = vp.prop(meta, "Object")
                    impl = vp.prop(iobj, "Implementation") if iobj is not None else None
                    nl = vp.prop(impl, "NetworkList") if impl is not None else None
                    if nl is not None:
                        pous[0] += 1
                        bump("POU implementation %s" % kind(impl), nm)
                        body_labels = {}
                        for i in range(len(nl)):
                            net = nl[i]; nets[0] += 1
                            where = "%s net%d" % (nm, i)
                            label = str(vp.prop(net, "Label") or "")
                            title = str(vp.prop(net, "Title") or "")
                            comment = str(vp.prop(net, "Comment") or "")
                            disabled = bool(vp.prop(net, "OutCommented"))
                            if disabled:
                                bump("network DISABLED", where)
                            if label:
                                bump("network LABEL", where)
                                key = label.upper()
                                if key in body_labels:
                                    bump("DUPLICATE LABEL in one body", where + " = " + label)
                                body_labels[key] = disabled
                                LABELS.append((nm, label, disabled))
                                if disabled:
                                    bump("LABEL on a DISABLED network", where + " = " + label)
                            if "\n" in title or "\r" in title:
                                bump("7.4 TITLE holds a newline", where)
                            if comment:
                                lines = comment.replace("\r\n", "\n").split("\n")
                                bump("network comment (lines=%s)" % ("1" if len(lines) == 1 else ">1"), where)
                                if any(l.strip() == "" for l in lines[1:-1]):
                                    bump("comment with an inner blank line", where)
                                if any(l.startswith(" ") or l.startswith("\t") for l in lines):
                                    bump("comment with leading indentation", where)
                                if any(l.lstrip().startswith("//") for l in lines):
                                    bump("comment line starting with //", where)
                                if any(l != l.rstrip() for l in lines):
                                    bump("comment with trailing whitespace", where)
                            cnt = int(vp.prop(net, "NetworkItemCount") or 0)
                            for j in range(cnt):
                                ok, tree = vp.call(net, "GetTree", [j])
                                if ok and tree is not None:
                                    walk(tree, where, 0, "top")
                            ok, sp = vp.call(net, "GetSplitPoint", [0])
                            if ok and sp is not None:
                                bump("vendor split point present", where)
                        for (w, target) in [jt for jt in JUMP_TARGETS if jt[0].startswith(nm + " ")]:
                            t = (target or "").upper()
                            if t and t not in body_labels:
                                bump("JMP to a label missing in the body", w + " -> " + str(target))
                            elif t and body_labels.get(t):
                                bump("JMP to a label on a DISABLED network", w + " -> " + str(target))
                except Exception:
                    bump("POU walk threw", nm + ": " + traceback.format_exc().splitlines()[-1])
            visit(k, depth + 1)
    visit(proj, 0)
    log("POUs with networks: %d   networks: %d" % (pous[0], nets[0]))
    log("")
    for k in sorted(C):
        log("%-70s %6d   e.g. %s" % (k, C[k], EX.get(k, "")))
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
