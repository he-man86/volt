# -*- coding: utf-8 -*-
# Which object does a CODESYS build diagnostic inside a METHOD / PROPERTY ACCESSOR / ACTION point at, and what are
# its Position / PositionOffset / Length?
#
# openspec `codesys-diagnostic-child-names` tasks 1.1-1.3. Seen in the field (PLCAssist `c802b74d`, SP21): a stray
# `VAR ... END_VAR` after the implementation marker of a METHOD came back as `C0578 Unexpected statement` with
# `name: ""`, while the same build's errors in FB and PRG bodies came back named. The bridge resolves
# `IMessage.ObjectGuid` by walking TOP-LEVEL items only; this asks what that guid actually IS.
#
# The runscript for a normal GUI CODESYS, launched through ide.ps1 on a fixture COPY:
#   pwsh scripts/ide.ps1 up -Vendor codesys -Instance dcn -RunScript scripts/probe-diagnostic-child-guid.py -Wait
# It runs `run_pipe_production.py` verbatim (fixture open + the shipped host, so the pipe is served as `up` serves
# it), then AUTHORS FB_DcnBody / FB_DcnDecl / FB_DcnMeth (methods MCalc + MExecute, property PProp, action AAct)
# through scripting, all valid, and builds a CONTROL (no numbered message). Then each SCENARIO below plants ONE fault
# at a known line/column of one object, builds, and logs every numbered message the MessageStorage holds - read
# through the same static the bridge reads (`APEnvironment.MessageStorage`) - with what its ObjectGuid resolves to
# in the project tree and its Position / PositionOffset / Length; the object is then restored. Faults are planted at
# known places so the units can be FITTED, not guessed (several differ in one thing only: a longer line 1, spaces
# for a tab). It ends by leaving a parse error in the FB body and in each kind of child and stays up serving the
# pipe, so the published diagnostic can be read from `build` for the same project. Evidence for DIALECT C27.
#
# ASCII ONLY.
from __future__ import print_function
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import voltprobe as vp

_LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(_HERE, "diagnostic-child-guid.log")
with open(_LOG, "w") as _f:
    _f.write("")


# NOT `_log`: the host script exec'd below defines its own `_log` (see probe-dut-subtype-push.py).
def _plog(s):
    with open(_LOG, "a") as f:
        f.write(str(s) + "\n")


_host = os.path.join(_HERE, "run_pipe_production.py")
with open(_host) as _f:
    exec(compile(_f.read(), _host, "exec"))


def _static(type_name, member):
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType(type_name)
        except Exception:
            continue
        if t is None:
            continue
        from System.Reflection import BindingFlags as B
        flags = B.Public | B.NonPublic | B.Static | B.FlattenHierarchy
        p = t.GetProperty(member, flags)
        if p is not None:
            return p.GetValue(None, None)
        f = t.GetField(member, flags)
        if f is not None:
            return f.GetValue(None)
    return None


def _chain(node):
    parts = []
    n = node
    for _ in range(20):
        if n is None:
            break
        try:
            parts.append(n.get_name())
        except Exception:
            break
        try:
            n = n.parent
        except Exception:
            break
    return "/".join(reversed(parts))


def _guid_of(node):
    g = vp.prop(vp.unwrap(node), "guid")
    if g is None:
        try:
            g = node.guid
        except Exception:
            g = None
    return g


NL = "\n"
TAB = "\t"


def _src(*lines):
    return NL.join(lines) + NL


VALID = {
    "body.decl": _src("FUNCTION_BLOCK FB_DcnBody", "VAR", TAB + "x : INT;", "END_VAR"),
    "body.impl": _src("x := 1;"),
    "decl.decl": _src("FUNCTION_BLOCK FB_DcnDecl", "VAR", TAB + "x : INT;", "END_VAR"),
    "calc.decl": _src("METHOD MCalc : INT", "VAR_INPUT", TAB + "a : INT;", "END_VAR"),
    "calc.impl": _src("MCalc := a;"),
    "exec.impl": _src("MExecute := TRUE;"),
    "get.impl": _src("PProp := 1;"),
    "act.impl": _src("x := 1;"),
}

STRAY = ["VAR", TAB + "q : INT;", "END_VAR"]

# (label, object.aspect, text, where the planted fault is: "line L col C" counted inside that aspect's own text)
SCENARIOS = [
    ("B1 FB body", "body.impl", _src("x := 1;", "x := 2;", "  zzBody1 := 3;"), "impl line 3 col 3"),
    ("B2 FB body", "body.impl", _src("x := 1;", "x := 2;", "x := 3;", "x := 4;", "        zzBody2 := 5;"), "impl line 5 col 9"),
    ("B3 FB body, long line 1", "body.impl", _src("x := 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1;", "x := 2;", "  zzBody1 := 3;"), "impl line 3 col 3"),
    ("B4 FB body, mid-line", "body.impl", _src("x := 1;", "x := 2 + zzMid;"), "impl line 2 col 10 (statement at col 1)"),
    ("D1 FB decl", "decl.decl", _src("FUNCTION_BLOCK FB_DcnDecl", "VAR", TAB + "x : INT;", TAB + "y : NoSuchType;", "END_VAR"), "decl line 4 col 2 (type at col 6)"),
    ("D2 FB decl", "decl.decl", _src("FUNCTION_BLOCK FB_DcnDecl", "VAR", TAB + "x : INT;", TAB + "x2 : INT;", TAB + "x3 : INT;", TAB + "y : NoSuchType;", "END_VAR"), "decl line 6 col 2 (type at col 6)"),
    ("D3 FB decl, spaces", "decl.decl", _src("FUNCTION_BLOCK FB_DcnDecl", "VAR", TAB + "x : INT;", "        y : NoSuchType;", "END_VAR"), "decl line 4 col 9 (type at col 13)"),
    ("M1 method body", "calc.impl", _src("MCalc := a;", "    zzMeth := 2;"), "impl line 2 col 5"),
    ("M2 method body", "calc.impl", _src("MCalc := a;", "MCalc := a;", "MCalc := a;", " zzMeth := 2;"), "impl line 4 col 2"),
    ("M3 method decl", "calc.decl", _src("METHOD MCalc : INT", "VAR_INPUT", TAB + "a : INT;", TAB + "b : NoSuchType;", "END_VAR"), "decl line 4 col 2 (type at col 6)"),
    ("P1 property GET body", "get.impl", _src("PProp := 1;", "PProp := zzGet;"), "impl line 2 col 1 (zzGet at col 10)"),
    ("A1 action body", "act.impl", _src("x := 1;", "zzAct := 1;"), "impl line 2 col 1"),
    ("X1 stray VAR in a method", "exec.impl", _src(*(["MExecute := TRUE;"] + STRAY)), "impl line 2 col 1 (c802b74d)"),
    ("X2 stray VAR, line 4", "exec.impl", _src(*(["MExecute := TRUE;"] * 3 + STRAY)), "impl line 4 col 1"),
]

# Left in place after the scenarios, so the pipe's `build` can be read against it: a parse error in the FB body itself
# and in each kind of child (method, property accessor, action).
FINAL = [
    ("body.impl", _src(*(["x := 1;"] + STRAY))),
    ("exec.impl", _src(*(["MExecute := TRUE;"] + STRAY))),
    ("get.impl", _src(*(["PProp := 1;"] + STRAY))),
    ("act.impl", _src(*(["x := 1;"] + STRAY))),
]


def _set(objs, key, text):
    o, aspect = key.split(".")
    node = objs[o]
    (node.textual_declaration if aspect == "decl" else node.textual_implementation).replace(text)


def _author(proj):
    app = proj.active_application
    objs = {}
    objs["body"] = app.create_pou(name="FB_DcnBody", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    objs["decl"] = app.create_pou(name="FB_DcnDecl", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    objs["decl"].textual_implementation.replace(_src("x := 1;"))
    fm = app.create_pou(name="FB_DcnMeth", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fm.textual_declaration.replace(_src("FUNCTION_BLOCK FB_DcnMeth", "VAR", TAB + "x : INT;", "END_VAR"))
    fm.textual_implementation.replace(_src("x := x + 1;"))
    objs["calc"] = fm.create_method(name="MCalc", return_type="INT", language=ImplementationLanguages.st)
    objs["exec"] = fm.create_method(name="MExecute", return_type="BOOL", language=ImplementationLanguages.st)
    objs["exec"].textual_declaration.replace(_src("METHOD MExecute : BOOL"))
    pr = fm.create_property(name="PProp", return_type="INT", language=ImplementationLanguages.st)
    for acc in pr.get_children():
        if acc.get_name().lower() == "get":
            objs["get"] = acc
    objs["act"] = fm.create_action(name="AAct", language=ImplementationLanguages.st)
    for k in sorted(VALID.keys()):
        _set(objs, k, VALID[k])

    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace(_src("PROGRAM PLC_PRG", "VAR", TAB + "a : FB_DcnBody;", TAB + "b : FB_DcnDecl;",
                                         TAB + "c : FB_DcnMeth;", TAB + "i : INT;", TAB + "ok : BOOL;", "END_VAR"))
    prg.textual_implementation.replace(_src("a();", "b();", "c();", "ok := c.MExecute();", "i := c.MCalc(a := 1);",
                                            "i := c.PProp;", "c.AAct();"))
    return app, objs


def _dump(store, byguid):
    n = 0
    for cat in store.Categories:
        ok, msgs = vp.call(store, "GetMessages", [cat])
        if not ok:
            _plog("  GetMessages(%s) failed: %s" % (cat, msgs))
            continue
        for m in msgs:
            if vp.prop(m, "Number") is None:
                continue
            n += 1
            g = vp.prop(m, "ObjectGuid")
            node = byguid.get(str(g))
            pos = vp.prop(m, "Position")
            _plog("  %s%04d %-10s %r" % (vp.prop(m, "Prefix"), int(vp.prop(m, "Number")), vp.prop(m, "Severity"), vp.prop(m, "Text")))
            _plog("      guid -> %s" % (_chain(node) if node is not None else ("<EMPTY>" if str(g).startswith("00000000-") else "<not in tree: %s>" % g)))
            _plog("      Position=%s (hex %x) PositionOffset=%s Length=%s" % (pos, int(pos), vp.prop(m, "PositionOffset"), vp.prop(m, "Length")))
    if n == 0:
        _plog("  (no numbered messages)")


try:
    proj = projects.primary
    _plog("project: %s" % proj.path)
    app, objs = _author(proj)
    byguid = {}
    for node in vp.walk(proj, 0, 30):
        g = _guid_of(node)
        if g is not None:
            byguid[str(g)] = node
    store = _static("_3S.CoDeSys.ScriptDriverSystem.APEnvironment", "MessageStorage")

    app.build()
    _plog("== CONTROL: every object valid")
    _dump(store, byguid)
    for label, key, text, where in SCENARIOS:
        _set(objs, key, text)
        app.build()
        _plog("== %s  [%s]  planted at %s" % (label, key, where))
        _plog("   text=%r" % text)
        _dump(store, byguid)
        _set(objs, key, VALID[key])
    for key, text in FINAL:
        _set(objs, key, text)
    app.build()
    _plog("== FINAL (left in place for the pipe's build)")
    _dump(store, byguid)
    _plog("done - the IDE stays up, serving the pipe")
except Exception:
    import traceback
    _plog(traceback.format_exc())
