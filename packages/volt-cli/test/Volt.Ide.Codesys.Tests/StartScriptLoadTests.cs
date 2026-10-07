using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE BRIDGE IS ONE ASSEMBLY, AND NOTHING IS LEFT TO RESOLVE, HOWEVER THE START SCRIPT IS RUN (openspec
    /// <c>codesys-bridge-single-assembly</c>).
    ///
    /// <para>The field failure this guards (openspec <c>codesys-single-load-dependencies</c>, DIALECT V6): Volt's
    /// assemblies referenced <c>System.Text.Json</c> 10.0.0.0 while 10.0.0.12 shipped, so every dependency reached
    /// <c>CODESYS.exe</c> through an <c>AssemblyResolve</c> handler — and IronPython's, registered first and probing
    /// <c>sys.path</c> (where CODESYS puts the running script's folder), answered some requests from the download folder
    /// while the bridge's own answered others from the staged copy: two <c>System.Text.Json</c>, two <c>JsonElement</c>
    /// types, every call failing. The bundle is now ONE assembly with <c>Volt.*</c> and <c>System.Text.Json</c> (and its
    /// net48 dependencies) merged and internalized at build, so no handler is asked for anything of Volt's.</para>
    ///
    /// <para>This runs the SHIPPED script, verbatim, in the IronPython CODESYS runs scripts in (2.7.12, from NuGet), over
    /// the SHIPPED bundle (the merged build output, copied in as <c>codesys-bundle</c> by this project), with the script's
    /// own folder on <c>sys.path</c> the way CODESYS's <i>Execute Script File</i> puts it there, in an AppDomain of its own
    /// whose base folder holds no Volt assembly (as CODESYS's does not). The script is run without <c>projects</c> — so it
    /// stops at the <c>PipeHost.Start</c> call, which would open a pipe and write the machine's Volt log; <c>PipeHost</c>'s
    /// bodies are then COMPILED (what the JIT binds before <c>Start</c> runs) and the members whose signatures carry
    /// <c>System.Text.Json</c> types are read. A handler of the test's own, registered before IronPython's, records every
    /// <c>AssemblyResolve</c> request in the domain.</para>
    /// </summary>
    public class StartScriptLoadTests
    {
        private static string Root([System.Runtime.CompilerServices.CallerFilePath] string here = "") =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", ".."));   // packages/volt-cli

        /// <summary>The build output (CodeBase): xunit shadow-copies each assembly into a folder of its own.</summary>
        private static string Bin => Path.GetDirectoryName(new Uri(typeof(StartScriptLoadTests).Assembly.CodeBase).LocalPath)!;

        /// <summary>The shipped bundle: what <c>build-cli.ps1</c> lays beside the script — the Volt.Ide.Codesys build's
        /// <c>bundle</c> folder, copied here by this test project.</summary>
        private static string Bundle => Path.Combine(Bin, "codesys-bundle");

        /// <summary>What the merge took in: every assembly the unmerged build copies beside the bridge (this test project
        /// references the bridge's project, so they are here too). None of them may be loaded, or asked for, at all.</summary>
        private static readonly string[] Merged =
        {
            "Volt.Contracts", "Volt.Engine", "Volt.Engine.Host", "Volt.Relay", "Volt.Wire",
            "System.Text.Json", "System.Text.Encodings.Web", "System.IO.Pipelines", "Microsoft.Bcl.AsyncInterfaces",
            "System.Memory", "System.Buffers", "System.Numerics.Vectors", "System.Runtime.CompilerServices.Unsafe",
            "System.Threading.Tasks.Extensions",
        };

        /// <summary>Once; twice in one IDE session (the user runs it again: a fresh script engine whose sys.path holds the
        /// folder again, while the first engine's resolver is still hooked); with staging failing, so the bridge loads from
        /// the download folder itself; and in a process that already holds ANOTHER <c>System.Text.Json</c> (another plugin's
        /// copy, loaded before Volt).</summary>
        [Theory]
        [InlineData(1, false, false)]
        [InlineData(2, false, false)]
        [InlineData(1, true, false)]
        [InlineData(1, false, true)]
        public void Started_from_its_own_folder_on_sys_path_the_bridge_is_one_assembly_and_asks_for_nothing(int runs, bool stagingFails, bool otherJson)
        {
            Assert.True(Directory.Exists(Bundle), $"no shipped bundle at {Bundle}: the Volt.Ide.Codesys build did not produce one");
            var root = Path.Combine(Path.GetTempPath(), "volt-single-load-" + Guid.NewGuid().ToString("N"));
            var download = Path.Combine(root, "PLCAssistBridge-CODESYS", "codesys-scriptcommands");
            var temp = Path.Combine(root, "temp");
            var hostBase = Path.Combine(root, "host");   // the IDE's own base folder: no Volt assembly in it
            foreach (var d in new[] { download, temp, hostBase }) Directory.CreateDirectory(d);
            foreach (var f in Directory.GetFiles(Bundle)) File.Copy(f, Path.Combine(download, Path.GetFileName(f)));
            var script = Path.Combine(download, "start_volt_codesys.py");
            File.Copy(Path.Combine(Root(), "scripts", "start_volt_codesys.py"), script);
            if (stagingFails)
            {
                // A FILE where this session's staging folder goes (%TEMP%\Volt\codesys-bridge\<pid>): the copy cannot be made.
                var staging = Path.Combine(temp, "Volt", "codesys-bridge");
                Directory.CreateDirectory(staging);
                File.WriteAllText(Path.Combine(staging, System.Diagnostics.Process.GetCurrentProcess().Id.ToString()), "");
            }
            // Another plugin's System.Text.Json: the unmerged one this project's build copies beside the tests.
            var foreignJson = otherJson ? Path.Combine(Bin, "System.Text.Json.dll") : null;

            var domain = AppDomain.CreateDomain("volt-ide-" + Guid.NewGuid().ToString("N"), null,
                new AppDomainSetup { ApplicationBase = hostBase });
            try
            {
                var host = (ScriptHost)domain.CreateInstanceFromAndUnwrap(
                    new Uri(typeof(ScriptHost).Assembly.CodeBase).LocalPath, typeof(ScriptHost).FullName!);
                // CODESYS's order: its ScriptLib (here the standard library the script imports), then the script's folder.
                var run = host.Run(script, new[] { Path.Combine(Bin, "Lib"), download }, temp, runs, foreignJson);
                var said = string.Join("\n", run.Printed);
                var report = "\nloaded:\n" + string.Join("\n", run.Loaded.Select(c => $"{c.Name} {c.Version} at {c.Location}"))
                             + "\nasked for:\n" + string.Join("\n", run.Asked)
                             + "\nbound:\n" + string.Join("\n", run.Bound) + "\nprinted:\n" + said;

                // ONE Volt assembly, from the folder staging decided.
                var volt = run.Loaded.Where(c => c.Name.StartsWith("Volt.", StringComparison.Ordinal)).ToList();
                var bridge = Assert.Single(volt);
                Assert.True(bridge.Name == "Volt.Ide.Codesys", "the one Volt assembly loaded is not the bridge" + report);
                var folder = Path.GetDirectoryName(bridge.Location)!;
                Assert.True(string.Equals(folder, download, StringComparison.OrdinalIgnoreCase) == stagingFails,
                    $"the bridge loaded from {folder} (staging {(stagingFails ? "failed" : "succeeded")})" + report);

                // Nothing merged is loaded on its own — except the foreign copy the case put there, which is not ours.
                foreach (var c in run.Loaded.Where(c => Merged.Contains(c.Name)))
                    Assert.True(foreignJson != null && c.Name == "System.Text.Json"
                                && string.Equals(c.Location, foreignJson, StringComparison.OrdinalIgnoreCase),
                        $"{c.Name} loaded on its own from {c.Location}" + report);

                // No resolver was asked for anything of Volt's: nothing is left to resolve, so no handler can answer wrong.
                Assert.True(!run.Asked.Any(a => Merged.Contains(a) || a.StartsWith("Volt.", StringComparison.Ordinal)),
                    "AssemblyResolve was asked for a Volt dependency" + report);

                // The members whose signatures carry System.Text.Json types bind the bridge's OWN copy.
                Assert.True(run.Bound.Length > 0 && run.Bound.All(l => l.EndsWith(" binds Volt.Ide.Codesys", StringComparison.Ordinal)),
                    "a wire member binds something other than the bridge itself" + report);
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
            public Result(string[] printed, string[] asked, string[] bound, Copy[] loaded)
            { Printed = printed; Asked = asked; Bound = bound; Loaded = loaded; }
            public string[] Printed { get; }
            /// <summary>The simple name of every <c>AssemblyResolve</c> request raised in the domain.</summary>
            public string[] Asked { get; }
            /// <summary><c>&lt;member&gt; binds &lt;assembly&gt;</c>: where the System.Text.Json type in a wire member's
            /// signature comes from.</summary>
            public string[] Bound { get; }
            public Copy[] Loaded { get; }
        }

        /// <summary>The IDE side, in its own AppDomain. Touches NO Volt type itself — only IronPython and reflection — so
        /// every Volt assembly in the domain is one the script and the bridge loaded.</summary>
        public sealed class ScriptHost : MarshalByRefObject
        {
            private readonly List<string> _asked = new();

            public Result Run(string script, string[] sysPath, string temp, int runs, string? foreignJson)
            {
                // Registered BEFORE any IronPython engine, so it sees every request first; it answers none.
                AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
                {
                    lock (_asked) _asked.Add(new AssemblyName(e.Name).Name ?? e.Name);
                    return null;
                };
                if (foreignJson != null) Assembly.LoadFrom(foreignJson);

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
                    // references exactly as the first call would.
                    foreach (var m in bridge.GetType("Volt.Ide.Codesys.PipeHost", true)!
                                 .GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly))
                        System.Runtime.CompilerServices.RuntimeHelpers.PrepareMethod(m.MethodHandle);
                    // The two members the field failures named (DIALECT V3), read off the bridge by name: where the
                    // System.Text.Json type in each signature comes from.
                    const BindingFlags any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;
                    var call = bridge.GetType("Volt.Wire.PipeClient", true)!.GetMethods(any).First(m => m.Name == "Call");
                    bound.Add("Volt.Wire.PipeClient.Call binds " + call.ReturnType.Assembly.GetName().Name);
                    var write = bridge.GetType("Volt.Contracts.WireJson", true)!.GetField("Write", any)!;
                    bound.Add("Volt.Contracts.WireJson.Write binds " + write.FieldType.Assembly.GetName().Name);
                }

                var loaded = AppDomain.CurrentDomain.GetAssemblies()
                    .Where(a => !a.IsDynamic)
                    .Select(a => new Copy(a.GetName().Name!, a.GetName().Version?.ToString(), a.Location))
                    .Where(c => c.Name != typeof(ScriptHost).Assembly.GetName().Name)
                    .ToArray();
                var printed = Encoding.UTF8.GetString(output.ToArray()).Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(l => l.TrimEnd('\r')).ToArray();
                GC.KeepAlive(engines);
                string[] asked;
                lock (_asked) asked = _asked.Distinct().ToArray();
                return new Result(printed, asked, bound.ToArray(), loaded);
            }
        }
    }
}
