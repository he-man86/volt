using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Volt.Contracts;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// ONE COPY OF EVERY VOLT DEPENDENCY, FROM ONE FOLDER, HOWEVER THE BRIDGE IS STARTED (openspec
    /// <c>codesys-single-load-dependencies</c>).
    ///
    /// <para>A customer's CODESYS 3.5.22.10 failed every bridge call with <c>MissingMethodException … PipeRequest.get_Body()</c>
    /// and <c>health.loadConflicts</c> named <c>System.Text.Json</c> loaded twice: from the download folder the user ran
    /// <c>start_volt_codesys.py</c> from, and from the per-session staged copy in <c>%TEMP%\Volt\codesys-bridge\&lt;pid&gt;</c>.
    /// Measured live on 3.5.21.40 (2026-10-07) with an assembly-load trace: CODESYS puts the running script's folder on
    /// IronPython's <c>sys.path</c>; <c>clr.AddReferenceToFileAndPath(staged)</c> loaded the bridge with IronPython's own
    /// <c>LoadFile</c>, which makes IronPython's <c>AssemblyResolve</c> handler (registered before the bridge's own) answer
    /// every dependency the bridge asks for — and every request with NO requesting assembly, which the CLR raises while
    /// reading a member's signature — by probing <c>sys.path</c> IN ORDER, the download folder first. So
    /// <c>Volt.Wire</c>, <c>Volt.Contracts</c>, <c>Volt.Engine*</c> and one <c>System.Text.Json</c> came from the download
    /// folder (<c>PythonContext.CurrentDomain_AssemblyResolve → Assembly.LoadFile</c>), while the requests IronPython
    /// declines reached <c>BridgeAssemblyResolver</c> and loaded a second <c>System.Text.Json</c> from the staged folder
    /// (<c>Assembly.LoadFrom</c>). Two <c>JsonElement</c> types; every request failed at <c>WireJson.Read</c>. A second run
    /// of the script found a second route: its <c>_prune</c> deleted the running bridge's not-yet-loaded dependencies.</para>
    ///
    /// <para>This runs the SHIPPED script, verbatim, in the IronPython CODESYS runs scripts in (2.7.12, from NuGet), with
    /// the script's own folder on <c>sys.path</c> the way CODESYS's <i>Execute Script File</i> puts it there, in an
    /// AppDomain of its own whose base folder holds no Volt assembly (as CODESYS's does not). The script is run without
    /// <c>projects</c> — so it stops at the <c>PipeHost.Start</c> call, which would open a pipe and write the machine's
    /// Volt log; <c>PipeHost</c>'s bodies are then COMPILED (what the JIT binds before <c>Start</c> runs) and the bindings
    /// <c>Start</c> makes first are made by the bridge's own <see cref="BoundAssemblies"/>, the code that writes the start
    /// log's <c>bound:</c> lines. Then every watched assembly loaded in that domain must be ONE copy, loaded from the folder
    /// the bridge itself was loaded from.</para>
    /// </summary>
    public class StartScriptLoadTests
    {
        private static string Root([System.Runtime.CompilerServices.CallerFilePath] string here = "") =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", ".."));   // packages/volt-cli

        /// <summary>The build output (CodeBase): xunit shadow-copies each assembly into a folder of its own.</summary>
        private static string Bin => Path.GetDirectoryName(new Uri(typeof(StartScriptLoadTests).Assembly.CodeBase).LocalPath)!;

        /// <summary>What the bridge bundle ships beside the script (build-cli.ps1: the Volt.Ide.Codesys build output).</summary>
        private static bool Shipped(string file)
        {
            var name = Path.GetFileNameWithoutExtension(file);
            return Path.GetExtension(file) == ".dll"
                   && ((name.StartsWith("Volt.", StringComparison.Ordinal) && !name.EndsWith(".Tests", StringComparison.Ordinal))
                       || name.StartsWith("System.", StringComparison.Ordinal)
                       || name.StartsWith("Microsoft.Bcl.", StringComparison.Ordinal));
        }

        /// <summary>Once; twice in one IDE session (the user runs it again: a fresh script engine whose sys.path holds the
        /// folder again, while the first engine's resolver is still hooked — and the second run's staging prunes the
        /// temp folder the first run's bridge is loaded from); and with staging failing, so the bridge loads from the
        /// download folder itself.</summary>
        [Theory]
        [InlineData(1, false)]
        [InlineData(2, false)]
        [InlineData(1, true)]
        public void Started_from_its_own_folder_on_sys_path_the_bridge_loads_each_dependency_once_from_one_folder(int runs, bool stagingFails)
        {
            var root = Path.Combine(Path.GetTempPath(), "volt-single-load-" + Guid.NewGuid().ToString("N"));
            var download = Path.Combine(root, "PLCAssistBridge-CODESYS", "codesys-scriptcommands");
            var temp = Path.Combine(root, "temp");
            var hostBase = Path.Combine(root, "host");   // the IDE's own base folder: no Volt assembly in it
            foreach (var d in new[] { download, temp, hostBase }) Directory.CreateDirectory(d);
            foreach (var f in Directory.GetFiles(Bin).Where(Shipped)) File.Copy(f, Path.Combine(download, Path.GetFileName(f)));
            var script = Path.Combine(download, "start_volt_codesys.py");
            File.Copy(Path.Combine(Root(), "scripts", "start_volt_codesys.py"), script);
            if (stagingFails)
            {
                // A FILE where this session's staging folder goes (%TEMP%\Volt\codesys-bridge\<pid>): the copy cannot be made.
                var staging = Path.Combine(temp, "Volt", "codesys-bridge");
                Directory.CreateDirectory(staging);
                File.WriteAllText(Path.Combine(staging, System.Diagnostics.Process.GetCurrentProcess().Id.ToString()), "");
            }

            var domain = AppDomain.CreateDomain("volt-ide-" + Guid.NewGuid().ToString("N"), null,
                new AppDomainSetup { ApplicationBase = hostBase });
            try
            {
                var host = (ScriptHost)domain.CreateInstanceFromAndUnwrap(
                    new Uri(typeof(ScriptHost).Assembly.CodeBase).LocalPath, typeof(ScriptHost).FullName!);
                // CODESYS's order: its ScriptLib (here the standard library the script imports), then the script's folder.
                var run = host.Run(script, new[] { Path.Combine(Bin, "Lib"), download }, temp, runs);
                var said = string.Join("\n", run.Printed);

                var bridge = run.Loaded.SingleOrDefault(c => c.Name == "Volt.Ide.Codesys");
                Assert.True(bridge != null, "the script did not load the bridge. It printed:\n" + said);
                var folder = Path.GetDirectoryName(bridge!.Location)!;
                Assert.True(string.Equals(folder, download, StringComparison.OrdinalIgnoreCase) == stagingFails,
                    $"the bridge loaded from {folder} (staging {(stagingFails ? "failed" : "succeeded")}). It printed:\n" + said);

                var report = "\n" + string.Join("\n", run.Loaded.Select(c => $"{c.Name} {c.Version} at {c.Location}"))
                             + "\nbound:\n" + string.Join("\n", run.Bound) + "\nprinted:\n" + said;
                var copies = run.Loaded.Select(c => new LoadedCopies.Copy(c.Name, c.Version, null, null, c.Location, false)).ToList();
                Assert.True(LoadedCopies.Conflicts(copies).Count == 0, "load conflict: " + string.Join("; ", LoadedCopies.Conflicts(copies)) + report);
                foreach (var name in new[] { "Volt.Wire", "Volt.Contracts", "Volt.Engine", "Volt.Engine.Host", "System.Text.Json" })
                {
                    var copy = run.Loaded.Where(c => c.Name == name).ToList();
                    Assert.True(copy.Count == 1, $"{name} loaded {copy.Count} times" + report);
                    Assert.True(string.Equals(Path.GetDirectoryName(copy[0].Location), folder, StringComparison.OrdinalIgnoreCase),
                        $"{name} loaded from {copy[0].Location}, not from the bridge's folder {folder}" + report);
                }
                Assert.DoesNotContain(run.Bound, l => l.Contains("could not be bound") || l.Contains("does not bind"));
            }
            finally
            {
                AppDomain.Unload(domain);
                try { Directory.Delete(root, true); } catch { /* a loaded copy can stay locked until the process exits */ }
            }
        }

        [Serializable]
        public sealed class Copy
        {
            public Copy(string name, string? version, string? location) { Name = name; Version = version; Location = location; }
            public string Name { get; }
            public string? Version { get; }
            public string? Location { get; }
        }

        [Serializable]
        public sealed class Result
        {
            public Result(string[] printed, string[] bound, Copy[] loaded) { Printed = printed; Bound = bound; Loaded = loaded; }
            public string[] Printed { get; }
            public string[] Bound { get; }
            public Copy[] Loaded { get; }
        }

        /// <summary>The IDE side, in its own AppDomain. Touches NO Volt type itself — only IronPython and reflection — so
        /// every Volt assembly in the domain is one the script and the bridge loaded.</summary>
        public sealed class ScriptHost : MarshalByRefObject
        {
            public Result Run(string script, string[] sysPath, string temp, int runs)
            {
                var output = new MemoryStream();
                var engines = new List<Microsoft.Scripting.Hosting.ScriptEngine>();   // kept alive: each hooks its resolver
                for (var i = 0; i < runs; i++)
                {
                    var engine = IronPython.Hosting.Python.CreateEngine();
                    engines.Add(engine);
                    engine.SetSearchPaths(sysPath);
                    engine.Runtime.IO.SetOutput(output, Encoding.UTF8);
                    var scope = engine.CreateScope();
                    scope.SetVariable("__file__", script);
                    // Staging goes under a temp folder of this test's own, not the machine's %TEMP%\Volt (the script prunes there).
                    engine.Execute("import os\nos.environ['TEMP'] = r'" + temp + "'\nos.environ.pop('VOLT_BRIDGE_DLL', None)\n", scope);
                    // The shipped script, verbatim. No `projects` in scope: it stops at PipeHost.Start (see the class comment).
                    engine.CreateScriptSourceFromFile(script).Execute(scope);
                }

                var bound = new List<string>();
                var bridge = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == "Volt.Ide.Codesys");
                if (bridge != null)
                {
                    // Compile what Start would run, without running it: the JIT resolves every assembly a body
                    // references (Volt.Wire, Volt.Contracts, Volt.Engine.Host, …) exactly as the first call would.
                    foreach (var m in bridge.GetType("Volt.Ide.Codesys.PipeHost", true)!
                                 .GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly))
                        System.Runtime.CompilerServices.RuntimeHelpers.PrepareMethod(m.MethodHandle);
                    var describe = bridge.GetType("Volt.Ide.Codesys.BoundAssemblies", true)!
                        .GetMethod("Describe", BindingFlags.Public | BindingFlags.Static)!;
                    bound.AddRange((IEnumerable<string>)describe.Invoke(null, null)!);
                }

                var loaded = AppDomain.CurrentDomain.GetAssemblies()
                    .Where(a => !a.IsDynamic)
                    .Select(a => new Copy(a.GetName().Name!, a.GetName().Version?.ToString(), a.Location))
                    .Where(c => c.Name.StartsWith("Volt.", StringComparison.Ordinal) && c.Name != typeof(ScriptHost).Assembly.GetName().Name
                                || c.Name == "System.Text.Json")
                    .ToArray();
                var printed = Encoding.UTF8.GetString(output.ToArray()).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(l => l.TrimEnd('\r')).ToArray();
                GC.KeepAlive(engines);
                return new Result(printed, bound.ToArray(), loaded);
            }
        }
    }
}
