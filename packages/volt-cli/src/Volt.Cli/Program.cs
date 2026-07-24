using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Engine.Wire;
using Volt.Cli.Sync;
using Volt.Cli.Transport;

namespace Volt.Cli;

/// <summary>
/// The `volt` CLI entry — Resolves the bridge from the workspace
/// binding, dispatches the verb, renders (pretty or --json), sets the exit code. Talks to the bridge over the
/// NAMED PIPE (Volt.Cli.Transport), reusing Volt.Engine's DTOs — one wire contract.
/// </summary>
internal static class Program
{
    // --json keeps nulls (JS JSON.stringify keeps null); the result-level optional fields opt into omit-when-null
    // via [JsonIgnore] on the DTO, matching JS's "undefined is omitted, null is kept".
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static void EmitJson(object x) => Console.Out.Write(JsonSerializer.Serialize(x, Json) + "\n");

    /// <summary>volt.exe's OWN stamped FileVersion — the fact, not a sidecar file's claim. build-cli.ps1 stamps
    /// every binary from VOLT_VERSION, so this is the shipped version and cannot drift from the binary the way a
    /// version.txt beside it could. "(dev)" when run from a build tree that carries no stamp.</summary>
    private static string ShippedVersion()
    {
        try
        {
            var v = System.Diagnostics.FileVersionInfo.GetVersionInfo(System.Environment.ProcessPath!).FileVersion?.Trim();
            if (!string.IsNullOrEmpty(v) && v != "0.0.0.0") return v!;
        }
        catch { }
        return "(dev)";
    }

    private static int Main(string[] args)
    {
        // `volt --version` — the binary's own stamped version, so every Volt binary reports the SAME version (all
        // stamped from one VOLT_VERSION at build) and the connector's Status window can verify they're in sync.
        if (args.Length > 0 && (args[0] == "--version" || args[0] == "-v" || args[0] == "version"))
        {
            Console.WriteLine(ShippedVersion());
            return 0;
        }

        var a = ParseArgs(args);
        var root = Path.GetFullPath(a.Workspace);
        // Pipe resolution: an explicit --pipe / VOLT_PIPE wins (dev + tests). Otherwise TwinCAT is the one worker
        // pipe and CODESYS is discovered per-instance + matched to the bound project (BridgeResolver). Resolved
        // LAZILY so bridge-free verbs (merge/help) never probe — and so a resolution refusal surfaces in the catch.
        var pipeOverride = a.Value("--pipe") ?? Environment.GetEnvironmentVariable("VOLT_PIPE");
        var vendor = a.Vendor ?? Config.ConfiguredVendor(root) ?? Vendors.Codesys;
        BridgeClient Bridge() => BridgeResolver.Resolve(root, vendor, pipeOverride, isInit: a.Verb == "init");
        try
        {
            return a.Verb switch
            {
                "init" => CmdInit(Bridge(), a),
                "pull" => CmdPull(root, Bridge(), a),
                "push" => CmdPush(root, Bridge(), a),
                "status" => CmdStatus(root, Bridge(), a),
                "build" => CmdBuild(root, Bridge(), a),
                "show" => CmdShow(root, Bridge(), a),
                "merge" => CmdMerge(root, a),
                "help" or "--help" => Emit(Usage, 0),
                _ => Emit(Usage, a.Verb is null ? 0 : 1),
            };
        }
        catch (TimeoutException) { return Unreachable(); }
        catch (IOException) { return Unreachable(); }
        catch (BridgeError e) { Console.Error.WriteLine(e.Message); return 1; }
        catch (PipeCallException e) { Console.Error.WriteLine(e.Message); return 1; }
        catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }

    private static int Unreachable()
    {
        Console.Error.WriteLine("bridge is not reachable — is the IDE bridge running? (start it from the Volt Connector)");
        return 1;
    }

    // ── verbs ──────────────────────────────────────────────────────────────────

    private static int CmdInit(BridgeClient bridge, Args a)
    {
        var r = Commands.Init(a.Operand(0) ?? a.Workspace, bridge, Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Kind == "ok" ? 0 : 1; }
        if (r.Kind == "error") { Console.Error.WriteLine(r.Reason); return 1; }
        Console.WriteLine($"bound to {r.Project}");
        if (r.GitCreated) Console.WriteLine("initialized a git repo for version control");
        if (r.Scaffold > 0) Console.WriteLine($"scaffolded {r.Scaffold} project file(s)");
        if (r.Corpus > 0) Console.WriteLine($"installed {r.Corpus} language-reference file(s)");
        Console.WriteLine(r.Note ?? $"pulled {r.Pulled} file(s) — workspace ready");
        return 0;
    }

    private static int CmdPull(string root, BridgeClient bridge, Args a)
    {
        var r = Commands.Pull(root, bridge, a.Has("--dry-run"), Reporter.Create(), a.Has("--force"));
        if (a.Has("--json")) { EmitJson(r); return r.Kind == "ok" ? 0 : 2; }
        if (r.Kind == "refused") { Console.Error.WriteLine(r.Reason); return 1; }
        if (r.Kind == "conflict")
        {
            Console.WriteLine($"CONFLICT in {r.Paths!.Count} file(s) — resolve the markers, then `volt merge --continue` (or `volt merge --abort`):");
            foreach (var p in r.Paths!) Console.WriteLine($"  ! {p}");
            return 2;
        }
        Console.WriteLine(r.Message ?? $"pulled {r.Synced!.Count} file(s)");
        return 0;
    }

    private static int CmdPush(string root, BridgeClient bridge, Args a)
    {
        var r = Commands.Push(root, bridge, a.Has("--force"), a.Value("--force-with-lease"), a.Has("--dry-run"), Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Kind == "ok" ? 0 : 2; }
        if (r.Kind == "rejected") { Console.Error.WriteLine(r.Reason); return 1; }
        Console.WriteLine(r.Message ?? $"pushed {r.Items!.Count} item(s)");
        return 0;
    }

    private static int CmdStatus(string root, BridgeClient bridge, Args a)
    {
        var s = Commands.Status(root, bridge, a.Has("--local"));
        if (a.Has("--porcelain"))
        {
            void EmitLines(string code, List<string> names) { foreach (var n in names) Console.WriteLine($"{code} {(s.PathByName.TryGetValue(n, out var p) ? p : n)}"); }
            EmitLines("iA", s.Incoming.Added); EmitLines("iM", s.Incoming.Modified); EmitLines("iD", s.Incoming.Removed);
            EmitLines("oA", s.Outgoing.Added); EmitLines("oM", s.Outgoing.Modified); EmitLines("oD", s.Outgoing.Removed);
            return 0;
        }
        if (a.Has("--json"))
        {
            EmitJson(new { s.Initialized, s.Merging, s.Incoming, s.Outgoing, s.PathByName, s.ProjectMismatch, s.Summary, s.IncomingStale });
            return 0;
        }
        Console.WriteLine($"bridge: {(s.Online ? "connected" : "offline")} — {s.Detail}");
        FmtChangeSet("incoming (IDE → you)", s.Incoming);
        FmtChangeSet("outgoing (you → IDE)", s.Outgoing);
        if (s.Merging is not null)
        {
            Console.WriteLine($"merge in progress — {s.Merging.Conflicts.Count} conflict(s):");
            foreach (var c in s.Merging.Conflicts) Console.WriteLine($"  ! {c.Path}");
        }
        Console.WriteLine(s.Summary);
        if (s.Recommend is not null) Console.WriteLine($"next: {s.Recommend}");
        return 0;
    }

    private static int CmdBuild(string root, BridgeClient bridge, Args a)
    {
        var pending = Commands.UnpushedCount(root);
        if (pending > 0 && !a.Has("--json"))
            Console.WriteLine($"note: {pending} local change(s) not pushed — this build reflects the IDE, not your workspace. Run `volt push` first.");
        var r = Commands.Build(root, bridge, a.Has("--full"), Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Success ? 0 : 2; }
        Console.WriteLine($"Build {(r.Success ? "succeeded" : "FAILED")} ({r.Duration}ms)");
        foreach (var d in r.Diagnostics) Console.WriteLine($"  [{d.Severity}] {d.Message}{(d.Line > 0 ? $" (line {d.Line})" : "")}");
        return r.Success ? 0 : 2;
    }

    private static int CmdShow(string root, BridgeClient bridge, Args a)
    {
        var refName = a.Operand(0);
        var rel = a.Operand(1);
        if (refName is null || rel is null) { Console.Error.WriteLine("usage: volt show <ref> <path>"); return 1; }
        var (bytes, error, absent) = Commands.Show(root, bridge, refName, rel);
        if (bytes is not null) { using var o = Console.OpenStandardOutput(); o.Write(bytes, 0, bytes.Length); return 0; }
        Console.Error.WriteLine(error);
        // Absent (item not present at this ref — e.g. an added/removed item in a diff) → exit 2, which the diff
        // content-provider renders as an empty pane. A genuine error (bad path / no merge) → exit 1.
        return absent ? 2 : 1;
    }

    private static int CmdMerge(string root, Args a)
    {
        var (code, message) = Commands.Merge(root, a.Has("--continue"), a.Has("--abort"), a.Value("--resolve"), a.Has("--use-ours"), a.Has("--use-theirs"));
        if (code == 0) Console.WriteLine(message); else Console.Error.WriteLine(message);
        return code;
    }

    // ── arg parsing ──────────────────────────────────

    private static readonly HashSet<string> ValueFlags = new() { "--workspace", "--vendor", "--limit", "--resolve", "--timeout", "--force-with-lease" };

    private sealed class Args
    {
        public string? Verb;
        public List<string> Operands = new();
        public HashSet<string> Flags = new();
        public Dictionary<string, string> Values = new();
        public string Workspace = "";
        public string? Vendor;
        public bool Has(string f) => Flags.Contains(f);
        public string? Value(string f) => Values.TryGetValue(f, out var v) ? v : null;
        public string? Operand(int i) => i < Operands.Count ? Operands[i] : null;
    }

    private static Args ParseArgs(string[] argv)
    {
        var a = new Args();
        var positional = new List<string>();
        for (var i = 0; i < argv.Length; i++)
        {
            var s = argv[i];
            if (s.StartsWith("--", StringComparison.Ordinal))
            {
                var eq = s.IndexOf('=');
                if (eq >= 0) a.Values[s[..eq]] = s[(eq + 1)..];
                else if (ValueFlags.Contains(s)) a.Values[s] = i + 1 < argv.Length ? argv[++i] : "";
                else a.Flags.Add(s);
            }
            else positional.Add(s);
        }
        a.Verb = positional.Count > 0 ? positional[0] : null;
        a.Operands = positional.Skip(1).ToList();
        a.Workspace = a.Value("--workspace") ?? Environment.GetEnvironmentVariable("VOLT_WORKSPACE") ?? Directory.GetCurrentDirectory();
        a.Vendor = a.Value("--vendor") ?? Environment.GetEnvironmentVariable("VOLT_VENDOR");
        return a;
    }

    private static void FmtChangeSet(string label, ChangeSet c)
    {
        if (c.Count == 0) return;
        Console.WriteLine($"{label} ({c.Count}):");
        foreach (var p in c.Added) Console.WriteLine($"  + {p}");
        foreach (var p in c.Modified) Console.WriteLine($"  ~ {p}");
        foreach (var p in c.Removed) Console.WriteLine($"  - {p}");
    }

    private static int Emit(string text, int code) { Console.WriteLine(text); return code; }

    private const string Usage =
        "volt <command> [args] — git-native Volt CLI (C#, over named pipe)\n\n" +
        "  init     bind to the bridge, git-init the project, first pull\n" +
        "  pull     fetch the IDE → git merge into your branch       [--force] [--dry-run]\n" +
        "  push     workspace → IDE → fast-forward volt/ide          [--force] [--dry-run] [--force-with-lease=<v>]\n" +
        "  status   incoming / outgoing / merge state                [--json] [--porcelain]\n" +
        "  build    build via the IDE; returns diagnostics           [--full] [--json]\n" +
        "           (IDE-sync history is native git: `git log volt/ide`)\n" +
        "  show     a file at a ref:  <ref> <path>   (HEAD / VOLTIDE / MERGE_OURS|THEIRS|BASE / BRIDGE / WORKSPACE)\n" +
        "  merge    finish a conflicted pull:  --continue | --abort | --resolve <path> [--use-ours|--use-theirs]\n\n" +
        "  flags: --workspace <dir>  --vendor <codesys|twincat>";
}
