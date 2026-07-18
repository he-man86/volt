using System.Text.Json;
using System.Text.Json.Serialization;
using Volt.Cli.Core.Wire;
using Volt.Cli.Sync;
using Volt.Cli.Transport;

namespace Volt.Cli;

/// <summary>
/// The `volt` CLI entry — C# port of the original TypeScript implementation Resolves the bridge from the workspace
/// binding, dispatches the verb, renders (pretty or --json), sets the exit code. Talks to the bridge over the
/// NAMED PIPE (Volt.Cli.Transport), reusing Volt.Cli.Core's DTOs — one wire contract.
/// </summary>
internal static class Program
{
    // --json keeps nulls (JS JSON.stringify keeps null); the result-level optional fields opt into omit-when-null
    // via [JsonIgnore] on the DTO, matching JS's "undefined is omitted, null is kept".
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static void EmitJson(object x) => Console.Out.Write(JsonSerializer.Serialize(x, Json) + "\n");

    private static int Main(string[] args)
    {
        var a = ParseArgs(args);
        var root = Path.GetFullPath(a.Workspace);
        // Pipe resolution: an explicit --pipe / VOLT_PIPE wins (dev + tests); otherwise the vendor (from --vendor,
        // else the workspace binding, else CODESYS) names the pipe directly.
        var pipeOverride = a.Value("--pipe") ?? Environment.GetEnvironmentVariable("VOLT_PIPE");
        var vendor = a.Vendor ?? Config.ConfiguredVendor(root) ?? "codesys";
        var bridge = string.IsNullOrEmpty(pipeOverride) ? BridgeClient.ForVendor(vendor) : new BridgeClient(pipeOverride);
        try
        {
            return a.Verb switch
            {
                "init" => CmdInit(bridge, a),
                "pull" => CmdPull(root, bridge, a),
                "push" => CmdPush(root, bridge, a),
                "status" => CmdStatus(root, bridge, a),
                "build" => CmdBuild(root, bridge, a),
                "show" => CmdShow(root, bridge, a),
                "merge" => CmdMerge(root, a),
                "diff" => CmdDiff(root, a),
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
        var r = Commands.Pull(root, bridge, a.Has("--dry-run"), Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Kind == "ok" ? 0 : 2; }
        if (r.Kind == "refused") { Console.Error.WriteLine(r.Reason); return 1; }
        if (r.Kind == "conflict")
        {
            Console.WriteLine($"CONFLICT in {r.Paths!.Count} file(s) — resolve the markers, then `git merge --continue` (or `git merge --abort`):");
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
        var s = Commands.Status(root, bridge);
        if (a.Has("--porcelain"))
        {
            void EmitLines(string code, List<string> names) { foreach (var n in names) Console.WriteLine($"{code} {(s.PathByName.TryGetValue(n, out var p) ? p : n)}"); }
            EmitLines("iA", s.Incoming.Added); EmitLines("iM", s.Incoming.Modified); EmitLines("iD", s.Incoming.Removed);
            EmitLines("oA", s.Outgoing.Added); EmitLines("oM", s.Outgoing.Modified); EmitLines("oD", s.Outgoing.Removed);
            return 0;
        }
        if (a.Has("--json"))
        {
            EmitJson(new { s.Initialized, s.Merging, s.Incoming, s.Outgoing, s.PathByName, s.ProjectMismatch, s.Summary });
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
        var (bytes, error) = Commands.Show(root, bridge, refName, rel);
        if (bytes is not null) { using var o = Console.OpenStandardOutput(); o.Write(bytes, 0, bytes.Length); return 0; }
        Console.Error.WriteLine(error);
        return 1;
    }

    private static int CmdMerge(string root, Args a)
    {
        var (code, message) = Commands.Merge(root, a.Has("--continue"), a.Has("--abort"), a.Value("--resolve"), a.Has("--use-ours"), a.Has("--use-theirs"));
        if (code == 0) Console.WriteLine(message); else Console.Error.WriteLine(message);
        return code;
    }

    private static int CmdDiff(string root, Args a)
    {
        var (ok, diffs, error) = Commands.Diff(root);
        if (!ok)
        {
            if (a.Has("--json")) { Console.Out.Write("[]\n"); return 0; } // unbound → no outgoing diff
            Console.Error.WriteLine(error);
            return 1;
        }
        if (a.Has("--json")) { EmitJson(diffs); return 0; }
        foreach (var d in diffs) Console.WriteLine($"{char.ToUpperInvariant(d.Status[0])}  {d.File}  +{d.Additions} -{d.Deletions}");
        return 0;
    }

    // ── arg parsing (port of bin.ts parseArgs) ──────────────────────────────────

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
        "  merge    finish a conflicted pull:  --continue | --abort | --resolve <path> [--use-ours|--use-theirs]\n" +
        "  diff     outgoing per-file diffs                          [--json]\n\n" +
        "  flags: --workspace <dir>  --vendor <codesys|twincat>";
}
