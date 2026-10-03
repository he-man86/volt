# -*- coding: utf-8 -*-
# DOES A MEMBER'S BODY CHANGE LANGUAGE IN PLACE ON CODESYS, AS A POU'S DOES? (openspec bridge-refusal-review 4.7, D7)
#
# DIALECT N24 (probe-body-language-change.py) measured a POU's OWN body: `IPOUObject.Implementation` is writable, and a
# freshly constructed STImplementationObject / NWLImplementationObject took the driver's own writes, built and ran.
# A METHOD, an ACTION and a property ACCESSOR hold their bodies on objects of their own, which that probe never asked.
# Until each is measured, `CodesysDriver.RefusedLanguageChange` refuses it by name. This asks, for each:
#
#   1. ST -> network: a FRESH NWLImplementationObject (Activator, the type taken off an FBD donor's aspect) put on the
#      member's own object inside one GetObjectToModify/SetObject; guid before/after; the network `x := na` written
#      through the aspect (AppendNetwork / BoxTreeAssign, as CodesysNetworkWriter writes an assignment of a leaf) and
#      its view set (DefaultViewMode, N23).
#   2. build, and RUN: `na` is FALSE and every ST body said `x := a` (TRUE), so x = FALSE proves the new body runs.
#   3. network -> ST: a FRESH STImplementationObject, the text `x := a;` written through TextDocument.Text; build, run:
#      x = TRUE again.
#
# TRANSITION bodies are not asked: a transition is no member Volt writes (MemberSites lists none; SFC is unsupported).
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-member-language-change.py"
#
# Works on a COPY of the project and never saves. ASCII ONLY - IronPython 2.7.
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("member-language-change.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

FB_DECL = ("FUNCTION_BLOCK VltMc_Fb\nVAR\n  a : BOOL := TRUE;\n  na : BOOL := FALSE;\n"
           "  qm : BOOL;\n  qa : BOOL;\n  qg : BOOL;\n  qs : BOOL;\nEND_VAR\n")


def guid(o):
    return str(vp.prop(vp.unwrap(o), "guid"))


def aspect(objmgr, o):
    u = vp.unwrap(o)
    meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    return vp.prop(vp.prop(meta, "Object"), "Implementation")


def put_fresh(objmgr, o, aspect_type):
    """A freshly constructed aspect of `aspect_type` on `o`'s Implementation, committed."""
    import System
    u = vp.unwrap(o)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    try:
        vp.nwl_set(vp.prop(meta, "Object"), "Implementation", System.Activator.CreateInstance(aspect_type))
        objmgr.SetObject(meta, True, None)
        return "committed"
    except Exception as e:
        try:
            objmgr.SetObject(meta, False, None)
        except Exception:
            pass
        return "FAILED: %s" % str(e).splitlines()[0][:200]


def network_assign(impl, target, source, view):
    """One network `target := source`, as CodesysNetworkWriter writes an assignment of a leaf, and the view."""
    if vp.prop(vp.prop(impl, "NetworkList"), "Count") == 0:
        ok, why = vp.call(impl, "AppendNetwork", [vp.nwl_new(impl, "Network")])
        if not ok:
            raise Exception("AppendNetwork: %s" % why)
    net = vp.prop(impl, "NetworkList")[0]
    asg = vp.nwl_new(net, "BoxTreeAssign")
    vp.nwl_set(asg, "RValue", vp.nwl_new(net, "BoxTreeOperand", vp.nwl_new(net, "Operand", source)))
    vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [vp.nwl_new(net, "Operand", target)])
    vp.call(net, "AppendTree", [asg])
    vp.nwl_set(impl, "DefaultViewMode", view)


def write_text(objmgr, o, text):
    """CodesysObjectModel.WriteSourceText's implementation half: checkout, TextDocument.Text, commit."""
    u = vp.unwrap(o)
    meta = objmgr.GetObjectToModify(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    try:
        doc = vp.prop(vp.prop(vp.prop(meta, "Object"), "Implementation"), "TextDocument")
        vp.nwl_set(doc, "Text", text)
        objmgr.SetObject(meta, True, None)
        return "committed"
    except Exception as e:
        try:
            objmgr.SetObject(meta, False, None)
        except Exception:
            pass
        return "FAILED: %s" % str(e).splitlines()[0][:200]


def child_named(node, name):
    for k in vp.walk(node, 0, 2):
        try:
            if k.get_name() == name:
                return k
        except Exception:
            pass
    return None


def run_and_read(app, keys):
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
    out = {}
    for k in keys:
        try:
            out[k] = str(oa.read_value("PLC_PRG.fb.%s" % k))
        except Exception as e:
            out[k] = "?(%s)" % str(e)[:80]
    oa.stop()
    oa.logout()
    return out


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "member-language-change")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\n  fb : VltMc_Fb;\nEND_VAR\n")
    prg.textual_implementation.replace("fb();\n")

    donor = app.create_pou(name="VltMc_DonorFbd", type=PouType.Program, language=ImplementationLanguages.fbd)
    donor.textual_declaration.replace("PROGRAM VltMc_DonorFbd\nVAR\nEND_VAR\n")
    donor_st = app.create_pou(name="VltMc_DonorSt", type=PouType.Program, language=ImplementationLanguages.st)
    donor_st.textual_declaration.replace("PROGRAM VltMc_DonorSt\nVAR\nEND_VAR\n")
    nwl_type = aspect(objmgr, donor).GetType()
    st_type = aspect(objmgr, donor_st).GetType()
    log("aspect classes: %s | %s" % (nwl_type.FullName, st_type.FullName))

    fb = app.create_pou(name="VltMc_Fb", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fb.textual_declaration.replace(FB_DECL)
    fb.textual_implementation.replace("Meth();\nAct();\nqg := Prop;\nProp := TRUE;\n")
    m = fb.create_method("Meth", "BOOL")
    m.textual_implementation.replace("qm := a;\n")
    act = fb.create_action("Act")
    act.textual_implementation.replace("qa := a;\n")
    p = fb.create_property("Prop", "BOOL")
    getter = child_named(p, "Get")
    getter.textual_implementation.replace("Prop := a;\n")
    setter = child_named(p, "Set")
    setter.textual_implementation.replace("qs := a;\n")

    sites = [("method", m, "qm", "qm"), ("action", act, "qa", "qa"), ("property_get", getter, "Prop", "qg"), ("property_set", setter, "qs", "qs")]

    msgs = vp.build_messages(app, system, Severity)
    log("")
    log("=== 0. the ST members, built: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
    log("   run (all TRUE): %s" % run_and_read(app, ["qm", "qa", "qg", "qs"]))

    log("")
    log("=== 1. each member: ST -> a FRESH NWLImplementationObject, network `x := na`, view Fbd ===")
    for site, obj, target, _ in sites:
        g0 = guid(obj)
        r = put_fresh(objmgr, obj, nwl_type)
        log("   %-13s swap: %s; aspect now %s; same guid: %s" %
            (site, r, aspect(objmgr, obj).GetType().Name, guid(obj) == g0))
        try:
            vp.nwl_edit(objmgr, obj, lambda impl, t=target: network_assign(impl, t, "na", "Fbd"))
            log("   %-13s network written: %s network(s), view %s" %
                (site, vp.prop(vp.nwl_read(objmgr, obj), "Count"), vp.prop(aspect(objmgr, obj), "DefaultViewMode")))
        except Exception as e:
            log("   %-13s network write FAILED: %s" % (site, str(e).splitlines()[0][:200]))
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
    log("   run (all FALSE: the new network bodies run): %s" % run_and_read(app, ["qm", "qa", "qg", "qs"]))

    log("")
    log("=== 2. each member: network -> a FRESH STImplementationObject, text `x := a;` ===")
    for site, obj, target, _ in sites:
        g0 = guid(obj)
        r = put_fresh(objmgr, obj, st_type)
        log("   %-13s swap: %s; aspect now %s; same guid: %s" %
            (site, r, aspect(objmgr, obj).GetType().Name, guid(obj) == g0))
        log("   %-13s write '%s := a;': %s" % (site, target, write_text(objmgr, obj, "%s := a;\n" % target)))
    msgs = vp.build_messages(app, system, Severity)
    log("   build: %s" % ("CLEAN" if not msgs else " | ".join(msgs)))
    log("   run (all TRUE: the new ST bodies run): %s" % run_and_read(app, ["qm", "qa", "qg", "qs"]))

    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
