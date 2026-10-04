# -*- coding: utf-8 -*-
# WHAT DOES CODESYS'S OWN VIEW SWITCH (LD <-> FBD) DO WITH A NETWORK THE TARGET VIEW HAS NO DRAWING FOR?
# (openspec bridge-refusal-review 3.10, DIALECT N23's open half.)
#
# Both Volt writers flip a body's view by setting `DefaultViewMode` and writing the SAME network (network text has
# no per-view rule), so an LD body holding a PARALLEL branch flipped to `IMPLEMENTATION FBD` is accepted and pulls
# back FBD with the PARALLEL unchanged. The question is whether the vendor's own View command would have done the
# same, or converted the network, or refused. Asked of the command itself, not of the member Volt writes:
#
#   1. two POUs are built through the object model, as CodesysNetworkWriter builds them -
#        VltVs_Ld  (LD view):  out := PARALLEL(IN := go, a, b)               (BoxShortCircuit, no FBD drawing)
#                              out2 := a AND PARALLEL(MODE := Sequential, b, go)
#                              out3 := a AND b                               (control: draws in both)
#        VltVs_Fbd (FBD view): iout := ADD(i1, i2)                          (a data box, no contact or coil)
#                              out := GT(ADD(i1, i2), i3)
#                              out3 := a AND b                               (control)
#   2. each POU is opened in its NWL editor (GUI - the command needs `Frame.EditorViewInFront`) and the vendor's
#      `ViewAsFBD` / `ViewAsLD` command is EXECUTED (its ExecuteBatch, what the View menu item calls), there and back;
#   3. after every switch: DefaultViewMode, a structural dump of every network (node types, ids, operands, modes),
#      the POU's language model (the compiler's input - a conversion that changes meaning changes it), a picture of
#      the editor (Control.DrawToBitmap, to VOLT_PROBE_SHOTS or %TEMP%), and finally the project is saved, CLOSED
#      and REOPENED, so what is read is what the IDE stored, not the editor's working copy; then a build.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --runscript="<repo>\packages\volt-cli\scripts\probe-view-switch.py"
#   (NO --noUI: the View command acts on the editor in front, and there is no editor without a frame.)
#
# Works on a COPY of the project. ASCII ONLY - IronPython 2.7.
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("view-switch.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")
SHOTS = os.environ.get("VOLT_PROBE_SHOTS") or os.path.join(tempfile.gettempdir(), "volt-view-switch")

DECL = ("PROGRAM %s\nVAR\n  a : BOOL := TRUE;\n  b : BOOL;\n  go : BOOL := TRUE;\n  out : BOOL;\n  out2 : BOOL;\n"
        "  out3 : BOOL;\n  i1 : INT := 2;\n  i2 : INT := 3;\n  i3 : INT := 4;\n  iout : INT;\nEND_VAR\n")

SKIP = set(["Parent", "Network", "Owner", "Root", "NetworkItem", "ParentItem", "ParentTree", "Container"])
# The editor's working state, not the network: undo/diff bookkeeping (Accepted .. Inserted), the serializer's own
# member list, and TheAddress/TheSymbolComment, which a fresh load leaves unset where a session holds "" (first run:
# the only difference between an editor session and the reopened file besides Ordinary). None is serialized.
SKIP |= set(["Accepted", "Added", "Changed", "ChangedContents", "Deleted", "DeletedAfter", "DeletedBefore", "Inserted",
             "SerializableValueNames", "TheAddress", "TheSymbolComment"])
# IBoxTreeBox4.Ordinary is NOT serialized (absent from BoxTreeBox's SerializableValueNames) and the editor's
# BoxTreeSymbolInfoSetter recomputes it for the view in front ("an AND/OR drawn as contacts is not ordinary"). First
# run: the ONLY member a View switch changed. Reported on its own line, so the network dump compares what is stored.
SKIP.add("Ordinary")
ORDINARY = []
# Review 3b's run (every member accounted for, below) found two more members the dump had been dropping unsaid:
# `GenericObjectService`, on every node - a service handle, no stored value (its ToString is its type name) - and
# `BoxTreeBox.Image`, a Bitmap the editor caches once it has drawn the box: set in the editing session, null after the
# reopen, so it read the reopen as "networks CHANGED" on every box. Neither is serialized; EDITOR_ONLY is CHECKED
# against each node's own SerializableValueNames on every run (logged at the end), so the skip is a measured fact.
EDITOR_ONLY = ["Ordinary", "Image", "GenericObjectService"]
SKIP |= set(EDITOR_ONLY)
CHECKED = EDITOR_ONLY + ["TheAddress", "TheSymbolComment"]
SERIALIZED = {}


def nwl_types(o):
    return o is not None and o.GetType().Assembly.GetName().Name.startswith("NWLObject")


# Every member the dump could NOT compare as a stored value, by "Type.Member" -> why (review 3b: the first version
# skipped a throwing getter and a list holding a non-NWL element without saying so, so "networks UNCHANGED" claimed
# more than it compared). Such a member is still written into the dump - a throwing getter as its exception type, a
# non-NWL object or element as its type and ToString() - so a switch that changes it changes the dump; this list is
# what that comparison is only as good as, logged at the end.
NOT_COMPARED = {}


def clr_text(v):
    """A non-NWL CLR value as the dump writes it: its type and the CLR's own ToString() - not IronPython's str(), which
    for a type that does not override ToString is a repr carrying the object's address, so every read differs (the
    first run with this dump read every network CHANGED on GenericObjectService's address alone). Compared, but only as
    deep as ToString."""
    return "<%s: %s>" % (v.GetType().FullName, v.ToString())


def dump_node(o, depth, seen, out, indent):
    """Every readable member of an NWL node: a scalar by value, an NWL node or list of them recursively, anything
    else by type + ToString() and listed in NOT_COMPARED - generic, so a member this probe does not know to name
    still shows a conversion, and nothing is dropped without saying so."""
    import System
    if o is None:
        out.append(indent + "<null>")
        return
    if depth > 14:
        out.append(indent + "<depth>")
        return
    key = System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(o)
    if key in seen:
        out.append(indent + "<seen %s>" % o.GetType().Name)
        return
    seen.add(key)
    t = o.GetType()
    out.append(indent + t.Name)
    names = vp.prop(o, "SerializableValueNames")
    if names is not None:
        names = set(str(n) for n in names)
        for m in CHECKED:
            if any(p.Name == m for p in t.GetProperties(vp.bf())):
                SERIALIZED["%s.%s" % (t.Name, m)] = SERIALIZED.get("%s.%s" % (t.Name, m), False) or m in names
    else:
        SERIALIZED["%s.<no SerializableValueNames: skips unchecked>" % t.Name] = None
    if t.Name == "BoxTreeBox":
        ORDINARY.append("%s#%s=%s" % (vp.prop(o, "BoxType"), vp.prop(o, "Id"), vp.prop(o, "Ordinary")))
    for p in sorted(t.GetProperties(vp.bf()), key=lambda x: x.Name):
        if p.GetIndexParameters().Length != 0 or not p.CanRead or p.Name in SKIP:
            continue
        member = "%s.%s" % (t.Name, p.Name)
        try:
            v = p.GetValue(o, None)
        except Exception as ex:
            clr_ex = getattr(ex, "clsException", None)
            inner = getattr(clr_ex, "InnerException", None) or clr_ex
            name = inner.GetType().Name if inner is not None else type(ex).__name__
            out.append(indent + "  .%s = <getter throws %s>" % (p.Name, name))
            NOT_COMPARED[member] = "getter throws " + name
            continue
        if v is None:
            continue
        vt = v.GetType()
        if vt.IsPrimitive or vt.IsEnum or isinstance(v, (str, unicode)) or vt.FullName == "System.Guid":
            out.append(indent + "  .%s = %s" % (p.Name, v))
        elif nwl_types(v) and not isinstance(v, System.Collections.IEnumerable):
            out.append(indent + "  .%s:" % p.Name)
            dump_node(v, depth + 1, seen, out, indent + "    ")
        elif isinstance(v, System.Collections.IEnumerable):
            try:
                items = [x for x in v]
            except Exception:
                out.append(indent + "  .%s = <enumeration throws>" % p.Name)
                NOT_COMPARED[member] = "enumeration throws"
                continue
            out.append(indent + "  .%s[%d]:" % (p.Name, len(items)))
            for x in items:
                if x is None or isinstance(x, (str, unicode)) or x.GetType().IsPrimitive:
                    out.append(indent + "    - %r" % (x,))
                elif nwl_types(x):
                    dump_node(x, depth + 1, seen, out, indent + "    ")
                else:
                    out.append(indent + "    - " + clr_text(x))
                    NOT_COMPARED[member] = "element %s compared by ToString" % x.GetType().FullName
        else:
            out.append(indent + "  .%s = %s" % (p.Name, clr_text(v)))
            NOT_COMPARED[member] = "%s compared by ToString" % vt.FullName


def impl_of(objmgr, pou):
    u = vp.unwrap(pou)
    meta = objmgr.GetObjectToRead(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
    obj = vp.prop(meta, "Object")
    return obj, vp.prop(obj, "Implementation")


def snapshot(objmgr, pou):
    """(view, networks dump, language model, Ordinary per box) of the object as the object manager hands it out."""
    obj, impl = impl_of(objmgr, pou)
    out = []
    del ORDINARY[:]
    nets = vp.prop(impl, "NetworkList")
    for i, net in enumerate(nets):
        out.append("network %d:" % (i + 1))
        n = vp.prop(net, "NetworkItemCount") or 0
        for k in range(n):
            ok, tree = vp.call(net, "GetTree", [k])
            if ok and tree is not None:
                dump_node(tree, 0, set(), out, "  ")
    ok, lm = vp.call(obj, "GetLanguageModel", [])
    return (str(vp.prop(impl, "DefaultViewMode")), "\n".join(out), (lm if ok else "<no language model: %s>" % lm),
            " ".join(ORDINARY))


def op(net, text):
    return vp.nwl_new(net, "Operand", text)


def leaf(net, text):
    return vp.nwl_new(net, "BoxTreeOperand", op(net, text))


def box(net, typ, inputs):
    b = vp.nwl_new(net, "BoxTreeBox")
    vp.nwl_set(b, "BoxType", typ)
    vp.nwl_set(vp.prop(b, "Instance"), "OperandExpr", "")
    for i in inputs:
        ok, why = vp.call(b, "AppendInputItem", [i])
        if not ok:
            raise Exception("AppendInputItem: %s" % why)
    return b


def parallel(net, mode, feed, branches):
    import System
    p = vp.nwl_new(net, "BoxTreeParallel")
    if feed is not None:
        ok, why = vp.call(p, "SetInputTree", [0, feed])
        if not ok:
            raise Exception("SetInputTree: %s" % why)
    for br in branches:
        ok, why = vp.call(p, "Append", [br])
        if not ok:
            raise Exception("Append: %s" % why)
    for src in [p.GetType()] + list(p.GetType().GetInterfaces()):
        pr = src.GetProperty("Mode")
        if pr is not None and pr.CanWrite:
            pr.SetValue(p, System.Enum.Parse(pr.PropertyType, mode), None)
            return p
    raise Exception("no writable Mode on BoxTreeParallel")


def build(impl, view, rungs):
    """`rungs` = [(coil, fn(net) -> rvalue)], one network each, as CodesysNetworkWriter writes an assignment."""
    while vp.prop(vp.prop(impl, "NetworkList"), "Length") or vp.prop(vp.prop(impl, "NetworkList"), "Count"):
        ok, why = vp.call(impl, "RemoveNetwork", [0])
        if not ok:
            raise Exception("RemoveNetwork: %s" % why)
    for coil, rv in rungs:
        ok, why = vp.call(impl, "AppendNetwork", [vp.nwl_new(impl, "Network")])
        if not ok:
            raise Exception("AppendNetwork: %s" % why)
        nets = vp.prop(impl, "NetworkList")
        net = nets[len(nets) - 1]
        asg = vp.nwl_new(net, "BoxTreeAssign")
        vp.nwl_set(asg, "RValue", rv(net))
        vp.call(vp.prop(asg, "Outputs"), "AppendOutputItem", [op(net, coil)])
        vp.call(net, "AppendTree", [asg])
    vp.nwl_set(impl, "DefaultViewMode", view)


def engine():
    """The NWL editor's own `APEnvironment.Engine` - the object its View command reaches the frame through."""
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.NWLEditor.APEnvironment")
        except Exception:
            continue
        if t is None:
            continue
        p = t.GetProperty("Engine", vp.bf() | System.Reflection.BindingFlags.Static)
        if p is not None:
            return p.GetValue(None, None), asm
    return None, None


def nwl_pane(view):
    for c in (vp.prop(view, "Panes") or []):
        if c.GetType().Name == "NWLEditor":
            return c
    return None


def pump():
    import System
    for _ in range(20):
        System.Windows.Forms.Application.DoEvents()
        # Join, not Sleep: Sleep on the STA thread is an IronPython RuntimeWarning, which CODESYS files as a
        # script ERROR message - the first run's build reported it as the build's only "error".
        System.Threading.Thread.CurrentThread.Join(50)


def shot(pane, name):
    import System
    if pane is None:
        return "<no pane>"
    if not os.path.isdir(SHOTS):
        os.makedirs(SHOTS)
    w, h = max(pane.Width, 50), max(pane.Height, 50)
    bmp = System.Drawing.Bitmap(w, h)
    pane.DrawToBitmap(bmp, System.Drawing.Rectangle(0, 0, w, h))
    path = os.path.join(SHOTS, name + ".png")
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png)
    bmp.Dispose()
    return path


def run_command(asm, type_name):
    import System
    t = asm.GetType("_3S.CoDeSys.NWLEditor." + type_name)
    if t is None:
        return "no command type " + type_name
    cmd = System.Activator.CreateInstance(t)
    enabled = vp.prop(cmd, "Enabled")
    m = t.GetMethod("ExecuteBatch", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance |
                    System.Reflection.BindingFlags.DeclaredOnly)
    if m is None:
        return "no ExecuteBatch on " + type_name
    m.Invoke(cmd, System.Array[System.Object]([System.Array[System.String]([])]))
    return "executed (Enabled before=%s, Checked after=%s)" % (enabled, vp.prop(cmd, "Checked"))


def report(label, before, after):
    log("   %s: view %s -> %s; networks %s; language model %s" % (
        label, before[0], after[0],
        "UNCHANGED" if before[1] == after[1] else "CHANGED",
        "UNCHANGED" if before[2] == after[2] else "CHANGED"))
    log("      Ordinary: %s  ->  %s" % (before[3] or "-", after[3] or "-"))
    if before[1] != after[1]:
        log("      --- networks before ---")
        log(before[1])
        log("      --- networks after ---")
        log(after[1])
    if before[2] != after[2]:
        log("      --- language model before ---")
        log(before[2])
        log("      --- language model after ---")
        log(after[2])


try:
    import clr
    clr.AddReference("System.Windows.Forms")
    clr.AddReference("System.Drawing")
    import System
    import System.Windows.Forms
    import System.Drawing
    import System.Drawing.Imaging
    src = (vp.projects_from_env() or [DEFAULT])[0]
    log("project copy of: %s" % src)
    objmgr = vp.object_manager()
    proj = vp.open_copy(projects, src, "view-switch")
    path = proj.path
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\nEND_VAR\n")

    ld = app.create_pou(name="VltVs_Ld", type=PouType.Program, language=ImplementationLanguages.ladder)
    ld.textual_declaration.replace(DECL % "VltVs_Ld")
    fbd = app.create_pou(name="VltVs_Fbd", type=PouType.Program, language=ImplementationLanguages.fbd)
    fbd.textual_declaration.replace(DECL % "VltVs_Fbd")

    vp.nwl_edit(objmgr, ld, lambda impl: build(impl, "Ld", [
        ("out", lambda n: parallel(n, "BoxShortCircuit", leaf(n, "go"), [leaf(n, "a"), leaf(n, "b")])),
        ("out2", lambda n: box(n, "AND", [leaf(n, "a"), parallel(n, "Sequential", None, [leaf(n, "b"), leaf(n, "go")])])),
        ("out3", lambda n: box(n, "AND", [leaf(n, "a"), leaf(n, "b")])),
    ]))
    vp.nwl_edit(objmgr, fbd, lambda impl: build(impl, "Fbd", [
        ("iout", lambda n: box(n, "ADD", [leaf(n, "i1"), leaf(n, "i2")])),
        ("out", lambda n: box(n, "GT", [box(n, "ADD", [leaf(n, "i1"), leaf(n, "i2")]), leaf(n, "i3")])),
        ("out3", lambda n: box(n, "AND", [leaf(n, "a"), leaf(n, "b")])),
    ]))
    log("build after authoring: %s" % (vp.build_messages(app, system, Severity) or "CLEAN"))

    eng, asm = engine()
    frame = vp.prop(eng, "Frame")
    log("NWL editor assembly: %s; frame: %s" % (None if asm is None else asm.GetName().Version,
                                                None if frame is None else frame.GetType().Name))
    # Maximized, so the pictures show every network rather than the first two.
    form = frame if isinstance(frame, System.Windows.Forms.Form) else None
    if form is not None:
        form.WindowState = System.Windows.Forms.FormWindowState.Maximized
        pump()
    if frame is None:
        raise Exception("no frame - run WITHOUT --noUI")

    stored = {}
    for pou, name, first, back in [(ld, "VltVs_Ld", "ViewAsFBD", "ViewAsLD"), (fbd, "VltVs_Fbd", "ViewAsLD", "ViewAsFBD")]:
        log("")
        log("=== %s: %s, then %s ===" % (name, first, back))
        u = vp.unwrap(pou)
        stub = objmgr.GetMetaObjectStub(vp.prop(u, "handle") or 0, vp.prop(u, "guid"))
        view = frame.OpenEditorView(stub, System.Guid.Empty, None)
        pump()
        pane = nwl_pane(view)
        log("   editor: %s, in front: %s" % (None if pane is None else pane.GetType().FullName,
                                             vp.prop(frame, "EditorViewInFront") is view))
        s0 = snapshot(objmgr, pou)
        log("   picture: " + shot(pane, name + "-0-" + s0[0]))
        log("   %s: %s" % (first, run_command(asm, first)))
        pump()
        s1 = snapshot(objmgr, pou)
        log("   picture: " + shot(pane, name + "-1-" + s1[0]))
        report(first, s0, s1)
        log("   %s: %s" % (back, run_command(asm, back)))
        pump()
        s2 = snapshot(objmgr, pou)
        log("   picture: " + shot(pane, name + "-2-" + s2[0]))
        report(back, s1, s2)
        report("round trip", s0, s2)
        # Leave it on the FIRST switch's view, so the reopen reads a switched body.
        log("   %s again: %s" % (first, run_command(asm, first)))
        pump()
        stored[name] = (s0, snapshot(objmgr, pou))
        ok, why = vp.call(frame, "CloseView", [view])
        log("   CloseView: %s" % ("ok" if ok else why))
        pump()

    log("")
    log("=== build with both POUs switched ===")
    log("   %s" % (vp.build_messages(app, system, Severity) or "CLEAN"))

    log("")
    log("=== saved, closed, reopened: what the IDE STORED ===")
    proj.save()
    proj.close()
    proj = projects.open(path)
    for name, (s0, s_switched) in sorted(stored.items()):
        pou = [o for o in proj.find(name, True)][0]
        s = snapshot(objmgr, pou)
        report(name + " (reopened vs. authored)", s0, s)
        log("   %s reopened == read in the editor session after the switch: %s" % (name, s[:3] == s_switched[:3]))
    log("   build after reopen: %s" % (vp.build_messages(proj.active_application, system, Severity) or "CLEAN"))
    log("")
    log("skipped as editor-only, checked against the node's SerializableValueNames (True = serialized, the skip is WRONG):")
    for m in sorted(SERIALIZED):
        log("   %s: %s" % (m, SERIALIZED[m]))
    log("")
    log("members compared only by ToString or not readable (%d; everything else compared by value):" % len(NOT_COMPARED))
    for m in sorted(NOT_COMPARED):
        log("   %s: %s" % (m, NOT_COMPARED[m]))
    log("")
    log("pictures in: " + SHOTS)
    done()
except SystemExit:
    raise
except Exception:
    done(error=True)
