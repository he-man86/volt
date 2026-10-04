# -*- coding: utf-8 -*-
# CAN CODESYS RENAME AN OBJECT THE WAY TWINCAT DOES - CALLERS AND OWN REFERENCES REWRITTEN - HEADLESS?
# (openspec bridge-refusal-review 8.4, DIALECT C2o/C2p.) The scripting `rename` is a plain object rename; TwinCAT's
# ITcSmTreeItem.Name runs XAE's rename refactoring. CODESYS ships the refactoring engine in-proc
# (_3S.CoDeSys.Refactoring.IRefactoringService). This drives CreateRenameLanguageModelProvidingObjectOperation +
# PerformRefactoring with an IRefactoringUI that never shows anything, and logs every text before and after.
#
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" [--noUI] --runscript="<this file>"
# Works on a COPY of the fixture, never saves. ASCII ONLY - IronPython 2.7.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("codesys-refactor-rename.log")
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

import System


def find_type(name):
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType(name)
        except Exception:
            t = None
        if t is not None:
            return t
    return None


def texts(proj, names):
    for n in names:
        o = [x for x in proj.find(n, True)]
        if not o:
            log("   %-8s <absent>" % n)
            continue
        o = o[0]
        log("   %-8s decl=%r" % (n, o.textual_declaration.text))
        try:
            log("   %-8s impl=%r" % ("", o.textual_implementation.text))
        except Exception:
            pass


try:
    src = (vp.projects_from_env() or [DEFAULT])[0]
    proj = vp.open_copy(projects, src, "refactor-rename")
    app = proj.active_application
    fb = app.create_pou(name="FB_A", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fb.textual_declaration.replace("// FB_A helper\nFUNCTION_BLOCK FB_A\nVAR\n\tpSelf : POINTER TO FB_A;\nEND_VAR\n")
    fb.textual_implementation.replace("pSelf := 0; // sets FB_A\n")
    fn = app.create_pou(name="F_A", type=PouType.Function, return_type="BOOL", language=ImplementationLanguages.st)
    fn.textual_declaration.replace("FUNCTION F_A : BOOL\nVAR_INPUT\n\ta : INT;\nEND_VAR\n")
    fn.textual_implementation.replace("F_A := a > 0; // sets F_A\n")
    p = app.create_pou(name="P_Call", type=PouType.Program, language=ImplementationLanguages.st)
    p.textual_declaration.replace("PROGRAM P_Call\nVAR\n\tinst : FB_A; (* an FB_A *)\n\tok : BOOL;\nEND_VAR\n")
    p.textual_implementation.replace("inst();\nok := F_A(a := 1); // calls F_A\n")
    log("before:")
    texts(proj, ["FB_A", "F_A", "P_Call"])

    env = find_type("_3S.CoDeSys.Refactoring.APEnvironment")
    log("Refactoring APEnvironment: %s" % env)
    svc = env.GetProperty("RefactoringService", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic).GetValue(None, None)
    log("service: %s" % svc)
    IUI = find_type("_3S.CoDeSys.Refactoring.IRefactoringUI")
    events = []

    import clr
    clr.AddReference("System.Windows.Forms")
    from System.Windows.Forms import DialogResult

    class SilentUI(System.Object):
        pass

    # IronPython implements a .NET interface by subclassing it.
    ui_iface = clr.GetPythonType(IUI)

    class Headless(ui_iface):
        def __init__(self):
            self._warning = None
        def ShowDialog(self, owner):
            events.append("ShowDialog")
            log("   -- inside ShowDialog, the DESTINATION project %s:" % self.dst)
            om = vp.object_manager()
            for nm, node in [("FB_A", fb), ("F_A", fn), ("P_Call", p)]:
                g = vp.prop(vp.unwrap(node), "guid")
                try:
                    meta = om.GetObjectToRead(self.dst, g)
                    o = vp.prop(meta, "Object")
                    def at(aspect):
                        a = vp.prop(o, aspect)
                        d = vp.prop(a, "TextDocument") if a is not None else None
                        return vp.prop(d, "Text") if d is not None else None
                    log("      %s -> name=%r decl=%r impl=%r" % (nm, vp.prop(meta, "Name"), at("Interface"), at("Implementation")))
                except Exception as e:
                    log("      %s: %s" % (nm, e))
            return DialogResult.OK
        def Initialize(self, a, b, op, guids, errors):
            log("   Initialize(%s, %s) guids: %s" % (a, b, [str(g) for g in guids]))
            self.dst = b
            events.append("Initialize(%s,%s,%d objects,%s errors)" % (a, b, guids.Count if guids else 0, errors.Count if errors else 0))
        def Refresh(self, n):
            events.append("Refresh(%s)" % n)
        def NextTask(self, s, n, t):
            events.append("NextTask(%s)" % s)
        def get_Aborting(self):
            return False
        def TaskProgress(self, s, n):
            pass
        def TaskFinished(self):
            events.append("TaskFinished")
        def get_Warning(self):
            return self._warning
        def set_Warning(self, v):
            events.append("Warning=%s" % v)
            self._warning = v

    log("pre-build: %s" % (vp.build_messages(app, system, Severity) or "CLEAN"))
    for evname in ["RefactoringCommitted", "RefactoringAborted", "RefactoringPerformed"]:
        def handler(sender, args, evname=evname):
            events.append("EVENT %s %s" % (evname, args))

        getattr(svc, evname).__iadd__(handler) if False else None
        try:
            ev = getattr(svc, evname)
            ev += handler
        except Exception as e:
            log("   cannot subscribe %s: %s" % (evname, e))
    factories = svc.Factories
    for old, new, node in [("FB_A", "FB_B", fb), ("F_A", "F_G", fn)]:
        u = vp.unwrap(node)
        kind = os.environ.get("VOLT_PROBE_OP", "signature")
        if kind == "signature":
            op = factories.CreateRenameSignatureOperation(vp.prop(u, "guid"), old, new)
        else:
            op = factories.CreateRenameLanguageModelProvidingObjectOperation(vp.prop(u, "handle"), vp.prop(u, "guid"), old, new)
        log("op %s -> %s: %s preconfigured=%s reason=%r" % (old, new, op, op.IsPreconfigured, op.Reason))
        del events[:]
        ok = svc.PerformRefactoring(op, Headless())
        log("   PerformRefactoring -> %s; ui events: %s" % (ok, events))
        log("   object now named: %s" % node.get_name())
    log("after:")
    texts(proj, ["FB_B", "F_G", "P_Call", "FB_A", "F_A"])
    msgs = vp.build_messages(app, system, Severity)
    log("build: %s" % ("CLEAN" if not msgs else "; ".join(msgs)[:1500]))
    done()
except Exception:
    done(error=True)
