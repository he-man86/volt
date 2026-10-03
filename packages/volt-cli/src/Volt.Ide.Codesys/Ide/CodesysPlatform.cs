using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// Which CODESYS this bridge runs in, and whether it has what the bridge needs — read ONCE, at attach.
    ///
    /// <para><b>The version is the PLATFORM's, never the exe's</b> (DIALECT V1). OEM IDEs built on CODESYS (WAGO,
    /// Lenze PLC Designer, Schneider Machine Expert, …) ship their own executable with their own product version; the
    /// framework assemblies under it are 3S's. The source is the assembly that defines
    /// <c>_3S.CoDeSys.Core.SystemInstances</c> — the very type every capability below is reached through — whose
    /// version equals the release (3.5.18.30 on SP18 Patch 3, 3.5.21.40 on SP21 Patch 4), where
    /// <c>ComponentModel.dll</c> did not (3.5.18.60 on SP18 Patch 3) and <c>Core.dll</c> is a frozen 3.5.16.1
    /// forwarding facade.</para>
    ///
    /// <para><b>Refused by capability, never by number</b> (owner, 2026-10-01). A fixed SP21 floor would lock out OEM
    /// IDEs on older platforms that work. <see cref="All"/> (DIALECT V2) is THE list of what the bridge binds at start; each entry
    /// says which platforms it is known on. Anything else the bridge reflects is reached lazily inside an op (a plugin
    /// type is not loaded until its plugin is), so checking it here would refuse IDEs that are fine.</para>
    /// </summary>
    internal static class CodesysPlatform
    {
        internal sealed class Capability
        {
            public Capability(string name, string knownOn) { Name = name; KnownOn = knownOn; }
            /// <summary>What the refusal names — the vendor member, so a user can quote it to support.</summary>
            public string Name { get; }
            /// <summary>The platforms it has been measured on (not a floor: a platform not listed may have it).</summary>
            public string KnownOn { get; }
        }

        private const string SystemInstancesType = "_3S.CoDeSys.Core.SystemInstances";

        /// <summary>The 3S core type every other capability hangs off — and the version source.</summary>
        public static readonly Capability Core = new(
            "the core framework type " + SystemInstancesType,
            "3.5.18.30 (PLCAssist laptop, 2026-09-30), 3.5.21.40 (this repo)");

        /// <summary>Every object-model touch is marshalled onto the primary thread through this (<see cref="CodesysDispatcher"/>).</summary>
        public static readonly Capability Dispatcher = new(
            "the primary-thread dispatcher (SystemInstances.Engine.InvokeInPrimaryThread(Delegate, object[], bool))",
            "3.5.18.30 (PLCAssist laptop, 2026-09-30), 3.5.21.40 (this repo)");

        /// <summary>All source-text I/O goes through the object manager (<see cref="CodesysObjectModel"/>).</summary>
        public static readonly Capability ObjectManager = new(
            "the object manager (SystemInstances.ObjectMgr)",
            "3.5.18.30 (PLCAssist laptop, 2026-09-30), 3.5.21.40 (this repo)");

        public static readonly IReadOnlyList<Capability> All = new[] { Core, Dispatcher, ObjectManager };

        /// <summary>The platform version, e.g. <c>3.5.21.40</c>; null when the core type is not loaded (then
        /// <see cref="Core"/> is missing and the refusal says the version could not be read).</summary>
        public static string? ReadVersion() =>
            Reflection.FindType(SystemInstancesType)?.Assembly.GetName().Version?.ToString();

        /// <summary>The OEM product name off <c>IEngine3.OEMCustomization.ProductName</c> (EngineWin.dll), or null when
        /// it is plain CODESYS. Plain CODESYS answers <c>"CODESYS"</c> (measured live on 3.5.21.40), which names
        /// nothing a version does not already say. A platform without the member answers null — its product name is
        /// a display nicety, not something the bridge needs, so its absence is not a refusal.</summary>
        public static string? OemProduct(string? productName) =>
            string.IsNullOrEmpty(productName) || string.Equals(productName, "CODESYS", StringComparison.Ordinal) ? null : productName;

        /// <summary>The product name as the IDE states it, unfiltered — logged at start, so what an OEM build answers
        /// is on record the first time one runs the bridge. Throws when the vendor's getter does; the driver keeps
        /// that failure as <c>ProductNameUnreadable</c> rather than failing to construct.</summary>
        public static string? ReadProductName(object? engine) =>
            Member(Member(engine, "OEMCustomization"), "ProductName") as string;

        /// <summary>What the IDE's own exe states about itself in its version-info (DIALECT V4): the product's version
        /// and its manufacturer go to <c>health</c>; the exe's product name is logged beside
        /// <c>OEMCustomization.ProductName</c> so the first OEM log shows whether the two part (design B2). Each is
        /// null when empty — never taken from the exe's file name or path.</summary>
        internal sealed class HostExe
        {
            public HostExe(string? productName, string? productVersion, string? companyName)
            {
                ProductName = Stated(productName);
                ProductVersion = Stated(productVersion);
                CompanyName = Stated(companyName);
            }
            public string? ProductName { get; }
            public string? ProductVersion { get; }
            public string? CompanyName { get; }
        }

        /// <summary>The CURRENT process's exe — right ONLY because this bridge is in-proc, so the process IS the IDE
        /// (<c>CODESYS.exe</c>, or the OEM's exe). The TwinCAT worker is out of process and must never read this way
        /// (DIALECT V4). Throws when the module cannot be read; the driver keeps that failure by name.</summary>
        public static HostExe ReadHostExe()
        {
            using var self = Process.GetCurrentProcess();
            var info = self.MainModule!.FileVersionInfo;
            return new HostExe(info.ProductName, info.ProductVersion, info.CompanyName);
        }

        /// <summary>A stated value, verbatim, or null when the source states nothing (empty or whitespace).</summary>
        public static string? Stated(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

        /// <summary>The engine <c>SystemInstances.Engine</c> holds, or null.</summary>
        public static object? ReadEngine() =>
            Reflection.FindType(SystemInstancesType)?.GetProperty("Engine", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);

        /// <summary>The ONE wording of the refusal, fixed English (clients show it; it is never the OS-localized
        /// exception text): <c>CODESYS &lt;version&gt; is not supported: it lacks &lt;capability&gt;.</c> Null when
        /// nothing is missing.</summary>
        public static string? Refusal(string? version, IEnumerable<Capability> missing)
        {
            var names = missing.Select(c => c.Name).ToList();
            if (names.Count == 0) return null;
            var v = version ?? "(platform version unreadable)";
            return $"CODESYS {v} is not supported: it lacks {string.Join("; ", names)}.";
        }

        /// <summary>A property by name: the MOST-DERIVED declaration on the object's class chain (a derived class that
        /// hides a base property with <c>new</c> makes <c>Type.GetProperty(name)</c> throw AmbiguousMatchException), or
        /// — for an explicit implementation like IEngine3's — on one of its interfaces. A getter that throws
        /// propagates (as TargetInvocationException): the caller decides what that failure means.</summary>
        private static object? Member(object? o, string name)
        {
            if (o == null) return null;
            const BindingFlags F = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            PropertyInfo? p = null;
            for (var t = o.GetType(); t != null && p == null; t = t.BaseType)
                p = t.GetProperties(F).FirstOrDefault(x => x.Name == name && x.GetIndexParameters().Length == 0);
            p ??= o.GetType().GetInterfaces().Select(i => i.GetProperty(name)).FirstOrDefault(x => x != null);
            return p?.GetValue(o, null);
        }
    }
}
