# Probe: read and write a CODESYS graphical body through the 3S NWL OBJECT MODEL,
# with no PLCopen serialization in either direction.
#
#   pwsh> & "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" `
#           --profile="CODESYS V3.5 SP21 Patch 4" --noUI `
#           --runscript="<repo>\packages\volt-cli\scripts\probe-nwl-objectmodel.py"
#
# Writes its log next to itself (override with VOLT_PROBE_LOG). Operates on a COPY of the
# fixture project, never the original. Evidence recorded in
# openspec/changes/pou-transport-per-vendor/nwl-object-model.md.
#
# Note: CODESYS compiles this as ASCII IronPython 2.7 - a single non-ASCII byte is a
# SyntaxError before line 1 runs, and the log then silently keeps its previous contents.
import os
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.path.join(HERE, "..", "test")

LOG = os.environ.get("VOLT_PROBE_LOG") or os.path.join(HERE, "nwl-probe.log")
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

def ifaces(o):
    try:
        return sorted([i.Name for i in o.GetType().GetInterfaces()])
    except Exception:
        return []

def props(o):
    try:
        return sorted([p.Name for p in o.GetType().GetProperties(_bf())])
    except Exception:
        return []

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

def is_item(o):
    try:
        for i in o.GetType().GetInterfaces():
            if i.Name in ("INWLItem", "IBox", "IOperand"):
                return True
    except Exception:
        pass
    return False

def dump_item(it, indent, seen, depth=0):
    if it is None or depth > 6:
        return
    pad = " " * indent
    tn = it.GetType().Name
    if tn not in seen:
        seen[tn] = [x for x in ifaces(it) if x[0] == "I" and not x.startswith("IArchiv")
                    and x not in ("ICloneable", "IComparable", "IGenericObject")]
    bits = []
    for pn in ("Text", "Name", "TypeName", "Expression", "Comment", "Id", "Negated", "OutCommented"):
        v = prop(it, pn)
        if v is not None and v != "" and v is not False:
            bits.append("%s=%r" % (pn, v))
    fl = prop(it, "Flags")
    if fl is not None:
        on = []
        for b in ("Negation", "Set", "Jump", "Return", "Rtrig", "Ftrig"):
            if prop(fl, b):
                on.append(b)
        bits.append("Flags=%s" % (",".join(on) if on else "-"))
    log("%s%s  %s" % (pad, tn, "  ".join(bits)))
    # every primitive-valued property, so nothing readable is missed
    prims = []
    for pn in props(it):
        if pn in ("ImplObj", "OwnerObject", "Parent", "Network", "GenericObjectService",
                  "SerializableValueNames", "Accepted", "Added", "Changed", "ChangedContents",
                  "Deleted", "DeletedAfter", "DeletedBefore", "Inserted", "Safe"):
            continue
        v = prop(it, pn)
        if isinstance(v, (str, int, long, float, bool)) or v is None:
            if v is not None and v != "" and v is not False:
                prims.append("%s=%r" % (pn, v))
    if prims:
        log("%s   [%s]" % (pad, "  ".join(prims)))
    # discover children: any property whose value is an item or a sequence of items
    for pn in props(it):
        if pn in ("ImplObj", "OwnerObject", "Parent", "Network", "GenericObjectService"):
            continue
        v = prop(it, pn)
        if v is None:
            continue
        if is_item(v):
            log("%s  .%s ->" % (pad, pn))
            dump_item(v, indent + 4, seen, depth + 1)
            continue
        try:
            n = len(v)
        except Exception:
            continue
        if n == 0 or isinstance(v, str):
            continue
        try:
            first = v[0]
        except Exception:
            continue
        if is_item(first):
            log("%s  .%s (%d)" % (pad, pn, n))
            for j in range(min(6, n)):
                dump_item(v[j], indent + 4, seen, depth + 1)

try:
    import clr
    import System
    import shutil

    objmgr = None
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            t = asm.GetType("_3S.CoDeSys.Core.SystemInstances")
        except Exception:
            t = None
        if t is None:
            continue
        p = t.GetProperty("ObjectMgr")
        if p is not None:
            objmgr = p.GetValue(None, None)
        if objmgr is not None:
            break
    if objmgr is None:
        log("ObjectMgr NOT reachable")
        raise SystemExit

    SRC = os.path.join(TEST, "CodesysTestProject.project")
    dst = os.path.join(tempfile.gettempdir(), "volt-nwl-probe.project")
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copyfile(SRC, dst)
    proj = projects.open(dst)                                    # noqa: F821
    app = find(proj, "Application")
    log("Application: %s" % (app is not None))

    FIX = os.path.join(TEST, "Volt.Engine.Tests", "fixtures", "codesys-pou",
                       "VltFbd_FbdRoot.plcopen.xml")
    data = open(FIX, "r").read()
    if data[:1] == "\xef" or data[:1] == "\ufeff":
        data = data.lstrip("\xef\xbb\xbf\ufeff")

    # mirror CodesysObjectModel.ImportXmlString: import_xml(ConflictResolve.Replace, xml, False)
    target = unwrap(app)
    t = target.GetType()
    m3 = None
    for m in t.GetMethods(_bf()):
        ps = m.GetParameters()
        if m.Name == "import_xml" and len(ps) == 3 and ps[0].ParameterType.IsEnum:
            m3 = m
            break
    if m3 is None:
        log("import_xml 3-arg overload not found")
        raise SystemExit
    et = m3.GetParameters()[0].ParameterType
    log("ConflictResolve members: " + ", ".join(System.Enum.GetNames(et)))
    val = System.Enum.Parse(et, "Replace")
    done = False
    for label, fn in (("python app.import_xml", lambda: app.import_xml(val, data, False)),
                      ("reflect on app", lambda: m3.Invoke(
                          unwrap(app), System.Array[System.Object]([val, data, False])))):
        try:
            fn()
            log("imported VltFbd via " + label)
            done = True
            break
        except Exception:
            log("  %s -> %s" % (label, traceback.format_exc().strip().split(chr(10))[-1]))
    if not done:
        raise SystemExit

    pou = find(proj, "VltFbd")
    if pou is None:
        log("VltFbd not found after import")
        raise SystemExit
    u = unwrap(pou)
    h = prop(u, "handle") or 0
    g = prop(u, "guid")
    meta = objmgr.GetObjectToRead(h, g)
    impl = prop(prop(meta, "Object"), "Implementation")
    log("aspect: " + impl.GetType().FullName)
    nets = prop(impl, "NetworkList")
    log("networks: %d" % len(nets))

    seen = {}
    for idx in range(len(nets)):
        net = nets[idx]
        log("")
        log("network[%d] Title=%r Label=%r Comment=%r OutCommented=%r ItemCount=%s"
            % (idx, prop(net, "Title"), prop(net, "Label"), prop(net, "Comment"),
               prop(net, "OutCommented"), prop(net, "NetworkItemCount")))
        cnt = prop(net, "NetworkItemCount")
        n = int(cnt) if cnt else 0
        for i in range(n):
            try:
                bt = net.GetTree(i)
            except Exception:
                log("  GetTree(%d) failed: %s" % (i, traceback.format_exc().strip().split(chr(10))[-1]))
                continue
            if bt is None:
                log("  GetTree(%d) -> None" % i)
                continue
            log("  GetTree(%d) -> %s" % (i, bt.GetType().FullName))
            log("    ifaces: " + ", ".join(ifaces(bt)))
            log("    props : " + ", ".join(props(bt)))
            dump_item(bt, 4, seen)

    log("")
    log("=== item types seen ===")
    for k in sorted(seen):
        log("  %-28s %s" % (k, ", ".join([x for x in seen[k] if x.startswith("INWL")
                                          or x.startswith("IBox") or x.startswith("IOperand")
                                          or x.startswith("IContact") or x.startswith("ICoil")])))

    proj.close()
    log("")
    log("=== done ===")
except Exception:
    log(traceback.format_exc())
f.close()
try:
    system.exit()                                                # noqa: F821
except Exception:
    pass
