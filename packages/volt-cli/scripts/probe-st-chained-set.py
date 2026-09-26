# Does CODESYS SP21 ST accept a CHAINED assignment that mixes `:=` with `S=` / `R=`? (openspec
# network-text-literal-nwl, task 1.9; review 7.15.) Network text writes one BoxTreeAssign that drives several
# coils as `x := y S= v;`. The text is never compiled, so this is not a correctness question - it decides whether
# that spelling is also legal ST, which is what the LSP (parity, not better) may accept without a diagnostic.
#
# Each case replaces PLC_PRG's body on a COPY of the fixture and builds; the build's messages are the answer.
#
#   $env:VOLT_PROBE_PROJECT = "<repo>\packages\volt-cli\test\fixtures\CodesysTestProject.project"
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-st-chained-set.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("st-chained-set.log")

DECL = "PROGRAM PLC_PRG\nVAR\n  a : BOOL;\n  b : BOOL;\n  c : BOOL;\n  d : BOOL;\nEND_VAR\n"
# The first case must NOT be clean: a probe whose build never reports anything would log CLEAN for every case.
CASES = [
    ("control: an error", "a := zz;"),
    ("control: plain chain", "a := b := c;"),
    ("control: S= alone", "a S= c;"),
    ("control: R= alone", "a R= c;"),
    (":= then S=", "a := b S= c;"),
    (":= then R=", "a := b R= c;"),
    ("S= then :=", "a S= b := c;"),
    ("S= then R=", "a S= b R= c;"),
    ("three targets", "a := b S= d R= c;"),
    ("S= with an expression", "a := b S= c AND d;"),
]

try:
    src = (vp.projects_from_env() or [""])[0]
    if not src or not os.path.exists(src):
        log("VOLT_PROBE_PROJECT not set or missing: %r" % src)
        raise SystemExit
    proj = vp.open_copy(projects, src, "st-chained-set")
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]
    prg.textual_declaration.replace(DECL)
    for label, body in CASES:
        prg.textual_implementation.replace(body + "\n")
        msgs = vp.build_messages(app, system, Severity)
        log("%-24s %-26s -> %s" % (label, body, "CLEAN" if not msgs else ""))
        for m in msgs:
            log("      " + m)
    proj.close()
    log("done")
except SystemExit:
    pass
except Exception:
    done(error=True)
finally:
    done()
