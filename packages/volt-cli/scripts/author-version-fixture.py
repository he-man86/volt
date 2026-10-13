# Makes the CODESYS fixture project NATIVE to one installed CODESYS version (openspec environment-dependency-audit
# 2.5b; owner 2026-10-13: "you need to have 1 project for each CS version" / "you can't reuse them"): a project opened
# from another version's file is upgraded on open, and that is not what a customer on that version has.
#
# Three modes, one per step (VOLT_FX_MODE):
#
#   export     in the version that MADE the source (CodesysTestProject.project: 3.5.21.40) - open a copy of
#              VOLT_FX_PROJECT, export every top-level object recursively as PLCopen XML to VOLT_FX_XML (folder
#              structure kept), and write the source's inventory to VOLT_FX_INVENTORY.
#   import     in EACH version - create an EMPTY project at VOLT_FX_OUT through that version's own scripting, import
#              VOLT_FX_XML into it, add what PLCopen did not carry (below), save, and write its inventory.
#   inventory  open a copy of VOLT_FX_PROJECT and write its inventory (to compare a committed fixture).
#
# What PLCopen does not carry is built in the target version through its own scripting, never copied from another
# version's file: the DEVICE (PLCopen holds no device here - the target's own `CODESYS Control Win V3 x64`, the one of
# that version's number, is added, and the import goes into ITS application), the TASKS (the export holds no Task
# Configuration: export writes them to `<xml>.tasks`, import builds them member for member) and anything the inventory
# diff names. The inventory is the comparison: one line per object (path, type guid, and the facts the bridge reads -
# device id, library references, task settings, a hash of each text) so `diff` names every difference.
#
#   $env:VOLT_FX_MODE = "import"; $env:VOLT_FX_XML = "...\CodesysTestProject.xml"
#   $env:VOLT_FX_OUT = "...\CodesysTestProject.3.5.18.30.project"; $env:VOLT_FX_INVENTORY = "...\inv-3.5.18.30.txt"
#   $env:VOLT_PROBE_LOG = "...\fx-3.5.18.30.log"
#   Start-Process "C:\Program Files\CODESYS 3.5.18.30\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP18 Patch 3"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\author-version-fixture.py"'
#
# ASCII ONLY (IronPython 2.7).
import os
import sys
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("author-version-fixture.log")

DEVICE_TYPE = 4096          # PLC
DEVICE_ID = "0000 0004"     # CODESYS Control Win V3 x64 - the device the 3.5.21.40 fixture holds
TAB = chr(9)
NL = chr(10)


def env(name):
    v = (os.environ.get(name) or "").strip()
    if not v:
        raise Exception("%s is not set" % name)
    return v


def path_of(o):
    parts = []
    cur = o
    for _ in range(40):
        try:
            if cur is None or getattr(cur, "is_root", False):
                break
            parts.insert(0, cur.get_name())
            cur = cur.parent
        except Exception:
            break
    return "/".join(parts)


def digest(s):
    if s is None:
        return "-"
    return hashlib.sha1(s.replace("\r\n", "\n").encode("utf-8")).hexdigest()[:12]


def facts(o):
    out = []
    try:
        if o.is_device:
            d = o.get_device_identification()
            out.append("device=%s/%s/%s" % (d.type, d.id, d.version))
    except Exception as e:
        out.append("device=<%s>" % e)
    try:
        if o.is_libman:
            refs = []
            for r in o.references:
                refs.append("%s(%s)" % (r.name, "|".join(str(getattr(r, a, "?")) for a in LIBRARY_FACTS)))
            out.append("libraries=[%s]" % ", ".join(sorted(refs)))
    except Exception as e:
        out.append("libraries=<%s>" % e)
    try:
        if o.is_task:
            out.append("task=%s" % "|".join(task_settings(o)))
    except Exception as e:
        out.append("task=<%s>" % e)
    for side in ("textual_declaration", "textual_implementation"):
        try:
            if getattr(o, "has_" + side, False):
                out.append("%s=%s" % (side.split("_")[1], digest(getattr(o, side).text)))
        except Exception as e:
            out.append("%s=<%s>" % (side, e))
    return " ".join(out)


LIBRARY_FACTS = ("namespace", "is_placeholder", "is_managed", "is_redirected", "effective_resolution", "system_library",
                 "qualified_only", "optional")


def task_settings(t):
    """A task as the bridge reads it: kind, priority, interval + unit, events, the watchdog, the calls."""
    w = t.watchdog
    return [str(t.kind_of_task), str(t.priority), str(t.interval), str(t.interval_unit), str(t.event or ""),
            str(t.external_event or ""), str(w.time), str(w.time_unit), str(w.sensitivity), str(w.enabled),
            ";".join(str(p) for p in t.pous)]


def inventory(proj, dest):
    lines = []
    for o in vp.walk(proj, limit=30):
        lines.append("%s  [%s] %s" % (path_of(o), o.type, facts(o)))
    f = open(dest, "w")
    f.write("\n".join(lines) + "\n")
    f.close()
    log("inventory: %d object(s) -> %s" % (len(lines), dest))


def own_version():
    return str(System.Diagnostics.FileVersionInfo.GetVersionInfo(
        System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName).FileVersion)


def vkey(v):
    return [int(x) for x in str(v).split(".")]


def device_version():
    """The `CODESYS Control Win V3 x64` a customer on THIS CODESYS adds: the device version equal to the CODESYS version
    (the device repository is shared by every install on the machine, so "the newest" would be another version's), else
    the newest older one, named in the log - never a version number carried over from the source project."""
    own = own_version()
    held = sorted(set(str(d.device_id.version) for d in device_repository.get_all_devices()
                      if d.device_id.type == DEVICE_TYPE and d.device_id.id == DEVICE_ID), key=vkey)
    log("the repository holds %s/%s in: %s" % (DEVICE_TYPE, DEVICE_ID, ", ".join(held)))
    if own in held:
        return own
    older = [v for v in held if vkey(v) <= vkey(own)]
    if not older:
        raise Exception("this CODESYS (%s) has no device %s/%s at or below its version" % (own, DEVICE_TYPE, DEVICE_ID))
    log("no device %s at this CODESYS's own version %s - the newest older one" % (older[-1], own))
    return older[-1]


def find_type(name):
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = a.GetType(name, False)
        except Exception:
            t = None
        if t is not None:
            return t
    raise Exception("no type '%s' is loaded" % name)


def write_tasks(app, dest):
    """The tasks, which PLCopen does not carry (the export holds no Task Configuration): one line per task."""
    lines = []
    for o in vp.walk(app, limit=30):
        try:
            if getattr(o, "is_task_configuration", False):
                lines.append(TAB.join(["#configuration", o.get_name()]))
            if o.is_task:
                lines.append(TAB.join([o.get_name()] + task_settings(o)))
        except Exception:
            pass
    f = open(dest, "w")
    f.write(NL.join(lines) + NL)
    f.close()
    log("tasks: %d -> %s" % (len(lines), dest))


def make_tasks(app, src):
    """Build the source's tasks in THIS version through its own scripting, member for member (the traps are the bridge's
    WriteTask's: kind_of_task takes only the vendor enum, priority is a string, interval and its unit are separate)."""
    tcs = [o for o in app.get_children(False) if getattr(o, "is_task_configuration", False)]
    tc = tcs[0] if tcs else app.create_task_configuration()
    kinds = find_type("_3S.CoDeSys.TaskConfig.KindOfTask")
    for line in open(src).read().splitlines():
        if not line.strip():
            continue
        if line.startswith("#configuration" + TAB):
            # Named by THIS version: 3.5.18.30's create_task_configuration names it `TaskConfiguration` and refuses
            # `Task Configuration` as a name for it (measured 2026-10-14: rename raises "Der Name 'Task Configuration'
            # ist fuer dieses Objekt nicht gueltig"); the later ones name it `Task Configuration`, as the source has it.
            if tc.get_name() != line.split(TAB)[1]:
                log("task configuration: this CODESYS names it %s (the source: %s)" % (tc.get_name(), line.split(TAB)[1]))
            continue
        name, kind, prio, interval, unit, event, ext, wtime, wunit, wsens, wenabled, calls = line.split(TAB)
        t = tc.create_task(name)
        t.kind_of_task = System.Enum.Parse(kinds, kind)
        t.priority = prio
        t.interval = interval
        if unit:
            t.interval_unit = unit
        t.event = event
        t.external_event = ext
        t.watchdog.time = wtime
        t.watchdog.time_unit = wunit
        t.watchdog.sensitivity = wsens
        t.watchdog.enabled = wenabled == "True"
        for c in [c for c in calls.split(";") if c]:
            t.pous.add(c)
        log("task %s: %s" % (name, "|".join(task_settings(t))))


def redirect_placeholders(app, xml):
    """The source's placeholder redirections, which PLCopen carries but 3.5.18.30's import does not apply (measured
    2026-10-14: `StringUtils`/`Util` stayed unresolved - SP18's profile defines no such placeholder - and `Standard` came
    out redirected to another version than the source's). Set through the reference's own `set_redirection`."""
    import re
    wanted = dict(re.findall(r'<PlaceholderRedirection Placeholder="([^"]+)" Redirection="([^"]+)"', xml))
    libman = [o for o in app.get_children(False) if getattr(o, "is_libman", False)]
    if not wanted or not libman:
        return
    for r in libman[0].references:
        want = wanted.get(str(r.placeholder_name or ""))
        if want is None:
            continue
        held = r.get_redirection()
        if str(held) != want:
            r.set_redirection(want)
            log("placeholder %s: redirection %s -> %s (effective %s)" % (r.placeholder_name, held, want, r.effective_resolution))


def find(node, name):
    for c in node.get_children(False):
        if c.get_name() == name:
            return c
    return None


def application_of(proj):
    for o in vp.walk(proj, limit=30):
        try:
            if o.is_application:
                return o
        except Exception:
            pass
    return None


def run():
    mode = env("VOLT_FX_MODE")
    log("mode: %s; CODESYS %s" % (mode, own_version()))
    if mode == "inventory":
        proj = vp.open_copy(projects, env("VOLT_FX_PROJECT"), "fx-inventory")
        inventory(proj, env("VOLT_FX_INVENTORY"))
        return
    if mode == "export":
        proj = vp.open_copy(projects, env("VOLT_FX_PROJECT"), "fx-export")
        inventory(proj, env("VOLT_FX_INVENTORY"))
        app = application_of(proj)
        tops = [c for c in app.get_children(False)]
        log("exporting the application's %d top-level object(s): %s" % (len(tops), ", ".join(c.get_name() for c in tops)))
        # declarations as plain text: the declaration's own text travels, not a re-spelling from the variable list
        proj.export_xml(tops, env("VOLT_FX_XML"), True, True, True)
        log("exported -> %s" % env("VOLT_FX_XML"))
        write_tasks(app, env("VOLT_FX_XML") + ".tasks")
        msgs = vp.build_messages(app, system, Severity)
        log("build (the source, the baseline): %d message(s)" % len(msgs))
        for m in msgs:
            log("  " + m)
        return
    if mode == "import":
        out = env("VOLT_FX_OUT")
        if os.path.exists(out):
            os.remove(out)
        proj = projects.create(out, True)
        version = device_version()
        log("device: %s/%s version %s (this CODESYS's own)" % (DEVICE_TYPE, DEVICE_ID, version))
        proj.add("Device", DEVICE_TYPE, DEVICE_ID, version, None)
        app = application_of(proj)
        if app is None:
            raise Exception("the added device made no application")
        log("the device made: %s" % ", ".join(path_of(o) for o in vp.walk(proj, limit=30)))
        # What the device template made and the import also carries is removed first, so the import makes it
        # (the source's own settings, not the template's) instead of a renamed duplicate beside it.
        xml = open(env("VOLT_FX_XML")).read()
        for c in list(app.get_children(False)):
            if ('name="%s"' % c.get_name()) in xml:
                log("removing the template's %s (the import carries it)" % c.get_name())
                c.remove()
        app.import_xml(env("VOLT_FX_XML"), True)
        make_tasks(app, env("VOLT_FX_XML") + ".tasks")
        redirect_placeholders(app, xml)
        # SAVED BEFORE anything below reads it: on 3.5.18.30 a build (and an export) fills every unset library
        # parameter's default into the reference that declares it (DIALECT V7: `GetParameterValues` writes as it
        # answers) - measured 2026-10-14, a fixture saved after its build held 7 parameter values the source does not.
        # Nothing below is saved; the process exits without saving.
        proj.save()
        msgs = vp.build_messages(app, system, Severity)
        log("build: %d message(s)" % len(msgs))
        for m in msgs:
            log("  " + m)
        # The same export of what was made, to diff against the source's (the graphical bodies have no text to hash).
        proj.export_xml([c for c in app.get_children(False)], out + ".xml", True, True, True)
        inventory(proj, env("VOLT_FX_INVENTORY"))
        log("saved -> %s" % out)
        return
    raise Exception("unknown VOLT_FX_MODE %r" % mode)


import System
try:
    run()
    done()
except Exception:
    done(True)
