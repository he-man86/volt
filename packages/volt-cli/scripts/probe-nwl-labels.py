# Labels and jumps in a graphical body - what the IDE HOLDS and what its build SAYS (openspec
# network-text-literal-nwl, task 1.15). No real project carries a single label or jump (census 2026-09-26), so the
# shapes are BUILT: each case is a fresh FBD program on a COPY of the fixture, called from PLC_PRG so it is
# compiled, and its networks are read back through the object manager before the build. "Holds" is the read-back;
# the build's messages are the parity target for the LSP (task 5.6). The gate refuses only what the IDE cannot hold.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-nwl-labels.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("nwl-labels.log")

# A network is (label, disabled, item) and an item is ("coil", cond, target) or ("jmp", cond, label).
CASES = [
    ("control: a jump to a label", [("", False, ("jmp", "a", "Done")), ("Done", False, ("coil", "a", "x"))]),
    ("jump spelled in another case", [("", False, ("jmp", "a", "DONE")), ("Done", False, ("coil", "a", "x"))]),
    ("one label on two networks, same case", [("Done", False, ("coil", "a", "x")), ("Done", False, ("coil", "a", "y")),
                                              ("", False, ("jmp", "a", "Done"))]),
    ("one label on two networks, other case", [("Done", False, ("coil", "a", "x")), ("DONE", False, ("coil", "a", "y")),
                                               ("", False, ("jmp", "a", "Done"))]),
    ("duplicate label, no jump", [("Done", False, ("coil", "a", "x")), ("DONE", False, ("coil", "a", "y"))]),
    ("a LABEL on a DISABLED network as target", [("", False, ("jmp", "a", "Done")), ("Done", True, ("coil", "a", "x"))]),
    ("a JMP inside a DISABLED network", [("", True, ("jmp", "a", "Done")), ("Done", False, ("coil", "a", "x"))]),
    ("a JMP to a label no network carries", [("", False, ("jmp", "a", "Nowhere")), ("", False, ("coil", "a", "x"))]),
    ("a label nothing jumps to", [("", False, ("coil", "a", "y")), ("Done", False, ("coil", "a", "x"))]),
]


def item(net, spec):
    kind, cond, target = spec
    asg = vp.nwl_new(net, "BoxTreeAssign")
    vp.nwl_set(asg, "RValue", vp.nwl_new(net, "BoxTreeOperand", vp.nwl_new(net, "Operand", cond)))
    op = vp.nwl_new(net, "Operand", target)
    if kind == "jmp":
        # Where the C# writer puts it (CodesysNetworkWriter, Assign arm): the jump bit on the target operand AND
        # on the item - the operand is the one the compiler reads.
        vp.nwl_set(vp.prop(op, "Flags"), "Jump", True)
        vp.nwl_set(vp.prop(asg, "Flags"), "Jump", True)
    vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [op])
    return asg


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "nwl-labels")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\nEND_VAR\n")
    for n, (label, nets) in enumerate(CASES):
        name = "P_Label%d" % n
        pou = app.create_pou(name=name, type=PouType.Program, language=ImplementationLanguages.fbd)
        pou.textual_declaration.replace("PROGRAM %s\nVAR\n  a : BOOL;\n  x : BOOL;\n  y : BOOL;\nEND_VAR\n" % name)

        def build(impl):
            lst = vp.prop(impl, "NetworkList")
            while len(lst) < len(nets):
                vp.call(impl, "AppendNetwork", [vp.nwl_new(impl, "Network")])
                lst = vp.prop(impl, "NetworkList")
            for i, (lab, disabled, spec) in enumerate(nets):
                net = lst[i]
                for j in range(int(vp.prop(net, "NetworkItemCount") or 0) - 1, -1, -1):
                    vp.call(net, "RemoveNetworkItem", [j])
                vp.nwl_set(net, "Label", lab)
                vp.nwl_set(net, "OutCommented", disabled)
                ok, why = vp.call(net, "AppendTree", [item(net, spec)])
                if not ok:
                    log("   AppendTree refused on network %d: %s" % (i, why))

        vp.nwl_edit(objmgr, pou, build)
        back = vp.nwl_read(objmgr, pou)
        held = ["%s%s(%d item)" % ("[DISABLED] " if vp.prop(back[i], "OutCommented") else "",
                                   "LABEL %r " % str(vp.prop(back[i], "Label")) if vp.prop(back[i], "Label") else "",
                                   int(vp.prop(back[i], "NetworkItemCount") or 0)) for i in range(len(back))]
        prg.textual_implementation.replace("%s();\n" % name)
        msgs = vp.build_messages(app, system, Severity)
        log("%s" % label)
        log("   held: %s" % " | ".join(held))
        log("   build: %s" % ("CLEAN" if not msgs else ""))
        for m in msgs:
            log("      " + m)
        pou.remove()
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
