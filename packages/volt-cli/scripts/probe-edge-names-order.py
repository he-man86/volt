# R_EDGE / F_EDGE (openspec network-text-literal-nwl, task 1.14; review 7.12). Network text spells an operand's
# edge flag as the call `R_EDGE(x)` / `F_EDGE(x)`, so two vendor facts decide whether that is safe:
#
#   A  NAMES - can a POU, an FB instance or a variable be CALLED R_EDGE / F_EDGE on SP21? If one can, a body that
#      calls it would read back as an edge flag; the text needs a way to say "the POU, not the flag".
#   B  ORDER - when one operand carries Negation AND an edge bit, which does the vendor evaluate first? The text
#      has ONE order, `NOT R_EDGE(x)`; if the vendor computes R_EDGE(NOT x), that spelling states other logic.
#      Measured by RUNNING it: an FBD block whose outputs are such operands, driven through a fixed input
#      sequence in simulation, compared against every order's truth table.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-edge-names-order.py"'
#
# ASCII ONLY.
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("edge-names-order.log")

PRG_DECL = "PROGRAM PLC_PRG\nVAR\n%s\nEND_VAR\n"

# ---- A: names ------------------------------------------------------------------------------------------------
# (label, pou to create (name, kind, decl, body) or None, PLC_PRG var lines, PLC_PRG body). The first case must
# NOT be clean: a probe whose build never reports anything would log CLEAN for every case.
NAME_CASES = [
    ("control: an error", None, "  q : BOOL;", "q := zz;"),
    ("a FUNCTION named R_EDGE, called",
     ("R_EDGE", "function", "FUNCTION R_EDGE : BOOL\nVAR_INPUT\n  i : BOOL;\nEND_VAR\n", "R_EDGE := i;"),
     "  q : BOOL;\n  a : BOOL;", "q := R_EDGE(a);"),
    ("a FUNCTION named F_EDGE, called",
     ("F_EDGE", "function", "FUNCTION F_EDGE : BOOL\nVAR_INPUT\n  i : BOOL;\nEND_VAR\n", "F_EDGE := i;"),
     "  q : BOOL;\n  a : BOOL;", "q := F_EDGE(a);"),
    ("an FB named R_EDGE, instantiated",
     ("R_EDGE", "fb", "FUNCTION_BLOCK R_EDGE\nVAR_INPUT\n  i : BOOL;\nEND_VAR\n", ";"),
     "  inst : R_EDGE;", "inst(i := TRUE);"),
    ("an instance named R_EDGE", None, "  R_EDGE : TON;", "R_EDGE(IN := TRUE, PT := T#1S);"),
    ("a variable named F_EDGE", None, "  F_EDGE : BOOL;", "F_EDGE := TRUE;"),
    ("the IEC qualifier (x : BOOL R_EDGE)", None, "  q : BOOL;", "q := TRUE;"),
]

# ---- B: order ------------------------------------------------------------------------------------------------
XS = [False, False, True, True, False, False, True, False]
OUTS = [("neg_rtrig", ("Negation", "Rtrig")), ("neg_ftrig", ("Negation", "Ftrig")),
        ("rtrig", ("Rtrig",)), ("ftrig", ("Ftrig",)), ("neg", ("Negation",))]


def edges(seq, rising):
    """An edge detector with its memory starting FALSE, as IEC R_TRIG/F_TRIG do."""
    out, m = [], False
    for v in seq:
        out.append((v and not m) if rising else (m and not v))
        m = v
    return out


def NOT(s):
    return [not v for v in s]


NX = NOT(XS)
ORDERS = {
    "NOT R_EDGE(x)": NOT(edges(XS, True)), "R_EDGE(NOT x)": edges(NX, True),
    "NOT F_EDGE(x)": NOT(edges(XS, False)), "F_EDGE(NOT x)": edges(NX, False),
    "R_EDGE(x)": edges(XS, True), "F_EDGE(x)": edges(XS, False), "NOT x": NX,
}


def bits(seq):
    return "".join("1" if v else "0" for v in seq)


def order_fb(impl):
    lst = vp.prop(impl, "NetworkList")
    while len(lst) < len(OUTS):
        vp.call(impl, "AppendNetwork", [vp.nwl_new(impl, "Network")])
        lst = vp.prop(impl, "NetworkList")
    for i, (out, flags) in enumerate(OUTS):
        net = lst[i]
        for j in range(int(vp.prop(net, "NetworkItemCount") or 0) - 1, -1, -1):
            vp.call(net, "RemoveNetworkItem", [j])
        op = vp.nwl_new(net, "Operand", "x")
        for b in flags:
            vp.nwl_set(vp.prop(op, "Flags"), b, True)
        asg = vp.nwl_new(net, "BoxTreeAssign")
        vp.nwl_set(asg, "RValue", vp.nwl_new(net, "BoxTreeOperand", op))
        vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [vp.nwl_new(net, "Operand", out)])
        vp.call(net, "AppendTree", [asg])


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "edge-names-order")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]

    log("=== A: can a POU, an instance or a variable take the name? ===")
    for label, pou, decl, body in NAME_CASES:
        made = None
        log(label)
        if pou is not None:
            name, kind, pdecl, pbody = pou
            try:
                if kind == "function":
                    made = app.create_pou(name=name, type=PouType.Function, language=ImplementationLanguages.st,
                                          return_type="BOOL")
                else:
                    made = app.create_pou(name=name, type=PouType.FunctionBlock, language=ImplementationLanguages.st)
                made.textual_declaration.replace(pdecl)
                made.textual_implementation.replace(pbody + "\n")
                log("   object tree: created %s %r" % (kind, name))
            except Exception as e:
                log("   object tree: REFUSED %s %r: %s" % (kind, name, e))
                continue
        if "qualifier" in label:
            prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR_INPUT\n  x : BOOL R_EDGE;\nEND_VAR\nVAR\n%s\nEND_VAR\n" % decl)
        else:
            prg.textual_declaration.replace(PRG_DECL % decl)
        prg.textual_implementation.replace(body + "\n")
        msgs = vp.build_messages(app, system, Severity)
        log("   build: %s" % ("CLEAN" if not msgs else ""))
        for m in msgs:
            log("      " + m)
        if made is not None:
            made.remove()

    log("")
    log("=== B: Negation + an edge bit on ONE operand - which order does the vendor evaluate? ===")
    fb = app.create_pou(name="FB_EdgeOrder", type=PouType.FunctionBlock, language=ImplementationLanguages.fbd)
    fb.textual_declaration.replace("FUNCTION_BLOCK FB_EdgeOrder\nVAR_INPUT\n  x : BOOL;\nEND_VAR\nVAR_OUTPUT\n%s\nEND_VAR\n"
                                   % "\n".join(["  %s : BOOL;" % o for o, _ in OUTS]))
    vp.nwl_edit(objmgr, fb, order_fb)
    back = vp.nwl_read(objmgr, fb)
    for i in range(len(back)):
        ok, tree = vp.call(back[i], "GetTree", [0])
        op = vp.prop(vp.prop(tree, "RValue"), "Operand") if ok and tree is not None else None
        fl = vp.prop(op, "Flags") if op is not None else None
        held = [b for b in ("Negation", "Rtrig", "Ftrig") if fl is not None and vp.prop(fl, b)]
        log("   network %d held: %s := x %s" % (i, OUTS[i][0], "+".join(held) or "(no flags)"))
    n = len(XS)
    arrs = "\n".join(["  r_%s : ARRAY[0..%d] OF BOOL;" % (o, n - 1) for o, _ in OUTS])
    prg.textual_declaration.replace(PRG_DECL % ("  fb : FB_EdgeOrder;\n  i : INT;\n  oracleDone : BOOL;\n"
                                                "  xs : ARRAY[0..%d] OF BOOL := [%s];\n%s"
                                                % (n - 1, ", ".join(["TRUE" if v else "FALSE" for v in XS]), arrs)))
    prg.textual_implementation.replace(
        "IF NOT oracleDone THEN\n  FOR i := 0 TO %d DO\n    fb(x := xs[i]);\n%s  END_FOR\n  oracleDone := TRUE;\nEND_IF\n"
        % (n - 1, "".join(["    r_%s[i] := fb.%s;\n" % (o, o) for o, _ in OUTS])))
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
    dev = app
    while dev is not None:
        try:
            dev.set_simulation_mode(True)
            break
        except Exception:
            dev = dev.parent
    oa = online.create_online_application(app)
    oa.login(OnlineChangeOption.Force, True)
    oa.start()
    t0 = time.time()
    while time.time() - t0 < 30 and not str(oa.read_value("PLC_PRG.oracleDone")).upper().endswith("TRUE"):
        time.sleep(0.05)
    log("   x sequence                  %s" % bits(XS))
    for o, flags in OUTS:
        got = [str(oa.read_value("PLC_PRG.r_%s[%d]" % (o, k))).upper().endswith("TRUE") for k in range(n)]
        match = [name for name, seq in sorted(ORDERS.items()) if seq == got]
        log("   %-10s %-16s %s  = %s" % (o, "+".join(flags), bits(got), ", ".join(match) or "NO ORDER MATCHES"))
    log("   (orders: %s)" % "; ".join(["%s=%s" % (k, bits(v)) for k, v in sorted(ORDERS.items())]))
    oa.stop()
    oa.logout()
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
