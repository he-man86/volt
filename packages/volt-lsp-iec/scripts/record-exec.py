# -*- coding: utf-8 -*-
# The CODESYS half of the differential-execution recorder (transpile-st-to-rust, design section 7).
#
# Driven by `record-exec.ts`, never by hand: it writes the cases JSON, launches CODESYS headless with this as the
# runscript, and reads back what this writes. For each case, PLC_PRG is replaced with the case's program, gated
# on a cycle counter, and run in SIMULATION; then every variable is read through the scripting online API.
#
# Measured on SP21 by `packages/volt-cli/scripts/probe-online-state.py`, and each point is load-bearing:
#   - there is no single-cycle step on the SCRIPTING surface, hence the counter gate and the done-flag poll;
#   - the online object only works inside a running script (ScriptOnline peeks an execution stack that is empty
#     outside one), which is why this is a runscript and not a bridge op;
#   - login with OnlineChangeOption.NEVER, not Force: an online change KEEPS variable values across a code change,
#     so the previous case's counter would leak into the next one. Each case records its cycle count so the
#     replay can prove the gate held.
#
# ASCII ONLY - this file, and everything it writes: IronPython's json encoder decodes every string as UTF-8 and
# crashed on a genuine U+00E9 read back from a WSTRING. Values leave as `\uXXXX` text (`ascii_escaped`), which
# record-exec.ts turns back into characters.
import json
import os
import shutil
import tempfile
import time
import traceback

CASES = os.environ["VOLT_EXEC_CASES"]
OUT = os.environ["VOLT_EXEC_OUT"]
SRC = os.environ["VOLT_EXEC_PROJECT"]

N = "volt_oracle_n"
DONE = "volt_oracle_done"

logf = open(OUT + ".log", "w")


def log(s):
    logf.write(str(s) + "\n")
    logf.flush()


def ascii_escaped(v):
    # ponytail: a CODESYS display never contains a backslash-u sequence of its own, so record-exec.ts can undo this
    return "".join(ch if ord(ch) < 128 else "\\u%04x" % ord(ch) for ch in unicode(v))


def declaration(c):
    return "PROGRAM PLC_PRG\nVAR\n  %s : INT;\n  %s : BOOL;\n%s\nEND_VAR\n" % (N, DONE, c["vars"])


def implementation(c):
    # `done` is computed BEFORE the body runs, from the count before this cycle's increment, so a RETURN inside the
    # body cannot stop the flag from rising: the body runs exactly `cycles` times, and the flag rises the cycle after.
    return "%s := %s >= %d;\nIF NOT %s THEN\n  %s := %s + 1;\n%s\nEND_IF\n" % (
        DONE, N, c["cycles"], DONE, N, N, c["body"])


def compile_errors():
    """Every error the build left in the message store, as text. `login` only says "compile errors occurred",
    which tells a case author nothing - and a case that does not compile is a wrong CASE, not a vendor answer."""
    texts = []
    for cat in system.get_message_categories(True):
        for sev in (Severity.FatalError, Severity.Error):
            for m in system.get_message_objects(cat, sev):
                texts.append(ascii_escaped(getattr(m, "text", m)))
    return texts


def run_case(app, prg, c):
    prg.textual_declaration.replace(declaration(c))
    prg.textual_implementation.replace(implementation(c))
    app.build()
    errors = compile_errors()
    if errors:
        return {"error": "does not compile: " + " | ".join(errors)}
    # A FRESH online application per case. One reused across logins kept the FIRST program's symbols: every later
    # case logged in fine and then failed its first read with "Invalid variable reference" (measured, 2026-09-13).
    oa = online.create_online_application(app)
    oa.login(OnlineChangeOption.Never, True)
    try:
        oa.start()
        started = time.time()
        flag = None
        while time.time() - started < 10:
            flag = oa.read_value("PLC_PRG." + DONE)
            if flag == "TRUE":
                break
            time.sleep(0.02)
        if flag != "TRUE":
            raise Exception("the done flag never rose (last read %r) - the program did not finish its cycles" % flag)
        names = [N] + list(c["names"])
        raw = oa.read_values(["PLC_PRG." + n for n in names])
        values = dict(zip(names, [ascii_escaped(v) for v in raw]))
        return {"cycles": values.pop(N), "values": values}
    finally:
        try:
            oa.stop()
        except Exception:
            pass
        oa.logout()


try:
    cases = json.load(open(CASES))
    # A COPY: switching the device to simulation and rewriting PLC_PRG must never touch the committed fixture.
    dst = os.path.join(tempfile.gettempdir(), "volt-exec-oracle.project")
    shutil.copyfile(SRC, dst)
    proj = projects.open(dst)
    app = proj.active_application
    prg = [o for o in proj.find("PLC_PRG", True)][0]

    dev = app
    while dev is not None:
        try:
            dev.set_simulation_mode(True)
            break
        except Exception:
            dev = dev.parent
    if dev is None:
        raise Exception("no ancestor of the application accepted set_simulation_mode")
    log("simulation on: %s" % dev.get_name())

    tests = {}
    for c in cases:
        try:
            tests[c["name"]] = run_case(app, prg, c)
        except Exception as e:
            tests[c["name"]] = {"error": str(e)}
            log(traceback.format_exc())
        log("%s: %r" % (c["name"], tests[c["name"]]))

    with open(OUT, "w") as f:
        json.dump({
            "recorded": {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ide": "CODESYS 3.5.21.40 simulation"},
            "tests": tests,
        }, f, indent=2, sort_keys=True)
    log("wrote %s" % OUT)
except Exception:
    log(traceback.format_exc())
finally:
    logf.close()
    try:
        import System
        System.Environment.Exit(0)
    except Exception:
        pass
