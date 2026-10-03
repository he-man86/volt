# What does a running CODESYS state about ITSELF, in-process? (ide-identity-report 1.1, 1.2, 1.5)
#
# Read-only, no project. Each source below is a candidate for one health field; the probe prints what each
# answers so DIALECT can record it, and it never infers a value from a path or a file name:
#   platform     the assembly version of the assembly defining _3S.CoDeSys.Core.SystemInstances (DIALECT V1, as read today)
#   productName  IEngine3.OEMCustomization.ProductName (as read today), plus ProductPathComponent
#   productVersion / productVendor   the HOST PROCESS's exe version-info (Process.MainModule.FileVersionInfo):
#                ProductName, ProductVersion, FileVersion, CompanyName - one generic source, no vendor code
#   entry        the entry assembly's name and version (what a .NET reading of "the product" would give)
#   engine       every readable property of SystemInstances.Engine and of its OEMCustomization object, so a
#                vendor/version field the API has but we did not know to ask for cannot hide
#
#   Start-Process "C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\CODESYS.exe" -Wait `
#     -ArgumentList '--profile="CODESYS V3.5 SP21 Patch 4"', '--noUI', '--runscript="<repo>\packages\volt-cli\scripts\probe-ide-identity.py"'
#
# ASCII ONLY.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voltprobe as vp

log, done = vp.logger("ide-identity.log")
failed = False
try:
    import System
    from System.Diagnostics import Process

    def find_type(name):
        for a in System.AppDomain.CurrentDomain.GetAssemblies():
            try:
                t = a.GetType(name, False)
            except Exception:
                t = None
            if t is not None:
                return t
        return None

    si = find_type("_3S.CoDeSys.Core.SystemInstances")
    log("platform (SystemInstances assembly version): %s" % (si.Assembly.GetName().Version if si else "<type not loaded>"))
    if si is not None:
        log("  defined in: %s" % si.Assembly.Location)

    m = Process.GetCurrentProcess().MainModule
    fvi = m.FileVersionInfo
    log("host process exe: %s" % os.path.basename(m.FileName))
    for k in ["ProductName", "ProductVersion", "FileVersion", "CompanyName", "FileDescription", "LegalCopyright",
              "ProductMajorPart", "ProductMinorPart", "ProductBuildPart", "ProductPrivatePart"]:
        log("  FileVersionInfo.%-20s %r" % (k, getattr(fvi, k)))

    ea = System.Reflection.Assembly.GetEntryAssembly()
    log("entry assembly: %s" % (ea.GetName().ToString() if ea else "<none>"))
    if ea is not None:
        for attr in ["AssemblyProductAttribute", "AssemblyCompanyAttribute", "AssemblyInformationalVersionAttribute"]:
            t = System.Type.GetType("System.Reflection." + attr)
            a = System.Attribute.GetCustomAttribute(ea, t)
            log("  %-40s %r" % (attr, (getattr(a, "Product", None) or getattr(a, "Company", None)
                                       or getattr(a, "InformationalVersion", None)) if a else None))

    engine = si.GetProperty("Engine").GetValue(None, None) if si else None
    log("SystemInstances.Engine:")
    vp.dump(engine, log)
    # vp.dump caps its method line at 400 characters, which cut the Engine's list mid-name. The full list, one
    # name per line, plus every member (any visibility) whose name mentions a version, product, vendor or company.
    if engine is not None:
        from System.Reflection import BindingFlags as B
        et = engine.GetType()
        srcs = [et] + list(et.GetInterfaces())
        names = sorted(set(m.Name for s in srcs for m in s.GetMethods(vp.bf())
                           if not m.Name.startswith("get_") and not m.Name.startswith("set_")))
        log("  all %d method names of SystemInstances.Engine (type + interfaces, public and non-public):" % len(names))
        for n in names:
            log("    method %s" % n)
        hits = sorted(set("%s %s" % (m.MemberType, m.Name) for s in srcs
                          for m in s.GetMembers(B.Public | B.NonPublic | B.Instance | B.Static)
                          if any(w in m.Name.lower() for w in ("version", "product", "vendor", "company", "oem"))))
        log("  members naming version/product/vendor/company/oem (any visibility): %d" % len(hits))
        for h in hits:
            log("    %s" % h)
    oem = vp.prop(engine, "OEMCustomization")
    log("Engine.OEMCustomization:")
    vp.dump(oem, log)
    log("  ProductName          %r" % vp.prop(oem, "ProductName"))
    log("  ProductPathComponent %r" % vp.prop(oem, "ProductPathComponent"))
    # The key/value store behind it: its fields name the backing source (provider list, file), if any.
    if oem is not None:
        from System.Reflection import BindingFlags as B
        for f in oem.GetType().GetFields(B.Public | B.NonPublic | B.Instance):
            try:
                v = f.GetValue(oem)
            except Exception as e:
                v = "<raised %s>" % e
            log("  field %-28s %s" % (f.Name, repr(v)[:120]))
except Exception:
    failed = True
finally:
    done(failed)
