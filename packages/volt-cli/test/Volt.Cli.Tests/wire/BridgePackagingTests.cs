using System.Diagnostics;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.RegularExpressions;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// THE RELEASE IN HEALTH IS THE BUILD THAT PRODUCED THE BUNDLE (openspec ide-identity-report 4.2).
///
/// <para>PLCAssist saw <c>1.0.0.0</c> on all 135 Volt-era chats because the bundles it ran were unstamped and the only
/// version it got was the assembly version. The unit rows (<c>BridgeReleaseTests</c>) pin the D3 READING; this test
/// pins the PACKAGING: for each shipped bridge bundle it runs THE LINE OF <c>build-cli.ps1</c> THAT PRODUCES IT — verb,
/// project and flags read from the script, <c>@VERARGS</c> expanded from the script's own <c>$VERARGS</c> definition;
/// only the configuration and the output folder are redirected — so the stamp has to travel the way it does in a
/// release: through the bundle project's ProjectReference into <c>Volt.Engine.Host</c>. It then loads the
/// <c>Volt.Engine.Host.dll</c> that landed in that bundle into its own load context, serves <c>health</c> from it over
/// a real pipe and reads <c>bridgeVersion</c> back. Dropping <c>@VERARGS</c> from a bundle line, dropping
/// <c>/p:FileVersion</c> from <c>$VERARGS</c>, or cutting the global-property flow on the host's ProjectReference
/// (<c>GlobalPropertiesToRemove</c>) each fails here.</para>
///
/// <list type="bullet">
/// <item>stamped (<c>VOLT_VERSION</c> set) → exactly that version;</item>
/// <item>unstamped → <c>(dev) &lt;commit&gt;</c>, the commit being the HEAD the build was made from — never
/// <c>1.0.0.0</c>, never a bare <c>(dev)</c> for a build that knows its commit.</item>
/// </list>
///
/// <para>Each build uses its own configuration name, so it never touches the Debug/Release outputs of the tree. Two
/// test processes may run at once (another workflow on the same machine): the builds share the in-tree
/// <c>obj/&lt;configuration&gt;</c> folders, so they are serialized by a machine-wide mutex, and each build writes to
/// an output folder of its own, named after its process — only folders of exited processes are swept (the loaded host
/// stays locked until its process exits).</para>
/// </summary>
public class BridgePackagingTests
{
    private const string Stamp = "0.4.2.4242";

    private static string Root([System.Runtime.CompilerServices.CallerFilePath] string here = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", ".."));   // packages/volt-cli

    private static string Script() => File.ReadAllText(Path.Combine(Root(), "scripts", "build-cli.ps1"));

    /// <summary>The stamping arguments, exactly as <c>build-cli.ps1</c> builds them for <paramref name="version"/>.</summary>
    private static string[] VerArgs(string version)
    {
        var m = Regex.Match(Script(), @"\$VERARGS\s*=\s*if\s*\(\$VER\)\s*\{\s*@\((?<args>[^)]*)\)\s*\}\s*else\s*\{\s*@\(\)\s*\}");
        Assert.True(m.Success, "build-cli.ps1 no longer states `$VERARGS = if ($VER) { @(...) } else { @() }` — update this test to its new form");
        var args = Regex.Matches(m.Groups["args"].Value, "\"([^\"]*)\"").Select(a => a.Groups[1].Value.Replace("$VER", version)).ToArray();
        Assert.NotEmpty(args);
        return args;
    }

    /// <summary>Every <c>dotnet build|publish</c> line of the script that produces a shipped binary, by project name
    /// (the test step is <c>dotnet test</c> and is not one of them).</summary>
    private static Dictionary<string, string> ProductLines() =>
        Regex.Matches(Script(), @"^[ \t]*&[ \t]*\$DOTNET[ \t]+(?:build|publish)[ \t]+""\$ROOT\\src\\(?<proj>[^\\""]+)\\[^""]+\.csproj"".*$", RegexOptions.Multiline)
            .ToDictionary(l => l.Groups["proj"].Value, l => l.Value.Trim());

    /// <summary>The script's line for <paramref name="project"/> as arguments to dotnet: <c>@VERARGS</c> expanded to
    /// <paramref name="verArgs"/>, <c>-c</c> and <c>-o</c> redirected; every other flag kept as the script states it
    /// (restore included: the TwinCAT line's <c>-r win-x64</c> needs its own assets target, as it does in the script).</summary>
    private static List<string> BundleCommand(string project, string configuration, string outDir, IEnumerable<string> verArgs)
    {
        Assert.True(ProductLines().TryGetValue(project, out var line), $"build-cli.ps1 has no `& $DOTNET build|publish` line for {project}");
        var tokens = Regex.Matches(line!, "\"[^\"]*\"|\\S+").Select(t => t.Value).Skip(2).ToList();   // drop `&` `$DOTNET`
        var args = new List<string>();
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t == "@VERARGS") args.AddRange(verArgs);
            else if (t is "-c" or "-o") { args.Add(t); args.Add(t == "-c" ? configuration : outDir); i++; }
            else if (t.StartsWith("\"", StringComparison.Ordinal)) args.Add(t.Trim('"').Replace("$ROOT", Root()));
            else args.Add(t);
        }
        return args;
    }

    private static string Run(string exe, IEnumerable<string> args, string cwd)
    {
        var psi = new ProcessStartInfo(exe) { WorkingDirectory = cwd, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        Assert.True(p.WaitForExit(TimeSpan.FromMinutes(5)), $"{exe} {string.Join(" ", args)} did not finish in 5 min");
        Assert.True(p.ExitCode == 0, $"{exe} {string.Join(" ", args)} exited {p.ExitCode}\n{stdout.Result}\n{stderr.Result}");
        return stdout.Result.Trim();
    }

    /// <summary>The dotnet that runs this test (set by the dotnet host for its children). Fails loud when absent —
    /// no guess at an install path: several are present on the dev machine and only one carries the SDK.</summary>
    private static string Dotnet() =>
        Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") is { Length: > 0 } d
            ? d
            : throw new InvalidOperationException("DOTNET_HOST_PATH is unset: run this test through `dotnet test`, which names the dotnet that builds the bundle");

    private static string PackagingTemp => Path.Combine(Path.GetTempPath(), "volt-packaging");

    /// <summary>Builds <paramref name="project"/>'s bundle by the script's own line into a fresh output folder.</summary>
    private static string Build(string project, string configuration, IEnumerable<string> verArgs)
    {
        // The in-tree obj/<configuration> folders are shared by every run of this test on the machine: serialize the
        // builds. An abandoned mutex (a run that died mid-build) is still acquired; msbuild redoes what it left.
        using var gate = new Mutex(false, @"Global\volt-packaging-tests");
        try { Assert.True(gate.WaitOne(TimeSpan.FromMinutes(10)), "another packaging build held the mutex for 10 min"); }
        catch (AbandonedMutexException) { }
        try
        {
            SweepEarlierOutputs();
            var outDir = Path.Combine(PackagingTemp, $"{Environment.ProcessId}-{configuration}-{project}-{Guid.NewGuid():N}");
            Run(Dotnet(), BundleCommand(project, configuration, outDir, verArgs), Root());
            Assert.True(File.Exists(Path.Combine(outDir, "Volt.Engine.Host.dll")), $"the {project} bundle carries no Volt.Engine.Host.dll");
            return outDir;
        }
        finally { gate.ReleaseMutex(); }
    }

    /// <summary>Removes the output folders of test processes that have EXITED. A folder is named after the process that
    /// built it; one whose process is still alive is that process's (it may be between building and loading it, when
    /// nothing locks it yet) and is left alone.</summary>
    private static void SweepEarlierOutputs()
    {
        if (!Directory.Exists(PackagingTemp)) return;
        foreach (var dir in Directory.GetDirectories(PackagingTemp))
        {
            var owner = Path.GetFileName(dir).Split('-')[0];
            if (int.TryParse(owner, out var pid) && Alive(pid)) continue;
            try { Directory.Delete(dir, recursive: true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }   // still locked: the next run
        }
    }

    private static bool Alive(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
        catch (ArgumentException) { return false; }   // no such process
    }

    /// <summary>Serves <c>health</c> from the BUILT host (its own load context, its own static release read) over a real
    /// pipe; the driver is a proxy over the built <c>IIdeDriver</c> that answers only what health asks.</summary>
    private static JsonElement HealthFrom(string outDir)
    {
        var alc = new BundleContext(outDir);
        var host = alc.LoadFromAssemblyPath(Path.Combine(outDir, "Volt.Engine.Host.dll"));
        var engine = alc.LoadFromAssemblyName(new AssemblyName("Volt.Engine"));
        var contracts = alc.LoadFromAssemblyName(new AssemblyName("Volt.Contracts"));
        var driverType = engine.GetType("Volt.Engine.Ide.IIdeDriver", throwOnError: true)!;
        var healthType = contracts.GetType("Volt.Contracts.HealthResponse", throwOnError: true)!;

        // The proxy's base type is loaded INTO the bundle's context too: DispatchProxy emits one proxy assembly per load
        // context of the base type, and that assembly binds `Volt.Engine` by name once — so with the base type in the
        // default context, the second bundle's proxy implemented the FIRST bundle's IIdeDriver (MissingMethodException).
        var proxyBase = alc.LoadFromAssemblyPath(typeof(HealthOnly).Assembly.Location).GetType(typeof(HealthOnly).FullName!, throwOnError: true)!;
        var driver = DispatchProxy.Create(driverType, proxyBase);
        proxyBase.GetField(nameof(HealthOnly.Health))!.SetValue(driver, (Func<object>)(() => Activator.CreateInstance(healthType)!));

        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var bridge = (IDisposable)Activator.CreateInstance(host.GetType("Volt.Engine.Host.BridgePipeHost", throwOnError: true)!, driver, pipe)!;
        try
        {
            bridge.GetType().GetMethod("Start")!.Invoke(bridge, null);
            return new PipeClient(pipe).Call("health");
        }
        finally { bridge.Dispose(); }
    }

    private sealed class BundleContext(string dir) : AssemblyLoadContext("volt-bundle-" + Path.GetFileName(dir))
    {
        // Volt's own assemblies come from the bundle; the framework stays the runtime's.
        protected override Assembly? Load(AssemblyName name) =>
            name.Name is { } n && n.StartsWith("Volt.", StringComparison.Ordinal) && File.Exists(Path.Combine(dir, n + ".dll"))
                ? LoadFromAssemblyPath(Path.Combine(dir, n + ".dll"))
                : null;
    }

    /// <summary>Answers exactly the members the health op reads; any other call is a test-shape error, said by name.</summary>
    public class HealthOnly : DispatchProxy
    {
        public Func<object> Health = () => throw new InvalidOperationException("Health not set");

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "BuildHealthResponse" => Health(),
            "get_Unsupported" or "get_IdeVersion" or "get_ProductName" or "get_ProductVersion" or "get_ProductVendor" => null,
            _ => throw new NotSupportedException($"health asked the driver for {method?.Name}, which this double does not answer"),
        };
    }

    private static string? BridgeVersion(JsonElement h) =>
        h.TryGetProperty("bridgeVersion", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static TheoryData<string> Bundles => new() { "Volt.Ide.Codesys", "Volt.Ide.Twincat" };

    [Fact]
    public void Every_shipped_binary_is_built_with_the_stamping_arguments()
    {
        var lines = ProductLines();
        Assert.Equal(new[] { "Volt.Cli", "Volt.Connector", "Volt.Ide.Codesys", "Volt.Ide.Twincat" }, lines.Keys.Order());
        Assert.All(lines, l => Assert.True(Regex.IsMatch(l.Value, @"(^|\s)@VERARGS(\s|$)"), $"build-cli.ps1 builds {l.Key} without @VERARGS: {l.Value}"));
    }

    [Theory]
    [MemberData(nameof(Bundles))]
    public void A_stamped_bundle_reports_the_version_it_was_stamped_with(string bundle)
    {
        Assert.Equal(Stamp, BridgeVersion(HealthFrom(Build(bundle, "PackagingStamped", VerArgs(Stamp)))));
    }

    [Theory]
    [MemberData(nameof(Bundles))]
    public void An_unstamped_bundle_reports_dev_and_the_commit_it_was_built_from(string bundle)
    {
        var head = Run("git", new[] { "rev-parse", "HEAD" }, Root());
        var v = BridgeVersion(HealthFrom(Build(bundle, "PackagingDev", Array.Empty<string>())));

        Assert.Equal("(dev) " + head, v);
        Assert.NotEqual("1.0.0.0", v);
    }
}
