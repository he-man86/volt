# -*- coding: utf-8 -*-
# DOES THE BUILD REPORT A WIRE TYPE THAT CONTRADICTS ITS PRODUCER? (openspec bridge-refusal-review 3.2)
#
# Network text declares each wire in VAR_TEMP (`g1 : INT;`). The reader refuses a declaration its producer
# contradicts (`NetworkTextReader.CheckWireTypes`, NETWORK_BAD_EXPRESSION "the wire g1 is declared INT and its
# producer is BOOL") before the push asks the IDE. The question that decides whether that is a code check (remove:
# the build answers) or a vendor limit (keep: the write would silently change the text):
#
#   The CODESYS writer carries a declared type as the producing box's stored output type
#   (`NetworkText.WithDeclaredType` -> `OutputParams.Types[connected slot]`). The ONLY producer the reader can
#   contradict that also takes a stored type is a comparison box (GT/GE/LT/LE/EQ/NE, connected by its data slot):
#   a leaf, TRUE/FALSE, an edge, a Parallel, a wire reference, an Execute box and a box read through `.ENO` have no
#   slot that would keep the declared type, and a bit operator stores no connected slot (census 1.6). So: a GT box
#   whose stored output type says INT, feeding a wire - does the build say so, or compile it silently? And what
#   does the IDE hold for the type after the commit and after the build?
#
# Each case is its own FBD PROGRAM built exactly as `CodesysNetworkWriter` builds it (BoxType, instance operand
# emptied, inputs, OutputParams [("", type)] with NO output item on the connected slot, a BoxTreeDemux defining the
# wire, an Assign reading it), called from PLC_PRG and built alone. The first case MUST fail (control).
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-wire-type-build.py"
#
# Works on a COPY of the project and never saves. ASCII ONLY - IronPython 2.7. (No variable named `st` or `r`: both are IL operators, and a declaration stops parsing at one - the first run named a REAL `r` and every case failed on it.)
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("wire-type-build.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

DECL = ("PROGRAM %s\nVAR\n  a : INT := 3;\n  b : INT := 2;\n  out : BOOL;\n  n : INT;\n  rv : REAL;\nEND_VAR\n")

# (name, what, box type, inputs, stored type of the connected slot or None for no OutputParams, consumer target)
CASES = [
    ("VltWt_Control", "control: GT(a, zz) - an undeclared operand (must NOT build clean)", "GT", ["a", "zz"], "BOOL", "out"),
    ("VltWt_GtBool", "g1 : BOOL; g1 := GT(a, b); out := g1;  - declared as the producer says (control, clean)", "GT",
     ["a", "b"], "BOOL", "out"),
    ("VltWt_GtIntToInt", "g1 : INT; g1 := GT(a, b); n := g1;  - declared INT, read into an INT", "GT", ["a", "b"], "INT", "n"),
    ("VltWt_GtIntToBool", "g1 : INT; g1 := GT(a, b); out := g1;  - declared INT, read into a BOOL", "GT", ["a", "b"],
     "INT", "out"),
    ("VltWt_GtRealToInt", "g1 : REAL; g1 := GT(a, b); n := g1;  - declared REAL, read into an INT", "GT", ["a", "b"],
     "REAL", "n"),
    ("VltWt_GtRealToReal", "g1 : REAL; g1 := GT(a, b); rv := g1;  - declared REAL, read into a REAL", "GT", ["a", "b"],
     "REAL", "rv"),
    ("VltWt_EqIntToInt", "g1 : INT; g1 := EQ(a, b); n := g1;  - another comparison, declared INT", "EQ", ["a", "b"],
     "INT", "n"),
    ("VltWt_GtUntypedToInt", "GT with NO stored type feeding a wire read into an INT (what the build checks by)", "GT",
     ["a", "b"], None, "n"),
    ("VltWt_GtBoolToInt", "g1 : BOOL; g1 := GT(a, b); n := g1;  - declared as the producer says, read into an INT", "GT",
     ["a", "b"], "BOOL", "n"),
]


def types(box):
    return [str(x) for x in (vp.prop(vp.prop(box, "OutputParams"), "Types") or [])]


def build_case(case):
    name, what, btype, inputs, stored, target = case

    def fn(impl):
        net = vp.prop(impl, "NetworkList")[0]

        def leaf(text):
            return vp.nwl_new(net, "BoxTreeOperand", vp.nwl_new(net, "Operand", text))

        box = vp.nwl_new(net, "BoxTreeBox")
        vp.nwl_set(box, "BoxType", btype)
        vp.nwl_set(vp.prop(box, "Instance"), "OperandExpr", "")
        for i in inputs:
            vp.call(box, "AppendInputItem", [leaf(i)])
        if stored is not None:
            # A slot only a TYPE names gets a param and NO output item (CodesysNetworkWriter: an empty operand there
            # is "an assignment to nothing").
            vp.call(vp.prop(box, "OutputParams"), "AppendParam", ["", stored])

        wire = vp.nwl_new(net, "BoxTreeDemux")
        vp.nwl_set(wire, "VarId", 1)
        vp.call(wire, "SetInputTree", [0, box])
        vp.call(net, "AppendTree", [wire])

        ref = vp.nwl_new(net, "BoxTreeDemux")
        vp.nwl_set(ref, "VarId", 1)
        asg = vp.nwl_new(net, "BoxTreeAssign")
        vp.nwl_set(asg, "RValue", ref)
        vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [vp.nwl_new(net, "Operand", target)])
        vp.call(net, "AppendTree", [asg])

    return fn


def read_box(objmgr, pou):
    net = vp.nwl_read(objmgr, pou)[0]
    ok, tree = vp.call(net, "GetTree", [0])
    if not ok or tree is None:
        return None, 0
    n = vp.prop(net, "Count")
    return vp.prop(tree, "Input") if vp.prop(tree, "Input") is not None else tree, n


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "wire-type-build")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\nEND_VAR\n")
    kept = []
    for case in CASES:
        name, what = case[0], case[1]
        log(name + ": " + what)
        pou = app.create_pou(name=name, type=PouType.Program, language=ImplementationLanguages.fbd)
        pou.textual_declaration.replace(DECL % name)
        vp.nwl_edit(objmgr, pou, build_case(case))
        box, count = read_box(objmgr, pou)
        log("   committed:   trees=%s producer=%s OutputParams.Types=%s" %
            (count, None if box is None else box.GetType().Name, None if box is None else types(box)))
        prg.textual_implementation.replace("%s();\n" % name)
        msgs = vp.build_messages(app, system, Severity)
        log("   build:       %s" % ("CLEAN" if not msgs else ""))
        for m in msgs:
            log("      " + m)
        box, count = read_box(objmgr, pou)
        log("   after build: OutputParams.Types=%s" % (None if box is None else types(box)))
        if msgs:
            pou.remove()
        else:
            kept.append(name)

    # WHAT THE CLEAN CASES COMPUTE: a = 3, b = 2, so GT is TRUE and EQ FALSE. A declared INT/REAL that compiles
    # clean either converts (n = 1) or reads something else; the run says which.
    log("")
    log("=== run: each clean case's consumer after one cycle (GT(3,2) = TRUE, EQ(3,2) = FALSE) ===")
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
        for v in ("out", "n", "rv"):
            try:
                vals.append("%s=%s" % (v, oa.read_value("%s.%s" % (k, v))))
            except Exception as e:
                vals.append("%s=?(%s)" % (v, e))
        log("   %-22s %s" % (k, "  ".join(vals)))
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
