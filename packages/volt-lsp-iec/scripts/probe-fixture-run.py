# -*- coding: utf-8 -*-
# PROBE (unify-conformance-suite tasks 3.1): can the headless simulator run a conformance FIXTURE - not just a PLC_PRG
# body - and read an FB instance's members?
#
# Driven by a scratch TS driver that writes the cases JSON (units split by test/conformance/support/fixture-units.ts,
# the PLC_PRG var/body, and the variable paths to read). For each case, on a COPY of the fixture project in simulation:
# create every unit (create_dut / create_pou / create_method / create_action / create_property), write its text, write
# PLC_PRG with the cycle gate record-exec.py uses, build, run, read every path, then DELETE what it created - so the
# next case starts from the committed project. Every step's outcome is logged, a refusal included: the log is the answer.
#
# ASCII ONLY.
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


def messages(sevs):
    out = []
    for cat in system.get_message_categories(True):
        for sev in sevs:
            for m in system.get_message_objects(cat, sev):
                out.append("[%s] %s" % (sev, getattr(m, "text", m)))
    return out


def write(obj, declaration, implementation, what):
    if declaration:
        obj.textual_declaration.replace(declaration)
    if implementation:
        obj.textual_implementation.replace(implementation)
    log("  wrote %s" % what)


def create_unit(app, u):
    kind = u["kind"]
    if kind == "dut":
        obj = app.create_dut(u["name"], DutType.Structure)
    elif kind == "function_block":
        obj = app.create_pou(name=u["name"], type=PouType.FunctionBlock, language=ImplementationLanguages.st)
    elif kind == "program":
        obj = app.create_pou(name=u["name"], type=PouType.Program, language=ImplementationLanguages.st)
    elif kind == "function":
        obj = app.create_pou(name=u["name"], type=PouType.Function, language=ImplementationLanguages.st, return_type="INT")
    elif kind == "gvl":
        obj = app.create_gvl(u["name"])
    elif kind == "interface":
        obj = app.create_interface(u["name"])
    else:
        raise Exception("no create for %s" % kind)
    log("  created %s %s" % (kind, u["name"]))
    write(obj, u["declaration"], u["implementation"], "%s %s" % (kind, u["name"]))
    for m in u["members"]:
        if m["kind"] == "method":
            mo = obj.create_method(name=m["name"])
            write(mo, m["declaration"], m["implementation"], "method %s" % m["name"])
        elif m["kind"] == "action":
            ao = obj.create_action(name=m["name"])
            write(ao, None, m["implementation"], "action %s" % m["name"])
        elif m["kind"] == "property":
            po = obj.create_property(name=m["name"])
            write(po, m["declaration"], None, "property %s" % m["name"])
            for acc in ("get", "set"):
                kids = [k for k in po.get_children() if k.get_name().lower() == acc]
                log("    accessor %s: %d child(ren) named so" % (acc, len(kids)))
                if acc in m and kids:
                    write(kids[0], m[acc]["declaration"], m[acc]["implementation"], "%s.%s" % (m["name"], acc))
                elif kids:
                    kids[0].remove()
                    log("    removed the %s the fixture does not declare" % acc)
    return obj


def run_case(proj, app, prg, c):
    created = []
    try:
        for u in c["units"]:
            created.append(create_unit(app, u))
        prg.textual_declaration.replace("PROGRAM PLC_PRG\nVAR\n  %s : INT;\n  %s : BOOL;\n%s\nEND_VAR\n" % (N, DONE, c["vars"]))
        prg.textual_implementation.replace("%s := %s >= %d;\nIF NOT %s THEN\n  %s := %s + 1;\n%s\nEND_IF\n" % (
            DONE, N, c["cycles"], DONE, N, N, c["body"]))
        app.build()
        build = messages((Severity.FatalError, Severity.Error, Severity.Warning))
        log("  build: %r" % build)
        if [b for b in build if "Error" in b.split("]")[0]]:
            return {"error": "does not compile", "build": build}
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
            values = {}
            for p in [N] + list(c["paths"]):
                try:
                    values[p] = str(oa.read_value("PLC_PRG." + p))
                except Exception as e:
                    values[p] = "<read raised %s>" % str(e)[:120]
            return {"done": flag, "values": values, "build": build}
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
                log("  removed a created object")
            except Exception as e:
                log("  REMOVE FAILED: %s" % e)


try:
    cases = json.load(open(CASES))
    dst = os.path.join(tempfile.gettempdir(), "volt-probe-fixture-run.project")
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
    log("simulation on: %s" % (dev.get_name() if dev is not None else None))
    results = {}
    for c in cases:
        log("== %s" % c["name"])
        try:
            results[c["name"]] = run_case(proj, app, prg, c)
        except Exception:
            results[c["name"]] = {"exception": traceback.format_exc().strip().split("\n")[-1]}
            log(traceback.format_exc())
        log("  -> %r" % results[c["name"]])
    with open(OUT, "w") as f:
        json.dump(results, f, indent=2, sort_keys=True)
except Exception:
    log(traceback.format_exc())
finally:
    logf.close()
    try:
        import System
        System.Environment.Exit(0)
    except Exception:
        pass
