# -*- coding: utf-8 -*-
# WHICH TREE NODES HOLD A SOURCE ITEM? (openspec bridge-refusal-review 4.31)
#
# A push's move names a folder PATH; the bridge resolves it by name and CODESYS accepts `Move` into ANY node -
# `Device`, `Task Configuration` - then leaves the object where it was (merged-classes.log 225-229). Volt refuses a
# move whose target is no node that can hold an item. The set of holders is MEASURED, never assumed: this walks each
# project's tree and, for every top-level source object (a POU, a GVL/NVL, a DUT, an interface - the codes
# `CodesysTypeMap.CodeForObject` gives them), logs its PARENT's classification: the project root, a folder
# (`is_folder`), or the interface names that decide the parent's code. Library Manager subtrees are skipped (library
# items are not the project's and are never moved).
#
#   $env:VOLT_PROBE_PROJECTS = "<repo>\packages\volt-cli\test\fixtures\Pro2193-94-95-96_COdesys.project;<repo>\...\CodesysTestProject.project"
#   CODESYS.exe --profile="CODESYS V3.5 SP21 Patch 4" --noUI --runscript="<repo>\packages\volt-cli\scripts\probe-move-holders.py"
#
# Works on a COPY of each project and never saves. ASCII ONLY.
from __future__ import print_function
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("move-holders.log")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, "..", "test", "fixtures", "CodesysTestProject.project")

SOURCE = ["IPOUObject", "IGVLObject", "INVLObject", "IDUTObject", "ITextListEnumerationObject", "IInterfaceObject"]
CONTAINERS = ["IApplicationObject", "IPlcLogicObject", "IDeviceObject", "ITaskConfigObject", "ILibManObject"]


def ifaces(mgr, node):
    try:
        ok, meta = vp.call(mgr, "GetObjectToRead", [node.handle, node.guid])
        if not ok:
            return None
        obj = vp.prop(meta, "Object")
        return set(i.Name for i in obj.GetType().GetInterfaces())
    except Exception:
        return None


def holder_class(mgr, parent):
    if parent is None:
        return "ROOT (the project)"
    if parent.is_folder:
        return "FOLDER (is_folder)"
    names = ifaces(mgr, parent)
    if names is None:
        return "UNREADABLE"
    hit = [c for c in CONTAINERS if c in names]
    if hit:
        return hit[0]
    if any(s in names for s in SOURCE):
        return "SOURCE OBJECT"
    return "OTHER [" + "+".join(sorted(n for n in names if n.startswith("I")))[:200] + "]"


def walk(mgr, node, parent, path, census, depth):
    if depth > 14:
        return
    for child in node.get_children(False):
        name = child.get_name(False)
        names = None if child.is_folder else ifaces(mgr, child)
        if names is not None and "ILibManObject" in names:
            continue
        if names is not None and any(s in names for s in SOURCE):
            cls = holder_class(mgr, None if path == "" else node)
            census.setdefault(cls, []).append(path + "/" + name if path else name)
            continue   # members are inlined, never holders of a top-level item
        walk(mgr, child, node, path + "/" + name if path else name, census, depth + 1)


try:
    mgr = vp.object_manager()
    for src in (vp.projects_from_env() or [DEFAULT]):
        log("==== " + os.path.basename(src))
        proj = vp.open_copy(projects, src, "move-holders")
        census = {}
        walk(mgr, proj, None, "", census, 0)
        for cls in sorted(census):
            items = census[cls]
            log("  %-40s %4d   e.g. %s" % (cls, len(items), "; ".join(items[:3])))
        proj.close()
finally:
    done()
