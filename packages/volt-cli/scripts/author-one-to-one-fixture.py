# Authors the bridge-one-to-one objects into a COPY of the CODESYS fixture project, committed as its OWN fixture
# `test/fixtures/CodesysOneToOne.project` (openspec bridge-one-to-one 2.2): one object of
# each class and member the live red tests (`test/e2e/one-to-one/`) pin, made the way the vendor's OWN Add Object makes
# it, so every byte of the committed fixture is the IDE's - never hand-edited, never Volt's own push (which makes the
# plain class: the defect under test).
#
#   CheckDivDInt         a check function (POUObjectCheckFunction, KindOfCheckFunction CheckDivInt32) - constructed as
#                        `create-each-class` constructs one; a check function bears its check's name (any check kind
#                        pins the class; the live test creates a CheckDivInt64 of its own).
#   VltOto_TextEnum      a text-list enumeration (TextListEnumerationObjectFactory)
#   (no persistent list: one per application, and the live test creates its own, test/e2e/one-to-one)
#   VltOto_AbsBase       an ABSTRACT function block holding `Pick`, an AbstractPOUMethodObject (constructed)
#   VltOto_Excluded      a function block excluded from the build (build_properties.exclude_from_build)
#   VltOto_ExtTask       a task of kind ExternalEvent (its external event VltOto_Event) calling VltOto_ExtCalled
#   VltOto_CommentTask   a cyclic task calling VltOto_Called, the call carrying a comment (PouObject.Comment)
#   VltOto_Trans         a transition object under the SFC POU VltFixtureSfc (create_transition)
#
# NEVER into CodesysTestProject.project itself: that file is the HOST project of the LSP oracle recorders
# (packages/volt-lsp-iec record:exec / record:language) and the fixture the committed vendor-facts rows were measured on.
# A check function there is called on every DINT division of every recorded fixture (a division by zero would yield
# x/1 instead of stopping the task), and two more tasks change the task-configuration rows (C22's last-task case).
#
# It works on a COPY of CodesysTestProject and saves it to VOLT_PROBE_OUT; the caller moves it to
# test/fixtures/CodesysOneToOne.project. Every step is logged with what the vendor answered; one that the vendor refuses
# is logged and the run fails - nothing is half-authored into the fixture.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   $env:VOLT_PROBE_OUT     = "<scratch>\CodesysOneToOne.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\author-one-to-one-fixture.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
import clr
import System

log, done = vp.logger("author-one-to-one-fixture.log")


def find_type(name):
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = a.GetType(name, False)
        except Exception:
            t = None
        if t is not None:
            return t
    raise Exception("no type '%s' is loaded" % name)


def new(type_name):
    return System.Activator.CreateInstance(find_type(type_name))


def child(parent, name):
    for c in parent.get_children():
        if c.get_name() == name:
            return c
    raise Exception("'%s' has no child '%s'" % (parent.get_name(), name))


def handle_of(proj):
    for c in proj.get_children():
        h = vp.prop(vp.unwrap(c), "handle")
        if h is not None:
            return h
    raise Exception("no project handle")


def guid_of(o):
    return vp.prop(vp.unwrap(o), "guid")


def by_factory(proj, parent, factory, name):
    om = vp.object_manager()
    f = new(factory)
    o = f.Create()
    g = om.AddObject(handle_of(proj), guid_of(parent), System.Guid.NewGuid(), o, name, -1)
    f.ObjectCreated(handle_of(proj), g)
    return child(parent, name)


def by_class(proj, parent, cls, name, decl, init):
    """The class by its parameterless constructor, its empty aspects from the POU factory's own DoCreate - the path
    `create-each-class` measured (vendor-facts.codesys.py `_make_vendor`)."""
    om = vp.object_manager()
    o = new(cls)
    t = o.GetType()
    holes = [p for p in ("Interface", "Implementation")
             if t.GetProperty(p, vp.bf()) is not None and t.GetProperty(p, vp.bf()).GetValue(o, None) is None]
    if holes:
        pf = new("_3S.CoDeSys.POUObject.POUObjectFactory")
        st = new("_3S.CoDeSys.STObject.STImplementationObjectFactory")
        lvl = System.Enum.Parse(find_type("_3S.CoDeSys.POUObject.POULevel"), "Standard")
        src = pf.GetType().GetMethod("DoCreate", vp.bf()).Invoke(pf, System.Array[System.Object]([decl, st, lvl]))
        for p in holes:
            t.GetProperty(p, vp.bf()).SetValue(o, src.GetType().GetProperty(p, vp.bf()).GetValue(src, None), None)
    for k, v in init:
        t.GetProperty(k, vp.bf()).SetValue(o, v, None)
    om.AddObject(handle_of(proj), guid_of(parent), System.Guid.NewGuid(), o, name, -1)
    made = child(parent, name)
    # The declaration is written through scripting AFTER the add, as the vendor-facts core does: DoCreate's aspect does
    # not carry the text into the added object (measured 2026-10-13: an abstract method so made pulled with no
    # declaration - "the IDE reports no declaration for this member").
    made.textual_declaration.replace(decl)
    return made


def read_obj(proj, o):
    ok, meta = vp.call(vp.object_manager(), "GetObjectToRead", [handle_of(proj), guid_of(o)])
    if not ok:
        raise Exception("GetObjectToRead: %s" % meta)
    return vp.prop(meta, "Object")


def cls_of(proj, o):
    return read_obj(proj, o).GetType().FullName


def comment_first_call(proj, task, comment):
    """The task's first call entry's Comment, through the object manager's own checkout (the scripting call list
    iterates names only)."""
    om = vp.object_manager()
    ok, meta = vp.call(om, "GetObjectToModify", [handle_of(proj), guid_of(task)])
    if not ok:
        raise Exception("GetObjectToModify: %s" % meta)
    obj = vp.prop(meta, "Object")
    pous = vp.prop(obj, "PouList")
    if pous is None:
        ok, pous = vp.call(obj, "GetSerializableValue", ["PouList"])   # the archive's own member (census 0.1)
        if not ok:
            raise Exception("the task archives no PouList: %s" % pous)
    entries = list(pous)
    if not entries:
        raise Exception("the task calls nothing to comment")
    entries[0].Comment = comment
    om.SetObject(meta, True, None)


try:
    src = (vp.projects_from_env() or [""])[0]
    out = (os.environ.get("VOLT_PROBE_OUT") or "").strip()
    if not src or not os.path.exists(src) or not out:
        log("VOLT_PROBE_PROJECT / VOLT_PROBE_OUT not set or missing: %r %r" % (src, out))
        raise SystemExit
    proj = vp.open_copy(projects, src, "author-one-to-one")
    app = proj.active_application
    if app.find("VltOto_TextEnum", True):
        log("the bridge-one-to-one objects already exist in the fixture - nothing to author")
        raise SystemExit

    sel = System.Enum.Parse(find_type("_3S.CoDeSys.POUObject.CheckFunctionSelection"), "CheckDivInt32")
    chk = by_class(proj, app, "_3S.CoDeSys.POUObject.POUObjectCheckFunction", "CheckDivDInt",
                   "FUNCTION CheckDivDInt : DINT\nVAR_INPUT\n\tdivisor : DINT;\nEND_VAR\n",
                   [("KindOfCheckFunction", sel)])
    chk.textual_implementation.replace("IF divisor = 0 THEN\n\tCheckDivDInt := 1;\nELSE\n\tCheckDivDInt := divisor;\nEND_IF\n")
    om = vp.object_manager()
    log("CheckDivDInt: %s, kind %s" % (cls_of(proj, chk), vp.prop(read_obj(proj, chk), "KindOfCheckFunction")))

    tle = by_factory(proj, app, "_3S.CoDeSys.TextList.TextListEnumerationObjectFactory", "VltOto_TextEnum")
    tle.textual_declaration.replace("TYPE VltOto_TextEnum :\n(\n\tRed := 0,\n\tGreen := 5,\n\tBlue\n);\nEND_TYPE\n")
    log("VltOto_TextEnum: made")


    absfb = app.create_pou(name="VltOto_AbsBase", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    absfb.textual_declaration.replace("FUNCTION_BLOCK ABSTRACT VltOto_AbsBase\nVAR\nEND_VAR\n")
    pick = by_class(proj, absfb, "_3S.CoDeSys.MethodObject.AbstractPOUMethodObject", "Pick", "METHOD ABSTRACT Pick : INT\n", [])
    log("VltOto_AbsBase.Pick: %s" % cls_of(proj, pick))

    exc = app.create_pou(name="VltOto_Excluded", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    exc.textual_declaration.replace("FUNCTION_BLOCK VltOto_Excluded\nVAR\n\tn : INT;\nEND_VAR\n")
    exc.textual_implementation.replace("n := n + 1;\n")
    exc.build_properties.exclude_from_build = True
    log("VltOto_Excluded: exclude_from_build %s" % exc.build_properties.exclude_from_build)

    called = app.create_pou(name="VltOto_Called", type=PouType.Program, language=ImplementationLanguages.st)
    called.textual_declaration.replace("PROGRAM VltOto_Called\nVAR\n\tn : INT;\nEND_VAR\n")
    called.textual_implementation.replace("n := n + 1;\n")

    tc = [o for o in app.get_children() if "Task" in o.get_name() and "Configuration" in o.get_name()]
    if len(tc) != 1:
        raise Exception("the application holds %d Task Configuration objects" % len(tc))
    kinds = find_type("_3S.CoDeSys.TaskConfig.KindOfTask")
    ext = tc[0].create_task("VltOto_ExtTask")
    ext.kind_of_task = System.Enum.Parse(kinds, "ExternalEvent")
    ext.external_event = "VltOto_Event"
    ext_called = app.create_pou(name="VltOto_ExtCalled", type=PouType.Program, language=ImplementationLanguages.st)
    ext_called.textual_declaration.replace("PROGRAM VltOto_ExtCalled\nVAR\n\tn : INT;\nEND_VAR\n")
    ext_called.textual_implementation.replace("n := n + 1;\n")
    ext.pous.add("VltOto_ExtCalled")              # a task calling nothing is a build warning
    log("VltOto_ExtTask: kind %s, external event %r, event %r" % (ext.kind_of_task, ext.external_event, ext.event))

    ct = tc[0].create_task("VltOto_CommentTask")
    ct.pous.add("VltOto_Called")
    comment_first_call(proj, ct, "runs first")
    back = vp.call(read_obj(proj, ct), "GetSerializableValue", ["PouList"])[1]
    log("VltOto_CommentTask: calls %s, comments %s" % (list(ct.pous), [e.Comment for e in back]))

    sfc = app.find("VltFixtureSfc", True)[0]
    tr = sfc.create_transition("VltOto_Trans")
    log("VltOto_Trans: %s" % (tr and tr.get_name()))

    for o in (chk, tle, absfb, pick, exc):
        log("%s declaration: %r" % (o.get_name(), o.textual_declaration.text.split("\n")[0]))

    msgs = vp.build_messages(app, system, Severity)
    log("build messages: %d" % len(msgs))
    for m in msgs:
        log("  " + m)
    proj.save_as(out)
    log("saved %s" % out)
    done()
except SystemExit:
    done()
except Exception:
    done(error=True)
