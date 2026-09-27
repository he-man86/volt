# Can a CODESYS DUT change SUBTYPE in place - an enum declaration written into a DUT created as a STRUCTURE -
# or does the new shape need `create_dut` again?
#
# openspec `dut-subtype-on-the-wire` task 1.3. The change names a DUT on the wire by its subtype (`X.struct`,
# `X.enum`, ...) and turns a subtype change into ONE content update of the same vendor object. That is only
# possible if the vendor keeps the object when its declaration changes shape: the object's GUID must survive,
# the tree must still classify it as a DUT, and the new declaration must compile as the new subtype. This
# creates each seed the way the bridge does (`create_dut(DutType.Structure)`, CodesysObjectModel.Libraries),
# writes every other subtype's declaration into it, and logs the three answers for each.
#
# The write goes through the scripting `textual_declaration.replace` rather than the bridge's own
# `GetObjectToModify`/`SetObject` pair. The bridge path is measured separately, live over the pipe with a `guid`
# read between pushes: `probe-dut-subtype-push.py` / `dut-subtype-push.log` (task 1.1). That path landed struct->enum
# on an IDUTObject only (struct->union was refused by the push's op order, not the vendor); union and alias through
# the bridge were measured on a text-list enum, a different object type. So "same answer" is shown for enum only.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-dut-subtype-in-place.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("dut-subtype-in-place.log")

DECL = {
    "struct": "TYPE %s :\nSTRUCT\n\talpha : INT;\n\tbeta : BOOL;\nEND_STRUCT\nEND_TYPE\n",
    "enum": "TYPE %s :\n(\n\tRed,\n\tGreen,\n\tBlue\n);\nEND_TYPE\n",
    # `rv`, not `r`: R (like S) is an IL operator and a reserved word - the first run's five errors were that.
    "union": "TYPE %s :\nUNION\n\ti : INT;\n\trv : REAL;\nEND_UNION\nEND_TYPE\n",
    "alias": "TYPE %s : STRING(80);\nEND_TYPE\n",
}

# A user of each subtype, so the build proves the new SHAPE compiled - not merely that the text was stored.
USE = {
    "struct": "v : %s;\n", "enum": "v : %s := %s.Green;\n", "union": "v : %s;\n", "alias": "v : %s := 'x';\n",
}


def messages():
    out = []
    for cat in system.get_message_categories(True):
        for sev in (Severity.FatalError, Severity.Error):
            for m in system.get_message_objects(cat, sev):
                out.append("[%s] %s" % (sev, getattr(m, "text", m)))
    return out


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    proj = vp.open_copy(projects, src, "dut-subtype-in-place")
    app = proj.active_application
    # `create_folder` returns None on SP21, so the folder is found again by name.
    app.create_folder("VltSubtype")
    folder = [c for c in app.get_children() if c.get_name() == "VltSubtype"][0]
    log("seed folder: %s" % folder.get_name())

    # Positive control: the fixture must build clean before any DUT exists, or the messages below mean nothing.
    app.build()
    base = messages()
    log("baseline build errors: %r" % base)

    for target in ["enum", "union", "alias", "struct"]:
        name = "VltSub_%s" % target
        dut = folder.create_dut(name, DutType.Structure)
        dut.textual_declaration.replace(DECL["struct"] % name)
        g0 = dut.guid
        log("")
        log("== %s: created as Structure, guid %s" % (name, g0))
        try:
            dut.textual_declaration.replace(DECL[target] % name)
            log("   write %s declaration -> accepted" % target)
        except Exception as e:
            log("   write %s declaration -> REFUSED: %s" % (target, e))
            continue
        # Re-find it from the tree: a stale scripting handle would answer for the object that WAS there.
        found = [c for c in folder.get_children() if c.get_name() == name]
        if len(found) != 1:
            log("   re-find by name -> %d objects (expected exactly 1)" % len(found))
            continue
        again = found[0]
        log("   after: guid %s (%s)" % (again.guid, "SAME" if again.guid == g0 else "CHANGED"))
        log("   after: folder %s, declaration %r" % (again.parent.get_name(), again.textual_declaration.text))

    # The build: every subtype USED as its new shape from one program. An error naming a VltSub_ type means
    # the vendor stored the text but did not re-derive the subtype from it.
    prg = folder.create_pou(name="VltSub_Use", type=PouType.Program, language=ImplementationLanguages.st)
    decl = "PROGRAM VltSub_Use\nVAR\n"
    for target in ["enum", "union", "alias", "struct"]:
        n = "VltSub_%s" % target
        use = USE[target]
        decl += "\t" + (use % (n, n) if use.count("%s") == 2 else use % n).replace("v :", "v_%s :" % target)
    decl += "END_VAR\n"
    prg.textual_declaration.replace(decl)
    prg.textual_implementation.replace("v_enum := VltSub_enum.Blue;\nv_union.i := 1;\nv_alias := 'y';\nv_struct.alpha := 2;\n")
    # CALLED from the main program, because CODESYS compiles only what the task reaches: the first run of this
    # probe had no caller, and its negative control below came back with 0 errors - a build that never saw
    # VltSub_Use, which would have read as "every in-place change compiles".
    # The POU, not the task's call entry of the same name (the walk meets both).
    main = [o for o in vp.walk(app) if o.get_name() == "PLC_PRG" and getattr(o, "has_textual_implementation", False)]
    if len(main) != 1:
        log("expected exactly one PLC_PRG, found %d - cannot wire the user in" % len(main))
        raise SystemExit
    main[0].textual_implementation.append("\nVltSub_Use();\n")
    app.build()
    errs = [m for m in messages() if m not in base]
    log("")
    log("build after the in-place subtype changes: %d new error(s)" % len(errs))
    for m in errs:
        log("   " + m)

    # NEGATIVE CONTROL: "0 errors" proves nothing if the build never compiled VltSub_Use. A member the enum
    # does not have must be refused - and a struct member used on the ex-struct-now-enum must be too.
    prg.textual_implementation.replace("v_enum := VltSub_enum.Purple;\nv_enum.alpha := 1;\n")
    app.build()
    errs = [m for m in messages() if m not in base]
    log("negative control (VltSub_enum.Purple, v_enum.alpha): %d new error(s)" % len(errs))
    for m in errs:
        log("   " + m)
except SystemExit:
    pass
except Exception:
    import traceback
    log(traceback.format_exc())
finally:
    done()
