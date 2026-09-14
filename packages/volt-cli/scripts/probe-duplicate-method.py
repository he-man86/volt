# What does CODESYS actually say for C0582 - two methods with the same name in one FB, no 'overloaded' attribute?
#
# The LSP's wording is PROVISIONAL (volt-lsp-iec `messages.ts` duplicateMethod): `verify-catalog.ts` could never
# confirm it, because the pipe bridge cannot PUSH the repro - the second same-named child collides on create - and
# its recorded `actual` ("Unknown type: 'FB_Math'") shows the repro never compiled. This builds the repro with the
# scripting API instead, on a fixture COPY, and logs every message the build leaves. If the scripting tree refuses
# the second method, that refusal is the answer: C0582 is unreachable through any Volt path.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-duplicate-method.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("duplicate-method.log")


def messages():
    out = []
    for cat in system.get_message_categories(True):
        for sev in (Severity.FatalError, Severity.Error, Severity.Warning):
            for m in system.get_message_objects(cat, sev):
                out.append("[%s] %s" % (sev, getattr(m, "text", m)))
    return out


try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    proj = vp.open_copy(projects, src, "duplicate-method")
    app = proj.active_application

    # Positive control first: the fixture must build clean before the repro, or its messages mean nothing.
    app.build()
    log("baseline build messages: %r" % messages())

    fb = app.create_pou(name="FB_Math", type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    log("created FB_Math (ST)")

    # Which call shape creates a method AT ALL? Two runs refused the very FIRST `create_method` on "Calc" - once
    # with a positional return type, once with `name=` alone - so before asking the real question, vary the name
    # and the language and log every answer. Only the duplicate attempt after that is the C0582 measurement.
    def try_create(label, **kw):
        try:
            m = fb.create_method(**kw)
            log("create_method %-14s %r -> OK" % (label, kw))
            return m
        except Exception as e:
            log("create_method %-14s %r -> REFUSED: %s" % (label, kw, e))
            return None

    first = None
    name = None
    for label, kw in [
        ("name", {"name": "Calc"}),
        ("name+st", {"name": "Calc", "language": ImplementationLanguages.st}),
        ("othername", {"name": "Compute"}),
        ("othername+st", {"name": "Compute", "language": ImplementationLanguages.st}),
    ]:
        first = try_create(label, **kw)
        if first is not None:
            name = kw["name"]
            break
    if first is None:
        log("NO call shape created a method - C0582's repro cannot be built through scripting either")
        raise SystemExit
    first.textual_declaration.replace("METHOD %s : INT\nVAR_INPUT\n    a : INT;\nEND_VAR\n" % name)

    second = try_create("DUPLICATE", name=name)
    if second is not None:
        second.textual_declaration.replace("METHOD %s : INT\nVAR_INPUT\n    a : INT;\n    b : INT;\nEND_VAR\n" % name)
        log("the tree ACCEPTS a second same-named method - the build below is the C0582 answer")

    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\n    fbm : FB_Math;\nEND_VAR\n")
    prg.textual_implementation.replace("fbm();\n")

    app.build()
    for line in messages():
        log("repro build: %s" % line)
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
