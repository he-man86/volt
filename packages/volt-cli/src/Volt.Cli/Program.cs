using System.Diagnostics;
using System.Text.Json;
using Volt.Cli.Sync;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli;

/// <summary>
/// The `volt` CLI entry — Resolves the bridge from the workspace
/// binding, dispatches the verb, renders (pretty or --json), sets the exit code. Talks to the bridge over the
/// NAMED PIPE (Volt.Wire), reusing Volt.Engine's DTOs — one wire contract.
/// </summary>
internal static class Program
{
    // --json keeps nulls (JS JSON.stringify keeps null); the result-level optional fields opt into omit-when-null
    // via [JsonIgnore] on the DTO, matching JS's "undefined is omitted, null is kept".
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static void EmitJson(object x) => Console.Out.Write(JsonSerializer.Serialize(x, Json) + "\n");

    /// <summary>volt.exe's OWN stamped FileVersion — the fact, not a sidecar file's claim. build-cli.ps1 stamps
    /// every binary from VOLT_VERSION, so this is the shipped version and cannot drift from the binary the way a
    /// version.txt beside it could. "(dev)" when run from a build tree that carries no stamp — that is BOTH .NET's
    /// unset default "1.0.0.0" (an unstamped local/dev build — same sentinel Updater.cs treats as dev) and the rare
    /// "0.0.0.0". A real release is always a stamped X.Y.Z.count, so no genuine version collides with these.
    /// A FAILED probe (no ProcessPath, GetVersionInfo throws) reports "(dev)" too — the reading is best-effort and
    /// a version string is never worth failing the command over, so "(dev)" means "not a stamped release, or we
    /// could not read the stamp".</summary>
    private static string ShippedVersion()
    {
        try
        {
            var v = System.Diagnostics.FileVersionInfo.GetVersionInfo(System.Environment.ProcessPath!).FileVersion?.Trim();
            if (!string.IsNullOrEmpty(v) && v != "0.0.0.0" && v != "1.0.0.0") return v!;
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

        // OUTSIDE the try below, which maps bridge failures. A command line this CLI will not guess at is not a
        // bridge problem, and routing it through `Unreachable()` would tell the user to start an IDE.
        Args a;
        try { a = ParseArgs(args); }
        catch (ArgError e) { Console.Error.WriteLine(e.Message); return 1; }

        var root = Path.GetFullPath(a.Workspace);
        // Pipe resolution: an explicit --pipe / VOLT_PIPE wins (dev + tests). Otherwise BOTH vendors are discovered
        // per-instance and matched to the bound project (BridgeResolver — no per-vendor branch). Resolved LAZILY so
        // bridge-free verbs (merge/help) never probe — and so a resolution refusal surfaces in the catch.
        var pipeOverride = a.Value("--pipe") ?? Environment.GetEnvironmentVariable("VOLT_PIPE");
        var vendor = a.Vendor ?? Config.ConfiguredVendor(root) ?? Vendors.Codesys;
        BridgeClient Bridge() => BridgeResolver.Resolve(root, vendor, pipeOverride, isInit: a.Verb == "init");
        try
        {
            return a.Verb switch
            {
                "init" => CmdInit(Bridge(), a),
                "rebind" => CmdRebind(root, vendor, a),
                "pull" => CmdPull(root, Bridge(), a),
                "push" => CmdPush(root, Bridge(), a),
                "status" => CmdStatus(root, Bridge(), a),
                "build" => CmdBuild(root, Bridge(), a),
                "show" => CmdShow(root, Bridge(), a),
                "merge" => CmdMerge(root, a),
                "open" => CmdOpen(a),
                "console" => CmdConsole(a),
                // No "--help" arm: ParseArgs routes every `--`-prefixed token into Flags/Values and never into
                // positional, so a.Verb can never BE "--help". `volt --help` lands on the `_` arm with Verb null ⇒ 0.
                "help" => Emit(Usage, 0),
                _ => Emit(Usage, a.Verb is null ? 0 : 1),
            };
        }
        // ONLY the transport's own verdict, raised by `BridgeClient.Call`. These used to be `catch (IOException)`
        // and `catch (TimeoutException)` around the WHOLE dispatch, which also swallowed every local disk and git
        // failure into "is the IDE bridge running?" — see BridgeClient.Call.
        catch (BridgeError e) when (e.Code == BridgeError.UnreachableCode) { return Unreachable(); }
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
        if (a.Has("--json")) { EmitJson(r); return r.Kind == ResultKinds.Ok ? 0 : 1; }
        if (r.Kind == ResultKinds.Error) { Console.Error.WriteLine(r.Reason); return 1; }
        Console.WriteLine($"created workspace at {r.Workspace}");
        Console.WriteLine($"bound to {r.Project}");
        if (r.GitCreated) Console.WriteLine("initialized a git repo for version control");
        if (r.Scaffold > 0) Console.WriteLine($"scaffolded {r.Scaffold} project file(s)");
        if (r.Corpus > 0) Console.WriteLine($"installed {r.Corpus} language-reference file(s)");
        Console.WriteLine(r.Note ?? $"pulled {r.Pulled} file(s) — workspace ready");
        return 0;
    }

    // volt rebind — re-point an existing workspace's binding (config only, no bridge, no content change).
    private static int CmdRebind(string root, string vendor, Args a)
    {
        var err = Commands.Rebind(root, vendor, a.Value("--project-name") ?? "");
        if (err != null) { Console.Error.WriteLine(err); return 1; }
        Console.WriteLine("rebound");
        return 0;
    }

    private static int CmdPull(string root, BridgeClient bridge, Args a)
    {
        var r = Commands.Pull(root, bridge, a.Has("--dry-run"), Reporter.Create(), a.Has("--force"));
        if (a.Has("--json")) { EmitJson(r); return r.Kind == ResultKinds.Ok ? 0 : 2; }
        if (r.Kind == ResultKinds.Refused) { Console.Error.WriteLine(r.Reason); return 1; }
        if (r.Kind == ResultKinds.Conflict)
        {
            Console.WriteLine($"CONFLICT in {r.Paths!.Count} file(s) — resolve the markers, then `volt merge --continue` (or `volt merge --abort`):");
            foreach (var p in r.Paths!) Console.WriteLine($"  ! {p}");
            return 2;
        }
        Console.WriteLine(r.Message ?? $"pulled {r.Synced!.Count} file(s)");
        if (r.Status is not null) WarnIfPartial(r.Status);
        return 0;
    }

    private static int CmdPush(string root, BridgeClient bridge, Args a)
    {
        var r = Commands.Push(root, bridge, a.Has("--force"), a.Value("--force-with-lease"), a.Has("--dry-run"), Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Kind == ResultKinds.Ok ? 0 : 2; }
        if (r.Kind == ResultKinds.Rejected) { Console.Error.WriteLine(r.Reason); return 1; }
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
            // PORCELAIN GETS THE CAVEAT TOO — and needs it most. A partial walk emits no `iD` lines at all, so a
            // tool scripting this sees a clean, complete-looking view of a project nothing told it was short.
            // It goes to stderr, so the lines a caller parses on stdout are unchanged.
            WarnIfPartial(s);
            return 0;
        }
        if (a.Has("--json"))
        {
            // Online/Detail/Recommend are the pretty-output-only extras and are [JsonIgnore]'d, so the type
            // serializes to exactly the --json contract — incomingStale INCLUDED (volt-control reads it).
            EmitJson(s);
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
        WarnIfPartial(s);
        if (s.Recommend is not null) Console.WriteLine($"next: {s.Recommend}");
        return 0;
    }

    /// <summary>The two ways the IDE view can be SHORT, printed wherever a status is printed.
    ///
    /// <para>Both were on the wire and no client had ever shown either. An unreadable item has no file and no
    /// version, so it is simply ABSENT from everything else here — indistinguishable from one that was never in
    /// the project. That is not hypothetical: one box whose `En` pin read as a boolean made a body unreadable
    /// and the whole POU vanished from git, silently (DIALECT C7). An unenumerable folder is worse, because its
    /// items are absent AND absence is how a deletion is derived.</para>
    ///
    /// <para>Written to stderr: it is a caveat on a successful command, and a caller piping `volt status` is
    /// reading the item lines, not this.</para></summary>
    private static void WarnIfPartial(StatusData s)
    {
        if (s.Unreadable.Count > 0)
        {
            Console.Error.WriteLine($"warning: the IDE holds {s.Unreadable.Count} item(s) volt could not read — they have NO file here:");
            foreach (var n in s.Unreadable) Console.Error.WriteLine($"  ? {n}");
        }
        if (s.UnwalkedFolders.Count > 0)
        {
            Console.Error.WriteLine($"warning: {s.UnwalkedFolders.Count} folder(s) could not be read, so this view is PARTIAL and reports no deletions:");
            foreach (var f in s.UnwalkedFolders) Console.Error.WriteLine($"  ? {f}/");
        }
    }


    private static int CmdBuild(string root, BridgeClient bridge, Args a)
    {
        var pending = Commands.UnpushedCount(root);
        if (pending > 0 && !a.Has("--json"))
            Console.WriteLine($"note: {pending} local change(s) not pushed — this build reflects the IDE, not your workspace. Run `volt push` first.");
        var r = Commands.Build(root, bridge, Reporter.Create());
        if (a.Has("--json")) { EmitJson(r); return r.Kind == ResultKinds.Refused ? 1 : r.Success ? 0 : 2; }
        // A REFUSAL EXITS 1 WITH THE REASON ON STDERR, exactly as `pull` and `push` answer the same two
        // preconditions. It used to print `Build FAILED (0ms)` over a fabricated compiler diagnostic and exit 2,
        // so "the wrong project is open" was indistinguishable from "your code does not compile".
        if (r.Kind == ResultKinds.Refused) { Console.Error.WriteLine(r.Reason); return 1; }
        Console.WriteLine($"Build {(r.Success ? "succeeded" : "FAILED")} ({r.Duration}ms)");
        // NAME FIRST, the way a compiler prints: the item is the only thing that makes a line number usable, and
        // `volt build` printed neither it nor the vendor's code -- the engineer got prose and a bare line number
        // that could have belonged to any file in the project.
        foreach (var d in r.Diagnostics)
            Console.WriteLine($"  [{d.Severity}] {Where(d)}{(d.Code is { Length: > 0 } c ? c + ": " : "")}{d.Message}");
        return r.Success ? 0 : 2;
    }

    /// <summary>`FB_Motor.fb:12:4 ` — the location prefix, empty when the diagnostic names neither.
    ///
    /// <para>The position rides on the NAME and never appears without it. A project-level diagnostic can carry a
    /// line with no item (TwinCAT emits both), and printing that alone gave `[error] :12 message` — a
    /// colon-prefixed number that reads as a truncated path. Column only alongside a line, because a column
    /// without one points nowhere.</para></summary>
    private static string Where(Volt.Contracts.BridgeDiagnostic d)
    {
        if (d.Name is not { Length: > 0 } name) return "";
        var at = d.Line > 0 ? $"{name}:{d.Line}" + (d.Column > 0 ? $":{d.Column}" : "") : name;
        return at + " ";
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

    /// <summary>`volt open [<dir>]` — launch the desktop app on this workspace.
    ///
    /// <para>NO BRIDGE. `Bridge()` is resolved lazily, so a bridge-free arm never probes a pipe — which is right
    /// here: the app finds the connector itself, and requiring an IDE to be running before you can open a window
    /// would be a precondition nobody would guess.</para>
    ///
    /// <para>It is a convenience for someone already in a terminal, not the way the app is meant to be reached —
    /// that is the Start Menu, like any other Windows app.</para></summary>
    private static int CmdOpen(Args a)
    {
        var dir = Path.GetFullPath(a.Operand(0) ?? a.Workspace);   // same shape as CmdInit
        if (!Directory.Exists(dir))
        {
            Console.Error.WriteLine($"no such directory: {dir}");
            return 1;
        }

        var gui = DesktopApp.GuiExePath(AppContext.BaseDirectory);
        if (!File.Exists(gui))
        {
            // No fallback to the source tree. A build tree has no `desktop\` sibling, and guessing one would run
            // a different build than the one this volt.exe shipped with. Name the fix instead.
            Console.Error.WriteLine(
                $"no Volt desktop app at {gui} — this volt.exe has no desktop folder beside it, so it is a build tree or "
                + "a partial install. Install Volt with Volt-win-Setup.exe, then retry.");
            return 1;
        }

        using var p = Process.Start(DesktopApp.LaunchInfo(gui, dir));   // never waited on — the GUI outlives this shell
        Console.WriteLine($"opening Volt on {dir}");
        return 0;
    }

    /// <summary>Serve the interface console — the documentation for all three surfaces, and a client that can
    /// actually call them.
    ///
    /// <para>The three are reached three different ways (a named pipe, an HTTP control plane that refuses
    /// browsers, and argv), so no page can exercise them on its own and a description of them cannot be
    /// checked by the person reading it. This process can reach all three, so it stands behind the page.</para>
    ///
    /// <para><b>Read-only by default.</b> Two of the surfaces write to a live PLC; `--allow-write` is the
    /// deliberate act that unlocks `push`, the mutating verbs and every non-GET control-plane route.</para></summary>
    private static int CmdConsole(Args a)
    {
        // NO SILENT DEFAULT FOR A VALUE THE OPERATOR TYPED. An unparseable or out-of-range `--port` used to
        // fall back to 8551, so the console served somewhere other than where the operator believed — on a
        // port they may have been deliberately avoiding. Absent means "the default"; wrong means wrong.
        var requested = a.Value("--port");
        int port;
        if (requested is null || requested.Length == 0) port = DefaultConsolePort;
        else if (!int.TryParse(requested, out port) || port < 1 || port > 65535)
        {
            Console.Error.WriteLine($"--port '{requested}' is not a port number (1-65535)");
            return 1;
        }
        var allowWrite = a.Has("--allow-write");

        using var server = new Volt.Cli.Interface.ConsoleServer(
            port, allowWrite, a.Value("--pipe") ?? Environment.GetEnvironmentVariable("VOLT_PIPE"));
        try { server.Start(); }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"could not serve on 127.0.0.1:{port} — {ex.Message}");
            return 1;
        }

        Console.WriteLine($"Volt interface console  {server.Url}");
        Console.WriteLine(allowWrite
            ? "  WRITES ENABLED — push, the mutating verbs and control-plane writes will really run"
            : "  read-only (start with --allow-write to enable push and the mutating verbs)");
        Console.WriteLine("  Ctrl+C to stop");

        if (!a.Has("--no-open"))
            try { Process.Start(new ProcessStartInfo(server.Url) { UseShellExecute = true }); }
            catch { /* a browser is a convenience; the URL is printed above either way */ }

        // Park until interrupted. The server answers on its own threads; this one only waits, so Ctrl+C is a
        // clean stop rather than a killed listener.
        using var stop = new System.Threading.ManualResetEventSlim(false);
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
        stop.Wait();
        Console.WriteLine("console stopped");
        return 0;
    }

    private static int CmdMerge(string root, Args a)
    {
        var (code, message) = Commands.Merge(root, a.Has("--continue"), a.Has("--abort"), a.Value("--resolve"), a.Has("--use-ours"), a.Has("--use-theirs"));
        if (code == 0) Console.WriteLine(message); else Console.Error.WriteLine(message);
        return code;
    }

    // ── arg parsing ──────────────────────────────────

    /// <summary>The flags that take a SEPARATE value token (`--flag <v>`), or an attached one (`--flag=<v>`).
    ///
    /// The set has to agree with the readers in BOTH directions, and it only ever checked one. "Every entry here has
    /// a reader" was enforced by hand — "--limit" and "--timeout" sat here with no consumer, so a `--limit 5` was
    /// silently eaten. The INVERSE was never checked, and it shipped broken: `--project-name` had a reader
    /// (CmdRebind) and no entry, so the value token became a stray operand, `Value` answered null, and EVERY rebind
    /// from the desktop's reconnect list died on "rebind needs --project-name". `--pipe` was one keystroke from the
    /// same fate — it survives only because the one caller happens to send `--pipe=<v>`.
    ///
    /// So the direction that was missing is now MECHANICAL, in `Args.Value` below: reading a flag that is not in
    /// this set throws. It cannot be forgotten, and it cannot reach a user as a silent wrong answer.</summary>
    private static readonly HashSet<string> ValueFlags =
        new() { "--workspace", "--vendor", "--resolve", "--force-with-lease", "--project-name", "--pipe", "--port" };

    /// <summary>Every BOOLEAN flag the CLI reads. Its only job is to make an unknown one an ERROR.
    ///
    /// <para>`ParseArgs` used to end with `else a.Flags.Add(s)`, so any `--`-token it did not recognise was
    /// accepted, stored, and never read again — and every boolean flag here fails toward the DANGEROUS side when
    /// that happens. `volt push --dryrun` is not a preview: `Has("--dry-run")` is false, so it writes every
    /// changed item into the live PLC and prints `pushed N item(s)`, exit 0. The user believes they previewed a
    /// push and performed one, which is the single thing `--dry-run` exists to prevent.</para>
    ///
    /// <para>The repo had already paid for this twice and patched downstream both times — volt-control passing
    /// `--force` to `pull` (Commands.cs, "the CLI silently ignored the unknown flag and the user got a plain
    /// pull") and `volt init --dry-run` walking past the console's read-only gate. Both fixes left the line that
    /// creates the state untouched, so it kept creating it for every flag not yet burned.</para>
    ///
    /// <para>This is deliberately NOT per-verb. A global set closes the dangerous class — a flag that does not
    /// exist — with one list that cannot drift from its readers (`FlagsHaveReaders` in the CLI tests walks the
    /// source and checks both directions). Rejecting a REAL flag on a verb that ignores it is a different and
    /// much weaker defect, and it would need a per-verb table this parser has no honest source for.</para></summary>
    private static readonly HashSet<string> BoolFlags = new()
    {
        "--abort", "--allow-write", "--continue", "--dry-run", "--force", "--json",
        "--local", "--no-open", "--porcelain", "--use-ours", "--use-theirs",
    };

    /// <summary>A command line this CLI will not guess at. Carries only a message; `Main` prints it and exits 1.</summary>
    private sealed class ArgError : Exception
    {
        public ArgError(string message) : base(message) { }
    }

    private sealed class Args
    {
        public string? Verb;
        public List<string> Operands = new();
        public HashSet<string> Flags = new();
        public Dictionary<string, string> Values = new();
        public string Workspace = "";
        public string? Vendor;
        public bool Has(string f) => Flags.Contains(f);
        /// <summary>The value of a flag that TAKES one. Reading a flag absent from <see cref="ValueFlags"/> is a
        /// bug in this file, not bad user input — the argument is always a literal from our own source — so it
        /// throws rather than answering null. A null here is indistinguishable from "the user did not pass it",
        /// which is exactly how the broken `--project-name` rebind stayed invisible.</summary>
        public string? Value(string f)
        {
            if (!ValueFlags.Contains(f))
                throw new InvalidOperationException(
                    $"'{f}' is read as a value flag but is not in ValueFlags — `{f} <value>` would be parsed as a " +
                    "stray operand. Add it to the set.");
            return Values.TryGetValue(f, out var v) ? v : null;
        }
        public string? Operand(int i) => i < Operands.Count ? Operands[i] : null;
    }

    /// <summary>Which verb a command line names — asked of the real parser, never re-derived.
    ///
    /// <para>The console gates mutating verbs on this, and `argv[0]` is not the answer: every `--`-prefixed
    /// token goes to flags first, so `volt --json push` is a PUSH whose first argument is `--json`. A second
    /// implementation of "which word is the verb" is how a gate silently stops covering half its cases.</para></summary>
    /// <para>Null when the line does not parse at all. The console asks this of ARGV IT WAS GIVEN over HTTP, so
    /// a throw here would be a 500 on input a user typed; a null lands on the same "unknown verb" refusal as any
    /// other word it does not recognise, which is the safe answer for a gate.</para>
    internal static string? VerbOf(IReadOnlyList<string> argv)
    {
        try { return ParseArgs(argv.ToArray()).Verb; }
        catch (ArgError) { return null; }
    }

    /// <summary>Did this command line pass <paramref name="flag"/> — asked of the real parser, never re-derived.
    ///
    /// <para>The console's read-only gate answered this with `args.Contains("--dry-run")`, six lines after
    /// asking `VerbOf` for the verb and commenting that a second implementation is exactly how such a gate
    /// silently stops covering its cases. `ParseArgs` consumes the token after a value flag AS that flag's
    /// value, so `--project-name --dry-run` puts `--dry-run` in `args` as an element while `Has` is false — the
    /// token is present, the flag was never passed, and a raw `Contains` opened the door. False on a line that
    /// does not parse: an unparseable request gets the refusal, not the exemption.</para></summary>
    internal static bool HasFlag(IReadOnlyList<string> argv, string flag)
    {
        try { return ParseArgs(argv.ToArray()).Has(flag); }
        catch (ArgError) { return false; }
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
                var name = eq >= 0 ? s[..eq] : s;

                if (!ValueFlags.Contains(name) && !BoolFlags.Contains(name))
                    throw new ArgError($"unknown flag '{name}'. Run `volt help` for the flags each verb takes.");

                if (eq >= 0)
                {
                    // `--dry-run=true` USED TO MEAN `--dry-run=true` AND NOTHING ELSE. The `=` arm ran first and
                    // unconditionally, so an attached value on a BOOLEAN flag landed in `Values` and `Has(...)`
                    // stayed false — `volt push --dry-run=true` walked past the dry-run return and wrote every
                    // changed item into the live PLC. Same shape disarmed `--force=true` and `--json=1`. There is
                    // no reading of `=false` that is safe to guess at either, so this refuses rather than picks.
                    if (!ValueFlags.Contains(name))
                        throw new ArgError($"'{name}' does not take a value — write `{name}` on its own.");
                    a.Values[name] = s[(eq + 1)..];
                }
                else if (ValueFlags.Contains(name))
                {
                    // A VALUE FLAG AT THE END OF THE LINE IS A TYPO, not an empty string. This answered `""`, and
                    // every reader invented its own wrong behaviour from it: `volt merge --resolve "$F" --use-theirs`
                    // with `$F` unset built the pathspec `src/` and `git checkout --theirs -- src/` resolved EVERY
                    // conflicted file in the workspace to the IDE's side, printing `resolved  using theirs`, exit 0.
                    // It also walked straight past CmdConsole's own "NO SILENT DEFAULT FOR A VALUE THE OPERATOR
                    // TYPED" check, which can only see a value it was given.
                    //
                    // AND A FLAG IS NEVER A VALUE. Taking the next token unconditionally meant
                    // `volt merge --resolve --use-theirs` resolved a file literally named `--use-theirs`, and
                    // `--resolve` followed by anything the harness appends quietly ate that instead. No flag this
                    // CLI has is a legal value for another, so the next token starting with `--` is always the
                    // missing-value case wearing a disguise.
                    if (i + 1 >= argv.Length || argv[i + 1].StartsWith("--", StringComparison.Ordinal))
                        throw new ArgError($"'{name}' needs a value — `{name} <value>`.");
                    a.Values[name] = argv[++i];
                }
                else a.Flags.Add(name);
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

    /// <summary>The console's port when none is given. Not 8550 — that is the connector's, and the console
    /// talks TO it.</summary>
    private const int DefaultConsolePort = 8551;

    private static int Emit(string text, int code) { Console.WriteLine(text); return code; }

    private const string Usage =
        "volt <command> [args] — git-native Volt CLI (C#, over named pipe)\n\n" +
        "  init     bind to the bridge, git-init the project, first pull            [--json]\n" +
        "  rebind   re-point a workspace to a different/renamed project (config only)   --project-name <name>\n" +
        "  pull     fetch the IDE → git merge into your branch       [--force] [--dry-run] [--json]\n" +
        "  push     workspace → IDE → fast-forward volt/ide          [--force] [--dry-run] [--force-with-lease=<v>] [--json]\n" +
        "  status   incoming / outgoing / merge state                [--json] [--porcelain] [--local]\n" +
        "  build    build via the IDE; returns diagnostics                    [--json]\n" +
        "           (IDE-sync history is native git: `git log volt/ide`)\n" +
        "  show     a file at a ref:  <ref> <path>   (HEAD / VOLTIDE / MERGE_OURS|THEIRS|BASE / BRIDGE / WORKSPACE)\n" +
        "  merge    finish a conflicted pull:  --continue | --abort | --resolve <path> [--use-ours|--use-theirs]\n" +
        "  open     open the Volt desktop app on this workspace              [<dir>]\n" +
        "  console  serve the interface console: every bridge op, control-plane route and CLI verb,\n" +
        "           described AND callable        [--port <n>] [--allow-write] [--no-open]\n" +
        "  version  this binary's own stamped version   (also: --version, -v)\n\n" +
        "  flags: --workspace <dir>  --vendor <codesys|twincat>";
}
