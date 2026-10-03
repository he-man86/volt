# -*- coding: utf-8 -*-
# CAN AN EXISTING BODY CHANGE LANGUAGE IN PLACE ON CODESYS? (openspec bridge-refusal-review 3.3, 3.4)
#
# `BodyFormatGuard` refuses a textual push over a graphical body ("a textual push would overwrite it") and a
# graphical push over a textual body ("graphical bodies are authored in the IDE, not created by push" - which is
# wrong as worded: a push DOES create graphical bodies, on a create). Both are vendor-limit claims nobody measured:
# can the object the IDE already holds change its body language, keeping the object (its guid, its members)?
#
# The doors asked, in order, for an FBD POU -> ST and an ST POU -> FBD:
#   1. the scripting surface: `textual_implementation` on an FBD POU (is there a text document to write?), and
#      whether any scripting member names a language change;
#   2. the object model: is the POU object's `Implementation` aspect WRITABLE (a setter on the class or an
#      interface)? If so, put an aspect of the other language on it (cloned off a POU that has one), commit, and read
#      back: same guid? which aspect class? does the textual / network door work now? does the project BUILD with
#      the new body?
#   3. every method on the POU object and its Implementation whose name says Language / Convert / Implementation -
#      the discovery pass, so a door the probe does not know to ask for cannot hide.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-body-language-change.py"
#
# Works on a COPY of the project and never saves. ASCII ONLY - IronPython 2.7.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("body-language-change.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

DECL = "PROGRAM %s\nVAR\n  a : BOOL := TRUE;\n  q : BOOL;\nEND_VAR\n"


def guid(o):
    return str(vp.prop(vp.unwrap(o), "guid"))


def aspect_of(objmgr, o):
    u = vp.unwrap(o)
    meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    obj = vp.prop(meta, "Object")
    return obj, vp.prop(obj, "Implementation")


def writable_members(t, needle):
    out = []
    for src in [t] + list(t.GetInterfaces()):
        for p in src.GetProperties(vp.bf()):
            if needle.lower() in p.Name.lower():
                out.append("%s.%s %s%s" % (src.Name, p.Name, p.PropertyType.Name, " WRITABLE" if p.CanWrite else ""))
    return sorted(set(out))


def methods_named(t, words):
    out = set()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods(vp.bf()):
            if any(w.lower() in m.Name.lower() for w in words):
                out.add("%s.%s(%s) -> %s" % (src.Name, m.Name,
                                             ", ".join(x.ParameterType.Name for x in m.GetParameters()),
                                             m.ReturnType.Name))
    return sorted(out)


def state(objmgr, label, pou):
    obj, impl = aspect_of(objmgr, pou)
    try:
        ti = pou.textual_implementation
        text = None if ti is None else repr(ti.text)[:80]
    except Exception as e:
        text = "<raised %s>" % str(e)[:60]
    log("   %-26s guid=%s aspect=%s textual_implementation=%s" %
        (label, guid(pou), None if impl is None else impl.GetType().Name, text))


def try_swap(objmgr, label, target, donor):
    """Put a CLONE of `donor`'s Implementation aspect on `target`, through the object manager, and commit."""
    _, donor_impl = aspect_of(objmgr, donor)
    u = vp.unwrap(target)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    committed = False
    try:
        obj = vp.prop(meta, "Object")
        clone_ok, clone = vp.call(donor_impl, "Clone", [])
        if not clone_ok:
            log("   %s: Clone of the donor aspect failed: %s" % (label, clone))
            return
        try:
            vp.nwl_set(obj, "Implementation", clone)
            log("   %s: Implementation SET (a %s)" % (label, clone.GetType().Name))
        except Exception as e:
            log("   %s: Implementation NOT settable: %s" % (label, str(e)[:160]))
            # The discovery: any Set*Implementation* door on the object.
            for m in methods_named(obj.GetType(), ["SetImplementation", "ReplaceImplementation", "Language"]):
                log("      candidate: " + m)
            return
    finally:
        try:
            objmgr.SetObject(meta, True, None)
            committed = True
        except Exception as e:
            log("   %s: commit FAILED: %s" % (label, str(e)[:160]))
    log("   %s: committed=%s" % (label, committed))


def aspect_body(objmgr, pou):
    _, impl = aspect_of(objmgr, pou)
    doc = vp.prop(impl, "TextDocument")
    return "<%s: no TextDocument>" % impl.GetType().Name if doc is None else vp.prop(doc, "Text")


def write_body(objmgr, pou, text):
    """CodesysObjectModel.WriteSourceText's implementation half: checkout, TextDocument.Text, commit."""
    u = vp.unwrap(pou)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    try:
        doc = vp.prop(vp.prop(vp.prop(meta, "Object"), "Implementation"), "TextDocument")
        vp.nwl_set(doc, "Text", text)
        objmgr.SetObject(meta, True, None)
        return "committed, read back %r" % aspect_body(objmgr, pou)
    except Exception as e:
        try:
            objmgr.SetObject(meta, False, None)
        except Exception:
            pass
        return "FAILED: %s" % str(e).splitlines()[0][:200]


def put_new(objmgr, pou, aspect_type):
    """A freshly CONSTRUCTED aspect of `aspect_type` (parameterless ctor) onto `pou`'s Implementation, committed."""
    import System
    u = vp.unwrap(pou)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    try:
        fresh = System.Activator.CreateInstance(aspect_type)
        vp.nwl_set(vp.prop(meta, "Object"), "Implementation", fresh)
        objmgr.SetObject(meta, True, None)
        return "committed (same guid: %s)" % (guid(pou) == str(vp.prop(u, "guid")))
    except Exception as e:
        try:
            objmgr.SetObject(meta, False, None)
        except Exception:
            pass
        return "FAILED: %s" % str(e).splitlines()[0][:200]


def network_q_a(impl, view):
    """One network `q := a`, as CodesysNetworkWriter writes an assignment of a leaf, and the view set as 2.22 does."""
    if vp.prop(vp.prop(impl, "NetworkList"), "Count") == 0:
        # As the writer matches the count: the aspect's own AppendNetwork (NetworkList is read-only).
        ok, why = vp.call(impl, "AppendNetwork", [vp.nwl_new(impl, "Network")])
        if not ok:
            raise Exception("AppendNetwork: %s" % why)
    net = vp.prop(impl, "NetworkList")[0]
    asg = vp.nwl_new(net, "BoxTreeAssign")
    vp.nwl_set(asg, "RValue", vp.nwl_new(net, "BoxTreeOperand", vp.nwl_new(net, "Operand", "a")))
    vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [vp.nwl_new(net, "Operand", "q")])
    vp.call(net, "AppendTree", [asg])
    vp.nwl_set(impl, "DefaultViewMode", view)


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "body-language-change")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\nEND_VAR\n")

    fbd = app.create_pou(name="VltLc_Fbd", type=PouType.Program, language=ImplementationLanguages.fbd)
    fbd.textual_declaration.replace(DECL % "VltLc_Fbd")
    ld = app.create_pou(name="VltLc_Ld", type=PouType.Program, language=ImplementationLanguages.ladder)
    ld.textual_declaration.replace(DECL % "VltLc_Ld")
    stp = app.create_pou(name="VltLc_St", type=PouType.Program, language=ImplementationLanguages.st)
    stp.textual_declaration.replace(DECL % "VltLc_St")
    stp.textual_implementation.replace("q := a;\n")
    donor_st = app.create_pou(name="VltLc_DonorSt", type=PouType.Program, language=ImplementationLanguages.st)
    donor_st.textual_declaration.replace(DECL % "VltLc_DonorSt")
    donor_st.textual_implementation.replace("q := NOT a;\n")
    donor_fbd = app.create_pou(name="VltLc_DonorFbd", type=PouType.Program, language=ImplementationLanguages.fbd)
    donor_fbd.textual_declaration.replace(DECL % "VltLc_DonorFbd")

    log("")
    log("=== 1. the scripting surface ===")
    state(objmgr, "FBD before", fbd)
    state(objmgr, "LD before", ld)
    state(objmgr, "ST before", stp)
    for m in sorted(set(x for x in dir(fbd) if any(w in x.lower() for w in ("lang", "convert", "impl")))):
        log("   scripting member on a POU: " + m)

    log("")
    log("=== 2. the object model: is the Implementation aspect writable? ===")
    obj, impl = aspect_of(objmgr, fbd)
    log("   POU object class: " + obj.GetType().FullName)
    for w in writable_members(obj.GetType(), "Implementation"):
        log("   " + w)
    for w in writable_members(obj.GetType(), "Language"):
        log("   " + w)

    log("")
    log("--- FBD -> ST (3.3): the ST donor's aspect onto the FBD POU ---")
    g0 = guid(fbd)
    try_swap(objmgr, "FBD->ST", fbd, donor_st)
    state(objmgr, "FBD after", fbd)
    log("   same object: %s" % (guid(fbd) == g0))
    log("--- LD -> ST (3.3) ---")
    try_swap(objmgr, "LD->ST", ld, donor_st)
    state(objmgr, "LD after", ld)
    log("--- ST -> FBD (3.4): the FBD donor's aspect onto the ST POU ---")
    try_swap(objmgr, "ST->FBD", stp, donor_fbd)
    state(objmgr, "ST after", stp)

    log("")
    log("=== build, every case called ===")
    prg.textual_implementation.replace("VltLc_Fbd();\nVltLc_Ld();\nVltLc_St();\n")
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else ""))
    for m in msgs:
        log("      " + m)

    # ROUND 2 (the first run's "build CLEAN" does not say the swapped body is the one compiled): write the swapped
    # bodies the way the driver writes, prove the build reads THAT text (an error first, then valid code), and run it.
    log("")
    log("=== 2b. the swapped ST body, through the driver's write (aspect TextDocument.Text) ===")
    log("   VltLc_Fbd body now: %r" % aspect_body(objmgr, fbd))
    log("   write 'q := zz;'  -> %s" % write_body(objmgr, fbd, "q := zz;\n"))
    msgs = vp.build_messages(app, system, Severity)
    log("   build (must name zz): %s" % (" | ".join(msgs) if msgs else "CLEAN  <-- the build did not read the new body"))
    log("   write 'q := NOT a;' -> %s" % write_body(objmgr, fbd, "q := NOT a;\n"))
    fresh = [o for o in proj.find("VltLc_Fbd", True)][0]
    try:
        log("   a FRESH script object's textual_implementation: %r" % fresh.textual_implementation.text)
    except Exception as e:
        log("   a FRESH script object's textual_implementation: <raised %s>" % str(e)[:100])

    log("")
    log("=== 2c. a FRESH aspect, constructed (no donor in the project) ===")
    _, st_impl = aspect_of(objmgr, donor_st)
    _, nwl_impl = aspect_of(objmgr, donor_fbd)
    ld2 = app.create_pou(name="VltLc_Ld2", type=PouType.Program, language=ImplementationLanguages.ladder)
    ld2.textual_declaration.replace(DECL % "VltLc_Ld2")
    st2 = app.create_pou(name="VltLc_St2", type=PouType.Program, language=ImplementationLanguages.st)
    st2.textual_declaration.replace(DECL % "VltLc_St2")
    st2.textual_implementation.replace("q := a;\n")
    log("   LD -> new STImplementationObject: %s" % put_new(objmgr, ld2, st_impl.GetType()))
    state(objmgr, "LD2 after", ld2)
    log("   write 'q := a;' -> %s" % write_body(objmgr, ld2, "q := a;\n"))
    log("   ST -> new NWLImplementationObject: %s" % put_new(objmgr, st2, nwl_impl.GetType()))
    state(objmgr, "ST2 after", st2)

    log("")
    log("=== 2d. the swapped graphical bodies get a network (q := a), LD view on one ===")
    for pou, view in ((stp, "Fbd"), (st2, "Ld")):
        try:
            vp.nwl_edit(objmgr, pou, lambda impl, v=view: network_q_a(impl, v))
            net = vp.nwl_read(objmgr, pou)
            log("   %s: network written, %s network(s), view %s" %
                (pou.get_name(), vp.prop(net, "Count"), vp.prop(aspect_of(objmgr, pou)[1], "DefaultViewMode")))
        except Exception as e:
            log("   %s: network write FAILED: %s" % (pou.get_name(), str(e).splitlines()[0][:200]))

    calls = "VltLc_Fbd();\nVltLc_Ld();\nVltLc_St();\nVltLc_Ld2();\nVltLc_St2();\n"
    prg.textual_implementation.replace(calls)
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
    log("")
    log("=== run: a = TRUE; Fbd (now ST 'q := NOT a') = FALSE, Ld (ST donor 'q := NOT a') = FALSE,")
    log("         St (now FBD 'q := a') = TRUE, Ld2 (fresh ST 'q := a') = TRUE, St2 (fresh NWL, LD view 'q := a') = TRUE ===")
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
    import time
    time.sleep(2)
    for k in ("VltLc_Fbd", "VltLc_Ld", "VltLc_St", "VltLc_Ld2", "VltLc_St2"):
        try:
            log("   %-10s q=%s" % (k, oa.read_value("%s.q" % k)))
        except Exception as e:
            log("   %-10s q=?(%s)" % (k, str(e)[:80]))
    oa.stop()
    oa.logout()

    log("")
    log("=== 3. discovery: methods naming a language or a conversion ===")
    for m in methods_named(obj.GetType(), ["Language", "Convert"]):
        log("   POU object: " + m)
    if impl is not None:
        for m in methods_named(impl.GetType(), ["Language", "Convert", "Implementation"]):
            log("   NWL aspect: " + m)
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
