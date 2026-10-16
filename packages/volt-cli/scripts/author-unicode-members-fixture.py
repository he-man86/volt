# -*- coding: utf-8 -*-
# Authors `test/fixtures/CodesysUnicodeMembers.project` (openspec codesys-existing-unicode-members 1.1): the shape of
# PLC Assist chat be8c6faa - a function block named in Chinese holding methods named in Chinese, a DUT whose members are
# named in Chinese - made by the IDE's OWN scripting creates (never Volt's push, whose pre-flight is the defect under
# test), built, and saved. It MEASURES on the way and logs every verdict, so the log is the finding:
#
#   1. the create of a CJK method with the project as it comes (Project Settings > Compile options > "Unicode
#      identifiers" OFF, CODESYS's default) - SP21 refuses it ("The name '...' is not valid for this object.");
#   2. the same create after that option is switched ON through the language model's CompileOptions - the option is
#      what the customer's project has, and what makes CODESYS take the name;
#   3. the identifier shapes Volt's pre-flight judged (vendor-facts identifier-shapes) asked again with the option ON;
#   4. a build of the objects, and the option read back after a save + reopen (it is the PROJECT's).
#
# On a COPY of the fixture project native to this CODESYS (fixture-per-ide-version), saved to VOLT_PROBE_OUT; the caller
# moves it to test/fixtures/CodesysUnicodeMembers.project. A refused step of the authoring (not of the measurement) fails
# the run - nothing is half-authored.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.3.5.21.40.project"
#   $env:VOLT_PROBE_OUT     = "<scratch>\CodesysUnicodeMembers.project"
#   $env:VOLT_PROBE_LOG     = "<scratch>\author-unicode-members-fixture.log"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--culture=en', '--runscript="<repo>\packages\volt-cli\scripts\author-unicode-members-fixture.py"'
#
# ASCII ONLY: every non-ASCII name is a \u escape.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
import clr
import System

log, done = vp.logger("author-unicode-members-fixture.log")

FB = u"\u547d\u4ee4\u961f\u5217\u7ba1\u7406"                            # 命令队列管理
READ_CMD = u"\u4eceModbus\u8bfb\u53d6\u547d\u4ee4"                      # 从Modbus读取命令
ZONE_FREE = u"\u533a\u57df\u53ef\u5360\u7528"                           # 区域可占用
DUT = u"\u70b9\u4f4d\u7ed1\u5b9a\u4fe1\u606f"                           # 点位绑定信息
M_ADDR = u"\u70b9\u4f4d\u5730\u5740"                                    # 点位地址
M_BOUND = u"\u5df2\u7ed1\u5b9a"                                         # 已绑定
COUNT = u"\u8ba1\u6570"                                                 # 计数

# vendor-facts.table.ts SHAPES that are no ASCII identifier, plus CJK with digits and a leading CJK digit
SHAPES = [u"F\u00f6\u00f6bar", u"\u00dcnit", u"\u041f\u0440\u0438\u0432\u0435\u0442", u"\u03b1\u03b2", u"\u540d\u524d",
          u"a\u0663", u"a\u00a0b", u"a\u200bb", u"\u70b91", u"1\u70b9", u"\u70b9_a", u"_\u70b9", u"2Fast", u"My-Name",
          u"a.b", u"`\u70b9`"]


def esc(s):
    return s.encode("unicode_escape").decode("ascii") if hasattr(s, "encode") else repr(s)


def find_type(name):
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = a.GetType(name, False)
        except Exception:
            t = None
        if t is not None:
            return t
    raise Exception("no type '%s' is loaded" % name)


def compile_options():
    t = find_type("_3S.CoDeSys.Engine.APEnvironment")
    provider = t.GetProperty("LMServiceProvider").GetValue(None, None)
    return vp.prop(vp.prop(provider, "ConfigurationService"), "CompileOptions")


def handle_of(proj):
    for c in proj.get_children():
        h = vp.prop(vp.unwrap(c), "handle")
        if h is not None:
            return h
    raise Exception("no project handle")


def store_project_options(proj):
    """The engine's own write of the project option root into the project: OptionStorage.Save(Project) into the
    WorkspaceObject's OptionData, set through the object manager (engine.plugin AbstractPermissionChecker does exactly
    this). Measured: setting CompileOptions.UnicodeIdentifiers reaches the option store at once, but neither a scripting
    save() nor save_as() writes it into the file - reopened, the key is gone - so the option is stored as the engine
    stores it."""
    env = find_type("_3S.CoDeSys.Engine.APEnvironment")
    storage = env.GetProperty("OptionStorage").GetValue(None, None)
    ws = find_type("_3S.CoDeSys.Engine.WorkspaceObject")
    guid = ws.GetField("GUID_WORKSPACEOBJECT").GetValue(None)
    om = vp.object_manager()
    ok, meta = vp.call(om, "GetObjectToModify", [handle_of(proj), guid])
    if not ok:
        raise Exception("GetObjectToModify(WorkspaceObject): %s" % meta)
    stream = System.IO.MemoryStream()
    storage.Save(System.Enum.Parse(find_type("_3S.CoDeSys.Core.Options.OptionRoot"), "Project"), stream)
    obj = vp.prop(meta, "Object")
    obj.GetType().GetProperty("OptionData").SetValue(obj, stream.ToArray(), None)
    om.SetObject(meta, True, None)


def why(e):
    inner = getattr(e, "InnerException", None)
    while inner is not None and getattr(inner, "InnerException", None) is not None:
        inner = inner.InnerException
    src = inner if inner is not None else e
    return esc(u"%s" % (getattr(src, "Message", None) or src))


def try_method(fb, name):
    try:
        m = fb.create_method(name)
    except Exception as e:
        return "refused: " + why(e)
    got = m.get_name()
    m.remove()
    return "created" if got == name else "created as " + esc(got)


try:
    src = (vp.projects_from_env() or [""])[0]
    out = (os.environ.get("VOLT_PROBE_OUT") or "").strip()
    if not src or not os.path.exists(src) or not out:
        log("VOLT_PROBE_PROJECT / VOLT_PROBE_OUT not set or missing: %r %r" % (src, out))
        raise SystemExit
    ver = System.Diagnostics.FileVersionInfo.GetVersionInfo(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName)
    log("CODESYS %s, UI culture %s" % (ver.ProductVersion, System.Globalization.CultureInfo.CurrentUICulture.Name))
    proj = vp.open_copy(projects, src, "author-unicode-members")
    app = proj.active_application
    opts = compile_options()
    log("UnicodeIdentifiers as opened: %s" % vp.prop(opts, "UnicodeIdentifiers"))

    # 1. option OFF (the project as it comes)
    probe = app.create_pou(name="VltUni_Probe", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    log("OFF method %s: %s" % (esc(READ_CMD), try_method(probe, READ_CMD)))
    try:
        p = app.create_pou(name=FB, type=PouType.FunctionBlock, language=ImplementationLanguages.st)
        log("OFF pou %s: created" % esc(FB))
        p.remove()
    except Exception as e:
        log("OFF pou %s: refused: %s" % (esc(FB), why(e)))

    # 2. option ON
    opts.GetType().GetProperty("UnicodeIdentifiers").SetValue(opts, True, None)
    log("UnicodeIdentifiers after set: %s" % vp.prop(opts, "UnicodeIdentifiers"))
    log("ON method %s: %s" % (esc(READ_CMD), try_method(probe, READ_CMD)))

    # 3. the shapes, option ON
    for s in SHAPES:
        log("ON shape method %s: %s" % (esc(s), try_method(probe, s)))
    probe.remove()

    # 4. the be8c6faa objects, then a build
    dut = app.create_dut(DUT, DutType.Structure)
    dut.textual_declaration.replace(u"TYPE %s :\nSTRUCT\n\t%s : INT;\n\t%s : BOOL;\nEND_STRUCT\nEND_TYPE\n" % (DUT, M_ADDR, M_BOUND))
    fb = app.create_pou(name=FB, type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fb.textual_declaration.replace(u"FUNCTION_BLOCK %s\nVAR\n\t%s : INT;\n\tbinding : %s;\nEND_VAR\n" % (FB, COUNT, DUT))
    fb.textual_implementation.replace(u"%s := %s + 1;\n" % (COUNT, COUNT))
    m1 = fb.create_method(READ_CMD)
    m1.textual_declaration.replace(u"METHOD %s : BOOL\nVAR_INPUT\n\taddress : INT;\nEND_VAR\n" % READ_CMD)
    m1.textual_implementation.replace(u"binding.%s := address;\n%s := TRUE;\n" % (M_ADDR, READ_CMD))
    m2 = fb.create_method(ZONE_FREE)
    m2.textual_declaration.replace(u"METHOD %s : BOOL\n" % ZONE_FREE)
    m2.textual_implementation.replace(u"%s := NOT binding.%s;\n" % (ZONE_FREE, M_BOUND))
    log("made %s with %s, %s; DUT %s" % (esc(FB), esc(m1.get_name()), esc(m2.get_name()), esc(dut.get_name())))
    # a program that USES them, so the build compiles every CJK name (an object no task reaches is not compiled)
    caller = app.create_pou(name="VltUni_Caller", type=PouType.Program, language=ImplementationLanguages.st)
    caller.textual_declaration.replace(u"PROGRAM VltUni_Caller\nVAR\n\tfb : %s;\n\tfree : BOOL;\n\tread : BOOL;\nEND_VAR\n" % FB)
    caller.textual_implementation.replace(u"fb();\nfree := fb.%s();\nread := fb.%s(address := 3);\n" % (ZONE_FREE, READ_CMD))
    tc = [o for o in app.get_children() if "Task" in o.get_name() and "Configuration" in o.get_name()][0]
    task = [t for t in tc.get_children()][0]
    task.pous.add("VltUni_Caller")
    log("VltUni_Caller called by task %s" % task.get_name())
    store_project_options(proj)
    msgs = vp.build_messages(app, system, Severity)
    log("build messages: %d" % len(msgs))
    for m in msgs:
        log("  " + esc(u"%s" % m))

    proj.save_as(out)
    log("saved %s" % out)
    proj.close()
    again = projects.open(out)
    log("reopened: UnicodeIdentifiers %s; %s methods %s" % (
        vp.prop(compile_options(), "UnicodeIdentifiers"), esc(FB),
        [esc(c.get_name()) for c in again.active_application.find(FB, True)[0].get_children()]))
    msgs = vp.build_messages(again.active_application, system, Severity)
    log("build after reopen: %d messages" % len(msgs))
    for m in msgs:
        log("  " + esc(u"%s" % m))
    again.close()
    done()
except SystemExit:
    done()
except Exception:
    done(error=True)
