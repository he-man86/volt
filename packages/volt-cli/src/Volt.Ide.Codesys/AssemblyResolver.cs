using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;

namespace System.Runtime.CompilerServices
{
    /// <summary>
    /// net48's BCL has no <c>ModuleInitializerAttribute</c>; the C# compiler only requires the TYPE to exist, so
    /// declaring it here is the supported way to use module initializers on .NET Framework. Internal on purpose —
    /// it must not leak out of this assembly and collide with the real one in any consumer.
    /// </summary>
    [AttributeUsage(AttributeTargets.Method, Inherited = false)]
    internal sealed class ModuleInitializerAttribute : Attribute { }
}

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// Resolves this assembly's dependencies from the folder it was loaded out of, and does it at MODULE LOAD —
    /// before any type in this assembly is touched.
    ///
    /// WHY IT CANNOT LIVE IN <c>PipeHost.Start</c>, where it used to: the CLR's own binding misses our
    /// dependencies (the version mismatch below), so they only resolve if this handler is already installed. But the
    /// JIT has to resolve
    /// everything <c>Start</c>'s body references BEFORE its first instruction executes, and that body references
    /// Volt.Wire — so the load failed while compiling the very method whose first line installed the fix. The
    /// handler was correct and simply never got the chance to run.
    ///
    /// What that looked like in the field, 2026-09-25:
    ///
    ///     Volt: start failed: Could not load file or assembly 'Volt.Wire, Version=1.0.0.0,
    ///     Culture=neutral, PublicKeyToken=null' or one of its dependencies.
    ///
    /// Volt.Wire.dll was present the whole time. The missing file was one of ITS dependencies: Volt.Wire is
    /// compiled against System.Text.Json 10.0.0.0 while the build ships 10.0.0.12, and .NET Framework binds
    /// strong-named assemblies by EXACT version. Normally an app.config binding redirect covers that, but the host
    /// process is CODESYS.exe and its config is not ours to edit — so resolving by simple NAME, ignoring version,
    /// is the only lever we have. That is what the handler below does, and why it deliberately ignores the version
    /// in the request rather than trying to match it.
    ///
    /// It is not the only handler in the process, and not the first: IronPython's runs before it and answers by
    /// probing <c>sys.path</c>. That one answered from the folder the start script ran from, and so loaded a SECOND
    /// System.Text.Json beside the one this handler loads (openspec codesys-single-load-dependencies);
    /// <c>start_volt_codesys.py</c> therefore loads this assembly with <c>Assembly.LoadFrom</c> (not IronPython's
    /// own load, whose requests IronPython claims) and takes the folders holding it off <c>sys.path</c> first.
    ///
    /// Deliberately dependency-free: only mscorlib/System types, no VoltLog. Anything else risks re-entering this
    /// handler to resolve the logger while resolving something else.
    /// </summary>
    internal static class BridgeAssemblyResolver
    {
        private static int _installed;

        [ModuleInitializer]
        internal static void Install()
        {
            if (Interlocked.Exchange(ref _installed, 1) != 0) return;

            string? dir;
            try { dir = Path.GetDirectoryName(typeof(BridgeAssemblyResolver).Assembly.Location); }
            catch { return; }
            if (string.IsNullOrEmpty(dir)) return;

            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
            {
                // Fires only after the CLR's own resolution failed, so this cannot shadow anything the host
                // already satisfies.
                try
                {
                    var name = new AssemblyName(e.Name).Name;
                    if (string.IsNullOrEmpty(name)) return null;
                    var path = Path.Combine(dir, name + ".dll");
                    return File.Exists(path) ? Assembly.LoadFrom(path) : null;
                }
                catch
                {
                    // A throwing resolver turns one missing assembly into an unrelated failure. Say nothing and
                    // let the CLR report the original miss.
                    return null;
                }
            };
        }
    }
}
