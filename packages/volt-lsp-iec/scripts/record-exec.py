# -*- coding: utf-8 -*-
# The CODESYS half of the execution recorder (unify-conformance-suite; first built for transpile-st-to-rust design §7).
#
# Driven by `record-exec.ts`, never by hand: it writes the cases JSON, launches CODESYS headless with this as the
# runscript, and reads back what this writes. For each case: create the fixture's units, write PLC_PRG gated on a cycle
# counter, build, run in SIMULATION, read every variable path, then REMOVE what was created - so the next case starts
# from the committed project.
#
# Measured on SP21, and each point is load-bearing:
#   - there is no single-cycle step on the SCRIPTING surface, hence the counter gate and the done-flag poll
#     (`packages/volt-cli/scripts/probe-online-state.py`);
#   - the online object only works inside a running script (ScriptOnline peeks an execution stack that is empty
#     outside one), which is why this is a runscript and not a bridge op;
#   - login with OnlineChangeOption.NEVER, not Force: an online change KEEPS variable values across a code change,
#     so the previous case's counter would leak into the next one. Each case records its cycle count so the
#     replay can prove the gate held;
#   - a fixture's units load through create_dut / create_pou / create_method / create_action / create_property and
#     `textual_declaration` / `textual_implementation`; create_property makes BOTH accessors, and the one a fixture
#     does not declare is removed; an instance member reads like a scalar, a composite raises "Invalid pointer size."
#     (`scripts/probe-fixture-run.py`, 2026-09-14).
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


def write(obj, declaration_text, implementation_text):
    if declaration_text:
        obj.textual_declaration.replace(declaration_text)
    if implementation_text:
        obj.textual_implementation.replace(implementation_text)


def create_unit(app, u):
    kind = u["kind"]
    if kind == "dut":
        obj = app.create_dut(u["name"], DutType.Structure)
    elif kind == "function_block":
        obj = app.create_pou(name=u["name"], type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    elif kind == "program":
        obj = app.create_pou(name=u["name"], type=PouType.Program, language=ImplementationLanguages.st)
    elif kind == "function":
        # a function REQUIRES a return type at create; the written declaration then sets the real one
        obj = app.create_pou(name=u["name"], type=PouType.Function, language=ImplementationLanguages.st, return_type="INT")
    elif kind == "gvl":
        obj = app.create_gvl(u["name"])
    elif kind == "interface":
        obj = app.create_interface(u["name"])
    else:
        raise Exception("no create for a %s" % kind)
    write(obj, u["declaration"], u["implementation"])
    for m in u["members"]:
        if m["kind"] == "method":
            write(obj.create_method(name=m["name"]), m["declaration"], m["implementation"])
        elif m["kind"] == "action":
            write(obj.create_action(name=m["name"]), None, m["implementation"])
        elif m["kind"] == "property":
            po = obj.create_property(name=m["name"])
            write(po, m["declaration"], None)
            for acc in ("get", "set"):
                kids = [k for k in po.get_children() if k.get_name().lower() == acc]
                if acc in m and kids:
                    write(kids[0], m[acc]["declaration"], m[acc]["implementation"])
                elif kids:
                    kids[0].remove()
    return obj


def run_case(app, prg, c):
    created = []
    try:
        for u in c["units"]:
            try:
                created.append(create_unit(app, u))
            except Exception as e:
                return {"error": "not loadable: %s %s: %s" % (u["kind"], u["name"], str(e)[:160])}
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
            values = {}
            unreadable = {}
            try:
                raw = oa.read_values(["PLC_PRG." + n for n in names])
                values = dict(zip(names, [ascii_escaped(v) for v in raw]))
            except Exception:
                # one path the IDE will not read must not lose the others: read them one by one and say which failed
                for n in names:
                    try:
                        values[n] = ascii_escaped(oa.read_value("PLC_PRG." + n))
                    except Exception as e:
                        unreadable[n] = ascii_escaped(str(e)[:120])
            result = {"cycles": values.pop(N), "values": values}
            if unreadable:
                result["unreadable"] = unreadable
            return result
        finally:
            try:
                oa.stop()
            except Exception:
                pass
            oa.logout()
    finally:
        for obj in reversed(created):
            try:
                obj.remove()
            except Exception as e:
                log("%s: REMOVE FAILED: %s" % (c["name"], e))


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
