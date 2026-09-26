# THE ENO OUTPUT OF A BOX VOLT BUILDS (openspec network-text-literal-nwl, task 4.1; spec "EN is a pin, ENO is
# spelled"). Census 1.6 (DIALECT N16) measured the boxes ENGINEERS drew: EN and ENO are independent - 40 enabled
# comparisons (GT with EN wired) have ONE output and no ENO, while MOVE/ADD/calls showing EN/ENO list ENO first.
# The push has to refuse `.ENO` on a box "the IDE gives no ENO output" and a suffix-less consumer of a box whose
# main output is ENO - which needs to know what the IDE does with a box VOLT constructs:
#
#   1. Does the vendor derive OutputParams (the ENO slot) from BoxType + En on its own - at construction, on commit,
#      or on a build? (probe-nwl-boxoutputs.log: not at construction, not on commit, for MOVE without EN.)
#   2. Does the build accept each shape the CODESYS writer can emit - an enabled GT with and without the ENO echo,
#      an enabled MOVE with and without it, consumed and top level? A shape the compiler rejects is one the IDE
#      "gives" differently from what Volt built.
#
# Each case is its own FBD PROGRAM, built alone (the others removed), so every build message belongs to one case.
# The first case is a control that MUST fail to build: a probe whose build never reports anything would log CLEAN
# for every case.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-nwl-eno-build.py"'
#
# ASCII ONLY - IronPython 2.7. (No variable may be named `st`: it is an IL operator, and a declaration stops
# parsing at it - every case failed on the first run that compiled them.)
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("nwl-eno-build.log")

DECL = ("PROGRAM %s\nVAR\n  a : INT := 1;\n  b : INT := 2;\n  c : BOOL := TRUE;\n  c2 : BOOL := TRUE;\n  out : BOOL;\n  lamp : BOOL;\n"
        "  sv : INT;\n  n : INT;\nEND_VAR\n")

# (name, what, consumed?, box type, enable?, eno echo?, inputs, output pins [(formal, operand)] in slot order)
CASES = [
    ("VltEno_Control", "control: an undeclared operand (must NOT build clean)", True, "GT", False, False,
     ["a", "zz"], []),
    ("VltEno_GtNoEcho", "out := GT(EN := c, a, b)   - enabled GT, no ENO echo (the 40 drawn comparisons)", True,
     "GT", True, False, ["a", "b"], []),
    ("VltEno_GtEcho", "out := GT(EN := c, a, b).ENO - enabled GT WITH the ENO echo", True, "GT", True, True,
     ["a", "b"], []),
    ("VltEno_MoveNoEcho", "lamp := MOVE(EN := c, 0, => sv) - enabled MOVE, no ENO echo, sv on slot 1", True, "MOVE",
     True, False, ["0"], [("", ""), ("", "sv")]),
    ("VltEno_MoveEcho", "lamp := MOVE(EN := c, 0, => sv).ENO - enabled MOVE WITH the ENO echo", True, "MOVE", True,
     True, ["0"], [("ENO", ""), ("", "sv")]),
    ("VltEno_AddEcho", "n := ADD(a, b).ENO - ADD without EN, WITH an ENO echo, consumed", True, "ADD", False, True,
     ["a", "b"], [("ENO", "")]),
    ("VltEno_TopMove", "MOVE(EN := c, 0, => sv); - top level, ENO echo, sv on slot 1", False, "MOVE", True, True,
     ["0"], [("ENO", ""), ("", "sv")]),
    ("VltEno_TopGt", "GT(EN := c, a, b, => out); - top level, ENO echo, out on slot 1", False, "GT", True, True,
     ["a", "b"], [("ENO", ""), ("", "out")]),
    ("VltEno_TopGtNoEcho", "GT(EN := c, a, b, => out); - top level, NO ENO echo, out on slot 0", False, "GT", True,
     False, ["a", "b"], [("", "out")]),
    # The DRAWN shape of an enabled comparison (census 1.6: `OutputParams.Names = ['']`), with and without the type
    # the vendor stores beside it - does an output-param entry make the consumed GT build? And an ENO echo in the
    # same shape.
    ("VltEno_GtTyped", "out := GT(EN := c, a, b) - enabled GT, OutputParams [''] typed BOOL (the drawn shape)", True,
     "GT", True, False, ["a", "b"], [("", "", "BOOL")]),
    ("VltEno_GtUntyped", "out := GT(EN := c, a, b) - enabled GT, OutputParams [''] untyped", True, "GT", True, False,
     ["a", "b"], [("", "", "")]),
    ("VltEno_GtEchoTyped", "out := GT(EN := c, a, b).ENO - enabled GT, OutputParams ['ENO', ''] typed BOOL", True,
     "GT", True, False, ["a", "b"], [("ENO", "", "BOOL"), ("", "", "BOOL")]),
    # Does the output LIST decide which output a consumed MOVE is read through? No ENO named, both slots typed.
    ("VltEno_MoveTypedNoEno", "lamp := MOVE(EN := c, 0, => sv) - OutputParams ['', ''] typed INT, no ENO name", True,
     "MOVE", True, False, ["0"], [("", "", "INT"), ("", "sv", "INT")]),
]


def names(box, member):
    pl = vp.prop(box, member)
    ns = vp.prop(pl, "Names") if pl is not None else None
    return None if ns is None else [str(x) for x in ns]


def outputs(box):
    lst = vp.prop(vp.prop(box, "Outputs"), "List")
    if lst is None:
        return None
    return [None if o is None else str(vp.prop(o, "OperandExpr")) for o in lst]


def describe(box):
    return ("OutputParams.Names=%s Types=%s MainOutputIndex=%s En=%s Eno=%s EnEno=%s Outputs=%s "
            "OutputPins=%s..%s" %
            (names(box, "OutputParams"), [str(x) for x in (vp.prop(vp.prop(box, "OutputParams"), "Types") or [])],
             vp.prop(box, "MainOutputIndex"), vp.prop(box, "En"), vp.prop(box, "Eno"), vp.prop(box, "EnEno"),
             outputs(box), vp.prop(box, "MinOutputPinCount"), vp.prop(box, "MaxOutputPinCount")))


def build_case(case):
    name, what, consumed, btype, enable, echo, inputs, pins = case

    def fn(impl):
        net = vp.prop(impl, "NetworkList")[0]

        def leaf(text):
            return vp.nwl_new(net, "BoxTreeOperand", vp.nwl_new(net, "Operand", text))

        # Exactly what CodesysNetworkWriter builds: BoxType, the instance operand emptied, EN as input slot 0 with
        # En/Eno set, the inputs, InputParams naming EN, then the output slots (the ENO echo an EMPTY operand).
        box = vp.nwl_new(net, "BoxTreeBox")
        vp.nwl_set(box, "BoxType", btype)
        vp.nwl_set(vp.prop(box, "Instance"), "OperandExpr", "")
        if enable:
            vp.call(box, "AppendInputItem", [leaf("c")])
            vp.nwl_set(box, "En", True)
            vp.nwl_set(box, "Eno", True)
        for i in inputs:
            vp.call(box, "AppendInputItem", [leaf(i)])
        if enable:
            pl = vp.prop(box, "InputParams")
            vp.call(pl, "AppendParam", ["EN", ""])
            for _ in inputs:
                vp.call(pl, "AppendParam", ["", ""])
        # A pin is (formal, operand) as the writer spells it - an OutputParams entry only when some slot is named -
        # or (formal, operand, type) for a case that writes the param list explicitly, typed as given.
        slots = [p if len(p) == 3 else (p[0], p[1], None) for p in pins]
        explicit = any(t is not None for _, _, t in slots)
        if echo and not any(f == "ENO" for f, _, _ in slots):
            slots = [("ENO", "", None)] + slots
        if slots:
            outs = vp.prop(box, "Outputs")
            for _, operand, _ in slots:
                vp.call(outs, "AppendOutputItem", [vp.nwl_new(net, "Operand", operand)])
            if explicit or any(f for f, _, _ in slots):
                opl = vp.prop(box, "OutputParams")
                for f, _, t in slots:
                    vp.call(opl, "AppendParam", [f, t or ""])
        log("   built:       " + describe(box))
        if consumed:
            asg = vp.nwl_new(net, "BoxTreeAssign")
            vp.nwl_set(asg, "RValue", box)
            target = "lamp" if btype == "MOVE" else ("n" if btype == "ADD" else "out")
            vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [vp.nwl_new(net, "Operand", target)])
            vp.call(net, "AppendTree", [asg])
        else:
            vp.call(net, "AppendTree", [box])

    return fn


def read_box(objmgr, pou, consumed):
    net = vp.nwl_read(objmgr, pou)[0]
    ok, tree = vp.call(net, "GetTree", [0])
    if not ok or tree is None:
        return None
    return vp.prop(tree, "RValue") if consumed else tree


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "nwl-eno-build")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\nEND_VAR\n")

    sample = None
    kept = []
    for case in CASES:
        name, what, consumed = case[0], case[1], case[2]
        log(name + ": " + what)
        pou = app.create_pou(name=name, type=PouType.Program, language=ImplementationLanguages.fbd)
        pou.textual_declaration.replace(DECL % name)
        vp.nwl_edit(objmgr, pou, build_case(case))
        box = read_box(objmgr, pou, consumed)
        log("   committed:   " + (describe(box) if box is not None else "NO BOX"))
        if sample is None and box is not None:
            sample = box
        # CALLED from PLC_PRG, or the build skips it: an unreferenced POU is not compiled (the control built
        # CLEAN on this probe's first run, when the cases were only created).
        prg.textual_implementation.replace("%s();\n" % name)
        msgs = vp.build_messages(app, system, Severity)
        log("   build:       %s" % ("CLEAN" if not msgs else ""))
        for m in msgs:
            log("      " + m)
        box = read_box(objmgr, pou, consumed)
        log("   after build: " + (describe(box) if box is not None else "NO BOX"))
        if msgs:
            pou.remove()
        else:
            kept.append(name)

    # WHICH OUTPUT A CONSUMER READS, by running it: a = 1, b = 2, c = TRUE, so a comparison answers FALSE while
    # its ENO answers TRUE, and MOVE's data output is 0 (FALSE) while its ENO is TRUE. A build only says the shape
    # compiles; it does not say what `out` is fed by.
    log("")
    log("=== run: what each clean case's consumer holds after one cycle (GT/MOVE data = FALSE/0, ENO = TRUE) ===")
    prg.textual_implementation.replace("".join("%s();\n" % k for k in kept))
    msgs = vp.build_messages(app, system, Severity)
    log("   build of all kept: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
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
    time.sleep(2)
    for k in kept:
        vals = []
        for v in ("out", "lamp", "sv", "n"):
            try:
                vals.append("%s=%s" % (v, oa.read_value("%s.%s" % (k, v))))
            except Exception as e:
                vals.append("%s=?(%s)" % (v, e))
        log("   %-20s %s" % (k, "  ".join(vals)))
    oa.stop()
    oa.logout()

    log("")
    log("=== a BoxTreeBox's surface (is there a door that resolves the pins from the type?) ===")
    if sample is not None:
        vp.dump(sample, log)
        seen = set()
        for src2 in [sample.GetType()] + list(sample.GetType().GetInterfaces()):
            for m in src2.GetMethods(vp.bf()):
                sig = "%s(%s) -> %s" % (m.Name, ", ".join("%s %s" % (x.ParameterType.Name, x.Name)
                                                          for x in m.GetParameters()), m.ReturnType.Name)
                if sig not in seen and not m.Name.startswith("get_") and not m.Name.startswith("set_"):
                    seen.add(sig)
                    log("        " + sig)
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
