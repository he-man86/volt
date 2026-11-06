# -*- coding: utf-8 -*-
# Authors the stored box states of openspec nwl-box-storage-map into a COPY of the CODESYS fixture project, committed as
# its OWN fixture `test/fixtures/nwl-schema/CodesysBoxStates.3.5.21.40.project`: one PROGRAM per state the recording marks
# `live` (`test/fixtures/nwl-schema/box-states.3.5.21.40.json`), each holding one network with one box. The box is the one the
# editor's own insert makes (`_3S.CoDeSys.NWLEditor.InsertBox`, the command the IDE runs), then its members are set to
# what the recording states, through the object manager, every new object with an Id of its own.
#
# The project is then saved, closed and opened again, and every state is read back against the recording: a state the IDE
# did not keep across a reopen fails the run, by id.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.3.5.21.40.project"
#   $env:VOLT_BOX_STATES    = "<repo>\packages\volt-cli\test\fixtures\nwl-schema\box-states.3.5.21.40.json"
#   $env:VOLT_PROBE_OUT     = "<scratch>\CodesysBoxStates.3.5.21.40.project"
#   $env:VOLT_PROBE_LOG     = "<scratch>\author-box-states.log"
#   powershell -File packages/volt-cli/scripts/ide.ps1 up -Vendor codesys -Instance <yours> -CodesysCulture en -RunScript <this file>
#   (wait for "done" in the log, with a timeout) ; powershell -File ... ide.ps1 down -Vendor codesys -Instance <yours>
#
# A state the IDE faults on is not in the file: the recording marks it `fault` and it is never committed to a project.
#
# ASCII ONLY.
from __future__ import print_function
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp
import clr
clr.AddReference("System.Windows.Forms")
import System
import System.Windows.Forms as WF
from System.Reflection import BindingFlags as B

log, done = vp.logger("author-box-states.log")
ALL = B.Public | B.NonPublic | B.Instance | B.FlattenHierarchy


def find_type(name):
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = a.GetType(name, False)
        except Exception:
            t = None
        if t is not None:
            return t
    raise Exception("no type '%s' is loaded" % name)


def pump(n=8):
    for _ in range(n):
        WF.Application.DoEvents()
        time.sleep(0.03)


_next_id = [900000]


def with_id(o):
    """A fresh NWL object with an Id no other holds: two objects sharing the fresh -1 make CODESYS pop an internal error."""
    _next_id[0] += 1
    t = o.GetType()
    p = t.GetProperty("Id", ALL)
    if p is None or not p.CanWrite:
        for i in t.GetInterfaces():
            p = i.GetProperty("Id")
            if p is not None and p.CanWrite:
                break
    p.SetValue(o, System.Int64(_next_id[0]), None)
    return o


def new(sample, name, *args):
    return with_id(vp.nwl_new(sample, name, *args))


class Ide(object):
    def __init__(self, proj):
        self.proj = proj
        self.handle = None
        for c in proj.get_children():
            self.handle = vp.prop(vp.unwrap(c), "handle")
            if self.handle is not None:
                break
        self.om = vp.object_manager()
        engine = find_type("_3S.CoDeSys.Core.SystemInstances").GetProperty("Engine").GetValue(None, None)
        self.frame = vp.prop(engine, "Frame")

    def guid(self, o):
        return vp.prop(vp.unwrap(o), "guid")

    def open_view(self, o):
        ok, stub = vp.call(self.om, "GetMetaObjectStub", [self.handle, self.guid(o)])
        if not ok:
            raise Exception(str(stub))
        ok, factory = vp.call(self.frame, "SelectEditorViewFactory", [stub])
        if not ok:
            raise Exception(str(factory))
        ok, view = vp.call(self.frame, "OpenEditorView", [stub, factory, None])
        if not ok:
            raise Exception(str(view))
        pump(15)
        return view

    def insert_box(self, o, box_type, instance, eneno):
        """The editor's own insert on the POU's empty network, as its batch command runs it."""
        view = self.open_view(o)
        editor = vp.prop(vp.prop(view, "Editor"), "ImplementationEditorView")
        cell = list(vp.prop(vp.prop(editor, "GfxEdControl"), "Cells"))[0]
        tag = str(cell.Tag)
        if box_type.upper() == "EXECUTE":
            args = ["EXECUTE", "???", "-3", "eneno", "", "m := 1;", tag, tag + ",Left", "", ""]
        elif eneno:
            args = [box_type, instance, "-1", "eneno", ",Left", tag, tag + ",Left", "", ""]
        else:
            args = [box_type, instance, "-1", "Left", tag, tag + ",Left", "", ""]
        insert = System.Activator.CreateInstance(find_type("_3S.CoDeSys.NWLEditor.InsertBox"), System.Array[System.Object]([editor]))
        insert.ByArguments(System.Array[str](args))
        pump(3)
        self.frame.CloseView(view)
        pump(3)

    def edit(self, o, fn):
        ok, meta = vp.call(self.om, "GetObjectToModify", [self.handle, self.guid(o)])
        if not ok:
            raise Exception(str(meta))
        fn(vp.prop(vp.prop(meta, "Object"), "Implementation"))
        self.om.SetObject(meta, True, None)

    def read(self, o):
        ok, meta = vp.call(self.om, "GetObjectToRead", [self.handle, self.guid(o)])
        if not ok:
            raise Exception(str(meta))
        return vp.prop(vp.prop(meta, "Object"), "Implementation")


def set_params(lst, names, types):
    for _ in range(len(list(vp.prop(lst, "Names")))):
        lst.RemoveParam(0)
    for i, n in enumerate(names):
        lst.AppendParam(n, types[i] if i < len(types) else "")


def set_flags(f, bits):
    for b in bits:
        setattr(f, b, True)


def apply_state(net, row):
    box = net.GetTree(0)
    box.BoxType = row["boxType"]
    vp.prop(box, "Instance").OperandExpr = row["instance"]
    box.CallType = System.Enum.Parse(find_type("_3S.CoDeSys.Core.LanguageModel.Operator"), row["callType"])
    for i in range(len(list(vp.prop(box, "InputItemList"))) - 1, -1, -1):
        box.RemoveInputItem(i)
    for text in row["inputs"]:
        leaf = new(box, "BoxTreeOperand")
        with_id(vp.prop(leaf, "Operand"))
        vp.prop(leaf, "Operand").OperandExpr = text
        box.AppendInputItem(leaf)
    set_params(vp.prop(box, "InputParams"), row["inputNames"], row["inputTypes"])
    if row["inputFlagsLength"] is not None:
        field = box.GetType().GetField("_inputFlags", ALL)
        flags = System.Activator.CreateInstance(field.FieldType)
        for _ in range(row["inputFlagsLength"]):
            flags.Add(System.Activator.CreateInstance(find_type("_3S.CoDeSys.NWLObject.Flags")))
        field.SetValue(box, flags)
    outs = vp.prop(box, "Outputs")
    for i in range(len(list(vp.prop(outs, "List"))) - 1, -1, -1):
        outs.RemoveOutputItem(i)
    for i, text in enumerate(row["outputs"]):
        outs.InsertOutputItem(i, None if text is None else new(box, "Operand", text))
    set_params(vp.prop(box, "OutputParams"), row["outputNames"], row["outputTypes"])
    box.En = row["en"]
    box.Eno = row["eno"]
    set_flags(vp.prop(box, "Flags"), row["flags"])
    box.ContainsExtensibleInputs = row["extensible"]
    i8 = [i for i in box.GetType().GetInterfaces() if i.Name == "IBoxTreeBox8"][0]
    i8.GetProperty("ProvidesSTSnippet").SetValue(box, row["providesSnippet"], None)
    if not row["snippet"]:
        box.STSnippet = None
    if row["position"] == "consumed":
        assign = new(net, "BoxTreeAssign")
        assign.RValue = box
        vp.prop(assign, "Outputs").AppendOutputItem(new(net, "Operand", row["target"]))
        net.SetTree(0, assign)


def stored_outputs(impl):
    net = list(vp.prop(impl, "NetworkList"))[0]
    tree = net.GetTree(0)
    box = vp.prop(tree, "RValue") if tree.GetType().Name == "BoxTreeAssign" else tree
    return [None if o is None else str(vp.prop(o, "OperandExpr")) for o in list(vp.prop(vp.prop(box, "Outputs"), "List"))]


def author(ide, data):
    app = ide.proj.active_application
    for name, spec in sorted(data["callees"].items()):
        kinds = {"Function": PouType.Function, "FunctionBlock": PouType.FunctionBlock, "Program": PouType.Program}
        args = dict(name=name, type=kinds[spec["kind"]], language=ImplementationLanguages.st)
        if spec["kind"] == "Function":
            # scripting creates no FUNCTION without a return type: a callee declaring none (bmFv) gets one here, which the
            # declaration below then replaces
            args["return_type"] = spec.get("returnType") or "BOOL"
        o = app.create_pou(**args)
        o.textual_declaration.replace(spec["declaration"])
        o.textual_implementation.replace(spec["body"])
    languages = {"LD": ImplementationLanguages.ladder, "FBD": ImplementationLanguages.fbd}
    live = [r for r in data["states"] if r.get("live")]
    for row in live:
        name = "BoxState_" + row["id"]
        o = app.create_pou(name=name, type=PouType.Program, language=languages[row["language"]])
        o.textual_declaration.replace(row.get("holder", data["holder"]) % name)
        ide.insert_box(o, row["insertAs"], row["instance"] or "", row["insertEnEno"])
        ide.edit(o, lambda impl, row=row: apply_state(list(vp.prop(impl, "NetworkList"))[0], row))
    log("authored %d states" % len(live))
    return live


try:
    src = (vp.projects_from_env() or [""])[0]
    out = os.environ["VOLT_PROBE_OUT"].strip()
    with open(os.environ["VOLT_BOX_STATES"].strip()) as f:
        data = json.load(f)
    proj = vp.open_copy(projects, src, "author-box-states")
    live = author(Ide(proj), data)
    proj.save_as(out)
    proj.close()
    log("saved %s" % out)
    proj = projects.open(out)
    ide = Ide(proj)
    failed = []
    for row in live:
        found = [x for x in proj.find("BoxState_" + row["id"], True) if x.get_name() == "BoxState_" + row["id"]]
        held = stored_outputs(ide.read(found[0]))
        if held != row["outputs"]:
            failed.append("%s: %r, recorded %r" % (row["id"], held, row["outputs"]))
    if failed:
        raise Exception("not kept across the reopen: " + "; ".join(failed[:20]))
    log("reopened: every state's output list is as recorded")
    proj.close()
    done()
except Exception:
    done(True)
