# -*- coding: utf-8 -*-
# WHAT DOES CODESYS DO WHEN AN INTERFACE PROPERTY'S GET/SET IS WRITTEN? (openspec bridge-refusal-review 3.6, D28)
#
# DIALECT D21: writing an interface property accessor's declaration CRASHES TcXaeShell. Both drivers refuse the
# write (`InterfaceAccessorGuard`), CODESYS included - and the CODESYS half was never measured. This writes one, the
# way the CODESYS driver writes every other accessor (`CodesysObjectModel.WriteSourceText`: the object manager's
# GetObjectToModify, the `Interface` / `Implementation` aspect's TextDocument.Text, SetObject), and also through the
# scripting surface (`textual_declaration.replace`), and reports for each: taken (read back equal), refused (the
# vendor's exception), or silently dropped (accepted, read back unchanged) - and whether the IDE survives and the
# project still builds with an FB implementing the interface.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-interface-accessor-write.py"
#
# Works on a COPY of the project and never saves. ASCII ONLY - IronPython 2.7.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("interface-accessor-write.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")


def aspect_text(objmgr, node, aspect):
    u = vp.unwrap(node)
    meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    a = vp.prop(vp.prop(meta, "Object"), aspect)
    if a is None:
        return "<no %s aspect>" % aspect
    doc = vp.prop(a, "TextDocument")
    if doc is None:
        return "<%s aspect %s has no TextDocument>" % (aspect, a.GetType().Name)
    return vp.prop(doc, "Text")


def write_aspect(objmgr, node, aspect, text):
    """CodesysObjectModel.WriteSourceText for one aspect: checkout, TextDocument.Text, commit (rollback on a throw)."""
    u = vp.unwrap(node)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    try:
        a = vp.prop(vp.prop(meta, "Object"), aspect)
        if a is None:
            objmgr.SetObject(meta, False, None)
            return "NO %s ASPECT" % aspect
        doc = vp.prop(a, "TextDocument")
        if doc is None:
            objmgr.SetObject(meta, False, None)
            return "%s ASPECT HAS NO TextDocument (%s)" % (aspect, a.GetType().Name)
        vp.nwl_set(doc, "Text", text)
        objmgr.SetObject(meta, True, None)
        return "committed"
    except Exception as e:
        try:
            objmgr.SetObject(meta, False, None)
        except Exception:
            pass
        return "REFUSED: %s: %s" % (type(e).__name__, str(e).splitlines()[0][:200])


def accessors(prop_node):
    return [c for c in prop_node.get_children()]


def show(objmgr, label, node):
    log("   %-34s decl=%r" % (label, aspect_text(objmgr, node, "Interface")))
    log("   %-34s impl=%r" % ("", aspect_text(objmgr, node, "Implementation")))


def build(app):
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else ""))
    for m in msgs:
        log("      " + m)


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "interface-accessor-write")
    app = proj.active_application
    itf = app.create_interface("IVltAcc")
    p = itf.create_property("P", "INT")
    log("interface property P created; children: %s" % [c.get_name() for c in accessors(p)])

    fb = app.create_pou(name="VltAccFb", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fb.textual_declaration.replace("FUNCTION_BLOCK VltAccFb IMPLEMENTS IVltAcc\nVAR\n  v : INT;\nEND_VAR\n")
    fp = fb.create_property("P", "INT")
    for c in accessors(fp):
        if c.get_name().lower() == "get":
            c.textual_implementation.replace("P := v;\n")
        else:
            c.textual_implementation.replace("v := P;\n")
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\n  f : VltAccFb;\n  i : IVltAcc;\n  x : INT;\nEND_VAR\n")
    prg.textual_implementation.replace("i := f;\nx := i.P;\ni.P := x + 1;\n")

    log("")
    log("=== as created ===")
    for c in accessors(p):
        show(objmgr, "IVltAcc.P." + c.get_name(), c)
        try:
            log("   %-34s scripting textual_declaration=%s textual_implementation=%s" %
                ("", c.has_textual_declaration, c.has_textual_implementation))
        except Exception as e:
            log("   %-34s scripting has_textual_*: %s" % ("", str(e)[:80]))
    build(app)

    DECL = "VAR\n  tmp : INT;\nEND_VAR\n"
    BODY = "tmp := 1;\n"
    for c in accessors(p):
        n = "IVltAcc.P." + c.get_name()
        log("")
        log("=== %s: the driver's write (object manager, TextDocument.Text) ===" % n)
        log("   declaration -> %s" % write_aspect(objmgr, c, "Interface", DECL))
        log("   body        -> %s" % write_aspect(objmgr, c, "Implementation", BODY))
        show(objmgr, n + " read back", c)
        build(app)

        log("=== %s: the scripting write (textual_declaration.replace) ===" % n)
        for what, attr, text in (("declaration", "textual_declaration", "VAR\n  tmp2 : INT;\nEND_VAR\n"),
                                 ("body", "textual_implementation", "tmp2 := 2;\n")):
            try:
                doc = getattr(c, attr)
                if doc is None:
                    log("   %s: %s is None" % (what, attr))
                else:
                    doc.replace(text)
                    log("   %s: replace taken" % what)
            except Exception as e:
                log("   %s: REFUSED: %s: %s" % (what, type(e).__name__, str(e).splitlines()[0][:200]))
        show(objmgr, n + " read back", c)
        build(app)

    log("")
    log("=== the IDE is still answering: the interface's children ===")
    log("   %s" % [c.get_name() for c in accessors(p)])
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
