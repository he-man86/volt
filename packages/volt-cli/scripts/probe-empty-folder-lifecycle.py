# DOES A FOLDER SURVIVE WHEN ITS LAST ITEM LEAVES?
#
# Volt has no folder op on the wire - `set` and `deleteItem`, and a folder is only ever a PATH on an item. That
# mirrors git, where a directory is not an entity either. But git still REMOVES the directory from the working
# tree once its last file goes, as a derived consequence. So the question for each vendor is whether the IDE
# does the same, and it can only be answered on the surface Volt actually drives - the scripting/automation
# object model, never the filesystem, which may hold an entry the tree no longer has or the reverse.
#
# TwinCAT is measured over COM (see the session log): the tree KEEPS the folder, empty. This is the CODESYS half.
#
# Self-contained on purpose: it builds the situation rather than inspecting whatever a shared project happens to
# hold, so the answer does not depend on what some earlier run left behind or on whether the live IDE has saved.
#
#   pwsh> $env:VOLT_PROBE_PROJECTS="C:\...\some.project"
#         & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#             --profile="CODESYS V3.5 SP21 Patch 4" --noUI `
#             --runscript="<repo>\packages\volt-cli\scripts\probe-empty-folder-lifecycle.py"
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("empty-folder-lifecycle.log")

FOLDER = "VltProbeFolder"
POU = "VltProbePou"


def children_named(parent, name):
    """Every direct child of `parent` called `name` - as a list, so 0 means gone and 1 means still there."""
    out = []
    try:
        kids = list(parent.get_children())
    except Exception:
        return out
    for k in kids:
        try:
            if str(k.get_name()) == name:
                out.append(k)
        except Exception:
            pass
    return out


try:
    srcs = vp.projects_from_env()
    if not srcs:
        log("VOLT_PROBE_PROJECTS is empty")
        done()

    src = srcs[0]
    log("project: %s" % os.path.basename(src))
    proj = vp.open_copy(projects, src, "emptyfolder")   # noqa: F821 - CODESYS injects `projects`

    # 1. A FOLDER WITH ONE POU IN IT, built through the scripting API the driver uses.
    # `create_folder` answers None on this build, so the handle comes from a lookup - which is also the
    # honest way to ask "is it there", and is reused below.
    proj.create_folder(FOLDER)
    made = children_named(proj, FOLDER)
    if not made:
        log("create_folder(%r) produced no child - cannot probe" % FOLDER)
        done()
    folder = made[0]
    log("created folder %r" % FOLDER)
    pou = folder.create_pou(POU)
    log("created POU %r inside it" % POU)
    log("   folder children after create: %d" % len(list(folder.get_children())))

    # 2. DELETE THE POU - which is all Volt can ever send, since `deleteItem` names an ITEM and the wire has no
    #    folder op at all.
    pou.remove()
    log("removed the POU")

    # 3. IS THE FOLDER STILL THERE?
    still = children_named(proj, FOLDER)
    log("")
    log("=== ANSWER ===")
    if still:
        kids = len(list(still[0].get_children()))
        log("the folder SURVIVES, empty (children=%d)" % kids)
        log("so CODESYS does NOT prune it, exactly as TwinCAT does not - and Volt never asks,")
        log("because `deleteItem` names an item and no folder op exists on the wire.")
    else:
        log("the folder is GONE - CODESYS pruned it when its last child was removed.")
        log("that would make this a TwinCAT-only gap rather than a shared one.")

    # 4. AND CAN THE SCRIPTING API EVEN REMOVE A FOLDER? That decides whether a fix is reachable at all.
    log("")
    log("=== IS A FOLDER REMOVABLE AT ALL? ===")
    if still:
        try:
            still[0].remove()
            log("folder.remove() -> OK, so a prune IS expressible through the same API")
        except Exception:
            log("folder.remove() -> THREW: %s" % sys.exc_info()[1])
        log("folder present after remove(): %s" % bool(children_named(proj, FOLDER)))

    proj.close()
except Exception:
    done(error=True)
else:
    done()
