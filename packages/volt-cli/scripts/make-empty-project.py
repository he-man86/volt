# Make an EMPTY project to push into: copy a project that already has a device + Application, then delete
# every child of the Application. The result is a real, loadable CODESYS project with somewhere to put POUs
# and nothing in it - the baseline for a round-trip test that exercises CREATE rather than update.
#
#   VOLT_EMPTY_FROM   the .project to copy (default: the committed CodesysTestProject fixture)
#   VOLT_EMPTY_TO     where to write it
#
# ASCII ONLY - CODESYS compiles this as ASCII IronPython 2.7.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(HERE, "..", "test")

LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "make-empty.log")
f = open(LOG, "w")
def log(s):
    f.write(str(s) + "\n"); f.flush()

BF = None
def _bf():
    global BF
    if BF is None:
        from System.Reflection import BindingFlags as B
        BF = B.Public | B.NonPublic | B.Instance | B.FlattenHierarchy
    return BF

def unwrap(o):
    for _ in range(10):
        if o is None:
            return None
        try:
            bp = o.GetType().GetProperty("BaseObject", _bf())
        except Exception:
            return o
        if bp is None:
            return o
        try:
            inner = bp.GetValue(o, None)
        except Exception:
            return o
        if inner is None or inner is o:
            return o
        o = inner
    return o

def prop(o, name):
    if o is None:
        return None
    try:
        t = o.GetType()
    except Exception:
        return None
    try:
        p = t.GetProperty(name, _bf())
        if p is not None:
            return p.GetValue(o, None)
    except Exception:
        pass
    try:
        for i in t.GetInterfaces():
            ip = i.GetProperty(name)
            if ip is not None:
                return ip.GetValue(o, None)
    except Exception:
        pass
    try:
        return getattr(o, name)
    except Exception:
        return None

def call(o, name, args):
    """Invoke a method declared on the type OR on any interface (explicit implementations)."""
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        for m in src.GetMethods():
            if m.Name != name or len(m.GetParameters()) != len(args):
                continue
            try:
                import System
                return True, m.Invoke(o, System.Array[System.Object](list(args)))
            except Exception:
                return False, traceback.format_exc().strip().split(chr(10))[-1]
    return False, "no method " + name

def seq(o):
    """A vendor collection as a python list, via reflection (they are not IronPython-iterable)."""
    if o is None:
        return None
    n = prop(o, "Count")
    if n is None:
        return None
    out = []
    t = o.GetType()
    for src in [t] + list(t.GetInterfaces()):
        p = src.GetProperty("Item")
        if p is not None:
            for i in range(int(n)):
                try:
                    out.append(p.GetValue(o, [i]))
                except Exception:
                    return out
            return out
    return out

def find(root, want, depth=0):
    if depth > 9:
        return None
    try:
        kids = list(root.get_children())
    except Exception:
        return None
    for k in kids:
        try:
            if str(k.get_name()) == want:
                return k
        except Exception:
            pass
        r = find(k, want, depth + 1)
        if r is not None:
            return r
    return None

def validity(net, tag):
    log("  %-22s FBDValid=%s ILValid=%s ILActive=%s items=%s"
        % (tag, prop(net, "FBDValid"), prop(net, "ILValid"),
           prop(net, "ILActive"), prop(net, "NetworkItemCount")))


FROM = os.environ.get("VOLT_EMPTY_FROM") or os.path.join(TEST, "fixtures", "CodesysTestProject.project")
TO = os.environ.get("VOLT_EMPTY_TO") or os.path.join(tempfile.gettempdir(), "volt-empty.project")

try:
    import clr, System, shutil

    if os.path.exists(TO):
        os.remove(TO)
    shutil.copyfile(FROM, TO)
    log("copied %s -> %s" % (os.path.basename(FROM), TO))

    proj = projects.open(TO)
    app = find(proj, "Application")
    if app is None:
        log("no Application found"); raise SystemExit

    # KEEP what a NEW project has: a Library Manager and a Task Configuration. Stripping those would make the
    # target less empty-like, not more - a fresh CODESYS project ships both, and removing them would confound
    # a create round-trip with "the standard library is missing".
    KEEP = ("Library Manager", "Task Configuration")
    removed = []
    while True:
        kids = [k for k in app.get_children() if str(k.get_name()) not in KEEP]
        if not kids:
            break
        k = kids[0]
        nm = str(k.get_name())
        try:
            k.remove()
            removed.append(nm)
        except Exception:
            log("  could not remove %r: %s" % (nm, traceback.format_exc().splitlines()[-1]))
            break

    log("removed %d Application child(ren): %r" % (len(removed), removed))
    left = [str(k.get_name()) for k in app.get_children()]
    log("Application now holds: %r" % left)

    proj.save()
    proj.close()
    log("saved %s" % TO)
    log("done")
except SystemExit:
    pass
except Exception:
    log(traceback.format_exc())
finally:
    f.close()
    try:
        import System; System.Environment.Exit(0)
    except Exception: pass
