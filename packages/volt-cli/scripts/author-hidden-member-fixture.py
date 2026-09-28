# Authors `VltFixtureMembers` INTO the CODESYS fixture project: an ST function block whose members Volt does not show
# (a CFC method, an SFC action) beside members it does (an ST method), so the live e2e can push the FB, its ST member
# and a hidden member's declaration and prove the hidden bodies are never written (openspec implementation-keyword
# 3b.1, `e2e/graphical/hidden-members.test.ts`).
#
# WHY a script and not a file: Volt never creates a diagram (there is no text form to push), and a hand-written body
# would be a shape Volt invented rather than one CODESYS wrote. `create_method` / `create_action` accept a diagram
# language, as `create_pou` did for `VltFixtureCfc` (DIALECT D19), so the IDE authors every byte.
#
# It works on a COPY and saves the copy to VOLT_PROBE_OUT; the caller moves it over the committed fixture.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   $env:VOLT_PROBE_OUT     = "<scratch>\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\author-hidden-member-fixture.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("author-hidden-member-fixture.log")

NAME = "VltFixtureMembers"

try:
    src = (vp.projects_from_env() or [""])[0]
    out = (os.environ.get("VOLT_PROBE_OUT") or "").strip()
    if not src or not os.path.exists(src) or not out:
        log("VOLT_PROBE_PROJECT / VOLT_PROBE_OUT not set or missing: %r %r" % (src, out))
        raise SystemExit
    proj = vp.open_copy(projects, src, "author-hidden-members")
    app = proj.active_application
    if app.find(NAME, True):
        log("%s already exists in the fixture - nothing to author" % NAME)
        raise SystemExit

    fb = app.create_pou(name=NAME, type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    fb.textual_declaration.replace(
        "FUNCTION_BLOCK %s\nVAR_INPUT\n\tbGo : BOOL;\nEND_VAR\nVAR\n\tnTick : INT;\nEND_VAR\n" % NAME)
    fb.textual_implementation.replace("nTick := nTick + 1;")
    log("created %s (ST)" % NAME)

    shown = fb.create_method(name="Visible", return_type="BOOL", language=ImplementationLanguages.st)
    shown.textual_declaration.replace("METHOD Visible : BOOL\nVAR_INPUT\n\tbIn : BOOL;\nEND_VAR\n")
    shown.textual_implementation.replace("Visible := bIn;")
    log("created Visible (ST method)")

    cfc = fb.create_method(name="CfcStep", return_type="BOOL", language=ImplementationLanguages.cfc)
    cfc.textual_declaration.replace("METHOD CfcStep : BOOL\nVAR_INPUT\n\tbIn : BOOL;\nEND_VAR\n")
    log("created CfcStep (CFC method)")

    sfc = fb.create_action(name="SfcRun", language=ImplementationLanguages.sfc)
    log("created SfcRun (SFC action)")

    app.build()
    proj.save_as(out)
    log("saved %s" % out)
    done()
except SystemExit:
    done()
except Exception:
    done(error=True)
