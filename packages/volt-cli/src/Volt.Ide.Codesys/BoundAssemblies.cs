using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// Which copy of the wire assemblies this bridge actually bound in the CODESYS process — logged once at start
    /// (openspec <c>codesys-minimum-version</c> 3).
    ///
    /// <para>WHY: two field failures, <c>MissingMethodException: Volt.Wire.PipeClient.Call(String, Object,
    /// Action`1[JsonElement], Int32)</c> (CODESYS 3.5.17) and <c>MissingFieldException: Volt.Contracts.WireJson.Write</c>
    /// (3.5.21.50), are both a member whose signature carries a <c>System.Text.Json</c> type: a second copy of a Volt
    /// or System.Text.Json assembly bound in the process. On .NET Framework <c>Assembly.LoadFrom</c> hands back an
    /// assembly already loaded with the same identity, and every Volt build is <c>1.0.0.0</c>, unsigned — so which
    /// copy won was visible nowhere (DIALECT V3). Each line here names one copy; more than one line for a name IS the finding.</para>
    ///
    /// <para>Each line is computed in its OWN lambda: a type that cannot bind fails only the JIT of that lambda, and
    /// the line then carries the exception — which is the very evidence wanted — instead of losing the whole log.</para>
    /// </summary>
    internal static class BoundAssemblies
    {
        public static IReadOnlyList<string> Describe()
        {
            var lines = new List<string>();
            Bound(lines, "Volt.Wire", () => typeof(Volt.Wire.PipeClient).Assembly);
            Bound(lines, "Volt.Contracts", () => typeof(Volt.Contracts.WireJson).Assembly);
            Bound(lines, "System.Text.Json", () => typeof(System.Text.Json.JsonElement).Assembly);
            // CODESYS carries its own framework assemblies in LacBinaries\GAC_MSIL: SP18 has System.Memory 4.0.1.1
            // only, SP21 has 4.0.1.1 and 4.0.1.2. Volt references none directly, so only the loaded copies are listed.
            Loaded(lines, "System.Memory", bound: null);

            Binds(lines, "Volt.Wire.PipeClient.Call", () =>
                typeof(Volt.Wire.PipeClient).GetMethod(nameof(Volt.Wire.PipeClient.Call))!.ReturnType.Assembly);
            Binds(lines, "Volt.Contracts.WireJson.Write", () =>
                typeof(Volt.Contracts.WireJson).GetField(nameof(Volt.Contracts.WireJson.Write))!.FieldType.Assembly);
            return lines;
        }

        private static void Bound(List<string> lines, string name, Func<Assembly> resolve)
        {
            Assembly? bound = null;
            try { bound = resolve(); }
            catch (Exception ex) { lines.Add($"{name} could not be bound: {ex.GetType().Name}: {ex.Message}"); }
            Loaded(lines, name, bound);
        }

        /// <summary>Every loaded copy of <paramref name="name"/>, the bound one marked.</summary>
        private static void Loaded(List<string> lines, string name, Assembly? bound)
        {
            var copies = AppDomain.CurrentDomain.GetAssemblies().Where(a => a.GetName().Name == name).ToList();
            if (bound != null && !copies.Contains(bound)) copies.Insert(0, bound);
            if (copies.Count == 0) { lines.Add($"{name} not loaded"); return; }
            foreach (var a in copies)
                lines.Add($"{name} {Describe(a)}{(a == bound ? " [bound]" : bound != null ? " [ALSO LOADED]" : "")}");
        }

        private static void Binds(List<string> lines, string member, Func<Assembly> resolve)
        {
            try { var a = resolve(); lines.Add($"{member} binds {a.GetName().Name} {Describe(a)}"); }
            catch (Exception ex) { lines.Add($"{member} does not bind: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static string Describe(Assembly a)
        {
            string location;
            try { location = a.Location; } catch (NotSupportedException) { location = ""; }
            if (string.IsNullOrEmpty(location)) return $"{a.GetName().Version} (no file: loaded from bytes)";
            var file = FileVersionInfo.GetVersionInfo(location).FileVersion;
            return $"{a.GetName().Version} (file {file}{(a.GlobalAssemblyCache ? ", GAC" : "")}) at {location}";
        }
    }
}
