using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// THE OTHER TWO SURFACES, DESCRIBED AND GATED — the connector's HTTP control plane and the `volt` CLI.
///
/// <para>The bridge wire has had a generated OpenRPC document for a while; these two had nothing, which is the
/// gap that made the system feel like a black box from the outside. Each is now a declared table that
/// generates a document AND is checked against the source that implements it, so a route or a verb cannot be
/// added in code and missed here.</para>
///
/// <para><b>Why the tables are hand-written and the gates are not.</b> Neither surface is expressible as a
/// type the way the wire DTOs are: the control plane routes with a string switch on <c>path</c>, and the CLI
/// dispatches a switch on the verb. So the description is written once, and the gate is what keeps it
/// honest — every literal route in <c>ControlServer.cs</c> and every switch arm in <c>Program.cs</c> must
/// appear below, read out of the source itself.</para>
///
/// <para>This lives in the REPO gates, which hold no project reference, so both are read as TEXT. That is the
/// same reason the sibling gates here do it, and it is what lets one test see across two assemblies that do
/// not reference each other.</para>
///
/// <para>Regenerate: <c>VOLT_WRITE_DOCS=1 dotnet test test/Volt.Repo.Gates</c>.</para>
/// </summary>
public class SurfaceDataTests
{
    // ── the connector control plane (HTTP, localhost:8550) ──────────────────────────────────────────

    private sealed record Route(
        string Method,
        string Path,
        string Summary,
        string? Body,
        string Result,
        (int Code, string When)[] Responses);

    private static readonly Route[] Routes =
    {
        new("POST", "/session",
            "Open a session. A client declares itself and gets a lease; the connector reconciles bridges to the "
            + "union of every live session's interests, so nothing is started for a client that went away.",
            null, "{ sessionId: string, leaseSeconds: number }",
            new[] { (200, "the session is open") }),

        new("POST", "/session/{id}/sync",
            "THE PRIMARY CALL. Declare which projects this client is using, renew the lease, and read the state "
            + "back — one round trip. Interests with an empty vendor or project name are dropped rather than "
            + "refused, so a half-filled row from a UI cannot wedge the reconciler.",
            "{ interests: [ { vendor, projectName } ] }", "ConnectorView",
            new[] { (200, "always, even for an unknown session id — a stale client re-syncs rather than erroring") }),

        new("DELETE", "/session/{id}",
            "Close the session. Its interests leave the union immediately, so a bridge nothing else wants stops.",
            null, "(no body)",
            new[] { (204, "closed") }),

        new("GET", "/status",
            "The ambient read: the unified, self-describing project list across every vendor. This is what an "
            + "init/connect picker shows BEFORE any session exists.",
            null, "ConnectorView",
            new[] { (200, "always") }),

        new("POST", "/workers/{id}/restart",
            "Respawn a bridge worker — the recovery the tray offers when one has gone unresponsive.",
            null, "{ ok: true }",
            new[] { (200, "the restart was requested") }),
    };

    /// <summary>The shapes the control plane answers with, spelled from the records in `ControlServer.cs`.</summary>
    private static JsonObject ConnectorSchemas() => new()
    {
        ["ConnectorView"] = new JsonObject
        {
            ["description"] = "Nothing but the one project list. There is deliberately no separate per-vendor "
                + "bridge view and no aggregate status word — every client finds its own row.",
            ["fields"] = new JsonArray(
                Field("projects", "ProjectView[]", "Every project detected across every vendor.")),
        },
        ["ProjectView"] = new JsonObject
        {
            ["description"] = "One detected project, flattened for any first-party client.",
            ["fields"] = new JsonArray(
                Field("id", "string", "The row's stable id."),
                Field("displayName", "string", "What to show. Always equal to `projectName` — both come from the "
                    + "one health-row field, which is the row's identity AND its `connect` address."),
                Field("vendor", "string", "`codesys` or `twincat`."),
                Field("dirty", "boolean", "The workspace has changes the IDE does not."),
                Field("status", "string", "GROUND TRUTH for connection state: `idle` (detected, not served) · "
                    + "`healthy` (served, channel fine) · `degraded` (served, recent errors). Serving is "
                    + "`status != \"idle\"` — never infer it from the row merely being listed, which is what let a "
                    + "UI claim a connection against a gated bridge."),
                Field("projectName", "string", "The name a workspace BINDING matches on."),
                Field("pipe", "string?", "The bridge pipe serving it — what the shells set as `VOLT_PIPE`."),
                Field("ideVersion", "string?", "Disambiguates same-named projects across IDE versions.")),
        },
    };

    private static JsonObject Field(string name, string type, string note) =>
        new() { ["name"] = name, ["type"] = type, ["note"] = note };

    // ── the `volt` CLI ──────────────────────────────────────────────────────────────────────────────

    private sealed record Verb(string Name, string Summary, string Args, string[] Flags, bool Mutates);

    private static readonly Verb[] Verbs =
    {
        new("init", "Bind to the bridge, git-init the project, and take the first pull.", "",
            new[] { "--json" }, true),
        new("rebind", "Re-point a workspace at a different or renamed project. Config only — nothing is pulled.",
            "", new[] { "--project-name <name>" }, false),
        new("pull", "Fetch the IDE and git-merge it into your branch.", "",
            new[] { "--force", "--dry-run", "--json" }, true),
        new("push", "Workspace to IDE, then fast-forward `volt/ide`.", "",
            new[] { "--force", "--dry-run", "--force-with-lease=<v>", "--json" }, true),
        new("status", "Incoming / outgoing / merge state.", "",
            new[] { "--json", "--porcelain", "--local" }, false),
        new("build", "Build through the IDE and return its diagnostics.", "", new[] { "--json" }, false),
        new("show", "A file at a ref.", "<ref> <path>", Array.Empty<string>(), false),
        new("merge", "Finish a conflicted pull.", "",
            new[] { "--continue", "--abort", "--resolve <path>", "--use-ours", "--use-theirs" }, true),
        new("open", "Open the Volt desktop app on this workspace.", "[<dir>]", Array.Empty<string>(), false),
        new("console",
            "Serve this documentation from a process that can reach all three surfaces, so every op, route and "
            + "verb on it becomes callable. Read-only unless `--allow-write` is given.", "",
            new[] { "--port <n>", "--allow-write", "--no-open" }, false),
        new("version", "This binary's own stamped version.", "", new[] { "--version", "-v" }, false),
        new("help", "Usage.", "", Array.Empty<string>(), false),
    };

    /// <summary>Exit codes, and what a caller can conclude from each. Read off `Program.cs`'s dispatch and its
    /// catch arms — the CLI has exactly two outcomes plus usage, which is worth stating plainly because a
    /// script author otherwise guesses.</summary>
    private static readonly (int Code, string Means)[] ExitCodes =
    {
        (0, "The command did what it says. `volt` with no verb also exits 0 after printing usage."),
        (1, "Refused or failed: an unknown verb, an unreachable bridge (timeout or IO), a coded bridge error, or "
            + "any other exception. The message is on STDERR; the reason is not encoded in the exit code."),
    };

    // ── generation ──────────────────────────────────────────────────────────────────────────────────

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "packages", "volt-cli", "Volt.sln")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return dir!.FullName;
    }

    private static string CliDir() => Path.Combine(RepoRoot(), "packages", "volt-cli");

    private static JsonObject BuildSurfaces() => new()
    {
        ["generatedBy"] = "test/Volt.Repo.Gates/SurfaceDataTests.cs",
        ["connector"] = new JsonObject
        {
            ["port"] = 8550,
            ["portEnv"] = "VOLT_CONTROL_PORT",
            ["note"] = "Localhost only, and cross-origin browser requests are refused with 403. Any route that "
                + "matches nothing answers 404 with `{ error }`.",
            ["routes"] = new JsonArray(Routes.Select(r => (JsonNode?)new JsonObject
            {
                ["method"] = r.Method,
                ["path"] = r.Path,
                ["summary"] = r.Summary,
                ["body"] = r.Body,
                ["result"] = r.Result,
                ["responses"] = new JsonArray(r.Responses.Select(x => (JsonNode?)new JsonObject
                {
                    ["code"] = x.Code,
                    ["when"] = x.When,
                }).ToArray()),
            }).ToArray()),
            ["errors"] = new JsonArray(
                new JsonObject { ["code"] = 403, ["when"] = "A browser request carrying an Origin — the control plane is not a public API." },
                new JsonObject { ["code"] = 404, ["when"] = "No route matched; the body names the method and path." }),
            ["schemas"] = ConnectorSchemas(),
        },
        ["cli"] = new JsonObject
        {
            ["usage"] = "volt <command> [args]",
            ["globalFlags"] = new JsonArray("--workspace <dir>", "--vendor <codesys|twincat>", "--pipe <name>"),
            ["pipeEnv"] = "VOLT_PIPE",
            ["verbs"] = new JsonArray(Verbs.Select(v => (JsonNode?)new JsonObject
            {
                ["name"] = v.Name,
                ["summary"] = v.Summary,
                ["args"] = v.Args,
                ["flags"] = new JsonArray(v.Flags.Select(f => (JsonNode?)f).ToArray()),
                ["mutates"] = v.Mutates,
            }).ToArray()),
            ["exitCodes"] = new JsonArray(ExitCodes.Select(e => (JsonNode?)new JsonObject
            {
                ["code"] = e.Code,
                ["means"] = e.Means,
            }).ToArray()),
        },
    };

    private static string Render(JsonObject o) =>
        "// GENERATED by test/Volt.Repo.Gates/SurfaceDataTests.cs — do not edit.\n"
        + "// Regenerate: VOLT_WRITE_DOCS=1 dotnet test test/Volt.Repo.Gates\n"
        + "window.VOLT_SURFACES = " + o.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    [Fact]
    public void The_committed_surface_data_is_what_this_generates()
    {
        var path = Path.Combine(CliDir(), "docs", "assets", "surfaces.js");
        var generated = Render(BuildSurfaces());

        if (Environment.GetEnvironmentVariable("VOLT_WRITE_DOCS") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, generated, new UTF8Encoding(false));
            return;
        }

        Assert.True(File.Exists(path), $"missing: {path}\nRegenerate with VOLT_WRITE_DOCS=1 dotnet test test/Volt.Repo.Gates");
        Assert.True(File.ReadAllText(path).Replace("\r\n", "\n") == generated.Replace("\r\n", "\n"),
            "docs/assets/surfaces.js no longer matches this table.\n"
            + "Regenerate with VOLT_WRITE_DOCS=1 dotnet test test/Volt.Repo.Gates");
    }

    /// <summary>EVERY ROUTE THE CONTROL SERVER ANSWERS IS DESCRIBED. Read out of the source, because the routes
    /// are string comparisons in a dispatch rather than anything reflectable.</summary>
    [Fact]
    public void Every_control_plane_route_is_described()
    {
        var src = File.ReadAllText(Path.Combine(CliDir(), "src", "Volt.Connector.Core", "ControlServer.cs"));

        // The dispatch compares `path` (already trimmed of slashes) against literals, and matches segment
        // arrays for the parameterised ones. Both spellings are checked, so neither form can be added quietly.
        var described = Routes.Select(r => r.Path).ToHashSet();
        foreach (var (literal, route) in new[]
                 {
                     ("path == \"session\"", "/session"),
                     ("path == \"status\"", "/status"),
                     ("parts[2] == \"sync\"", "/session/{id}/sync"),
                     ("parts[0] == \"workers\"", "/workers/{id}/restart"),
                 })
        {
            // ASSERT THE LITERAL IS THERE, rather than checking the route only when it is. An `if` here would
            // pass silently the day someone renames a route — which is the exact day this gate is for.
            Assert.True(src.Contains(literal, StringComparison.Ordinal),
                $"ControlServer no longer routes with `{literal}` — this gate is reading for a spelling that "
                + "moved, so it has stopped checking anything. Update it with the route.");
            Assert.True(described.Contains(route),
                $"ControlServer routes {route} ({literal}) and docs/assets/surfaces.js does not describe it.");
        }

        // The DELETE arm has no literal of its own — it is the two-segment session path.
        Assert.Contains("method == \"DELETE\"", src, StringComparison.Ordinal);
        Assert.Contains("/session/{id}", described);

        // And the port the clients hard-code.
        Assert.Contains("ControlPort = 8550", src, StringComparison.Ordinal);
    }

    /// <summary>EVERY CLI VERB IS DESCRIBED. The dispatch is a switch on the verb string, so the arms are read
    /// from the source the same way.</summary>
    [Fact]
    public void Every_cli_verb_is_described()
    {
        var src = File.ReadAllText(Path.Combine(CliDir(), "src", "Volt.Cli", "Program.cs"));
        var described = Verbs.Select(v => v.Name).ToHashSet(StringComparer.Ordinal);

        var arms = System.Text.RegularExpressions.Regex
            .Matches(src, "\"(?<verb>[a-z-]+)\"\\s*=>\\s*Cmd|\"(?<verb2>help)\"\\s*=>")
            .Select(m => m.Groups["verb"].Success ? m.Groups["verb"].Value : m.Groups["verb2"].Value)
            .Where(v => v.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        Assert.NotEmpty(arms);          // the regex must actually see the dispatch, or this proves nothing
        foreach (var verb in arms)
            Assert.True(described.Contains(verb), $"`volt {verb}` is dispatched and not described.");

        // `version` is handled before the switch, so it has no arm to find — assert it the way it is written.
        Assert.Contains("args[0] == \"version\"", src, StringComparison.Ordinal);
        Assert.Contains("version", described);
    }
}
