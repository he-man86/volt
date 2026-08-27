using System.Text;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Sync;

/// <summary>The `volt` verbs — orchestration over BridgeClient + git + the sync model.</summary>
public static class Commands
{
    /// <summary>An op's in-op precondition failure (the bridge guarding "connected + right project") — mapped by
    /// each command to its own clean refusal result instead of a thrown error. Uses the code the wire now carries.
    /// <para>It takes the bare CODE, not an exception type, because the SAME refusal reaches a command on two
    /// carriers: <see cref="PipeCallException"/> (the bridge refused the op) and <see cref="BridgeError"/> (the
    /// client's own <c>GuardEmptyItems</c> refusing an empty walk it could not confirm). Both are caught beside each
    /// other below, so one code space produces one outcome. <see cref="BridgeResolver.AmbiguousBridge"/> is
    /// deliberately NOT a member: a resolver refusal is thrown while <c>Bridge()</c> is evaluated as an ARGUMENT in
    /// Program's dispatch switch, so it can never reach a catch inside a command — the two-open-IDEs case stays a
    /// stderr error, and listing the code here would be a test that cannot fire.</para></summary>
    private static bool IsPreconditionRefusal(string code) =>
        code == BridgeErrorCodes.WrongProject || code == BridgeErrorCodes.PlcDisconnected;

    /// <summary>volt init — bind to the bridge, git-init the project, scaffold the workspace (README + VS Code
    /// settings), do the first (init) fetch and seed <c>src/</c>. NOTE: the ST language-reference corpus is not
    /// yet bundled with volt-cli — the workspace is fully functional without it; corpus stays 0 until then.</summary>
    public static InitResult Init(string parent, BridgeClient bridge, Action<ProgressFrame>? onProgress = null)
    {
        // The cheap friendly pre-check, and NOTHING else: "is this bridge SERVING a project", answered instantly so
        // the common mistake doesn't cost a full project walk. `HealthResponse.ProjectName` is the SERVING row only,
        // so a bridge with the project OPEN but not yet selected (a per-XAE TwinCAT worker before the connector
        // binds it) is refused here too. It deliberately does
        // NOT decide identity — health is served from a per-vendor THROTTLED snapshot (~5s on TwinCAT), while every
        // op after init validates against LIVE state, so binding from it named the workspace after whatever was open
        // 5s ago and every later pull then refused WRONG_PROJECT forever. Identity comes from the fetch's echo
        // below. One question, one answer.
        if (string.IsNullOrEmpty(bridge.GetHealth().ProjectName))
            return InitResult.Error("the bridge has no PLC project loaded — open a project in the IDE before `volt init`");

        // Seed the workspace with the IDE's files — init seeds the whole IDE (no prior volt/ide tree). Each long
        // pole gets its own phase so the bar/label never freezes on a silent git step: fetch → import objects (one
        // fast-import stream: blobs + tree) → write files → finalize (git index). (Materialize is negligible — a
        // fast in-memory transform — so it gets no phase of its own.)
        //
        // The fetch runs FIRST, before anything touches the disk, because the project it echoes is what names the
        // folder, the README, the init commit AND the binding — one identity, one source. Two costs, stated rather
        // than hidden: the "already exists and isn't empty" refusal below now lands AFTER the (possibly slow) walk
        // instead of instantly, and on a bridge whose live name differs from its cached one the created folder and
        // commit message change. The alternative — folder from the cache, binding rewritten afterwards — leaves a
        // workspace whose folder and README name a different project than its binding, which is the worse half.
        var progress = new PhaseProgress(onProgress, Ops.Init, 4);
        progress.Enter(0, "Fetching from IDE"); // label up front — Init's fetch stays silent through its precompile+walk
        var fetched = bridge.Init(progress.Wrap(0, "Fetching from IDE"));
        // The echo is the LIVE identity OpGuard checked, atomic with the walk it describes. It is nullable so an
        // older bridge can omit it — refuse loud rather than bind the workspace to an empty vendor/name for life.
        if (string.IsNullOrEmpty(fetched.Platform) || string.IsNullOrEmpty(fetched.ProjectName))
            return InitResult.Error("the bridge didn't report which project it walked — refusing to bind this workspace to an unidentified project (update the IDE-side Volt bridge)");
        var platform = fetched.Platform!;
        var projectName = fetched.ProjectName!;

        // git-clone semantics: create <parent>/<project name>/ as the workspace. The user picks WHERE (a parent
        // location) and Volt makes the named folder — so nobody hand-makes an empty "New folder" (a typical agent UI
        // can't create one either) and the workspace is self-describing.
        var folder = SafeFolderName(projectName);
        var root = System.IO.Path.Combine(System.IO.Path.GetFullPath(parent), folder);
        if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any())
            return InitResult.Error($"“{folder}” already exists here and isn't empty — choose a different location, or open that folder to sync it");
        Directory.CreateDirectory(root);

        // init ALWAYS creates the repo: the guard above refuses any root that exists and holds ANY entry, and `.git`
        // is such an entry — so the folder reached here is new or empty and can never already be a repo.
        Git.GitInit(root);
        Files.EnsureGitattributes(root);

        Config.SaveConfig(root, new WorkspaceConfig
        {
            Bridge = new() { Vendor = platform },
            Project = new() { Platform = platform, ProjectName = projectName },
            LinkedAt = DateTime.UtcNow.ToString("o"),
        });

        var scaffold = Scaffold.WriteWorkspaceScaffold(root, projectName);
        const int corpus = 0; // TODO: bundle + install the ST reference corpus (currently a TS/@volt/lsp-iec dep)
        var project = $"{platform}/{projectName}";

        Git.CommitAll(root, $"volt init: {projectName}");

        var ideFiles = fetched.Changed.SelectMany(Materialize.MaterializeItem).ToList();
        var gitDir = Git.ResolveGitDir(root);
        var head = Git.HeadCommit(root);

        // init: there is no previous volt/ide tree to carry anything forward from, so the flag is moot.
        var tree = IdeTree.BuildVoltIdeTree(gitDir, head, null, ideFiles, new List<string>(), fetched.LibrariesRefreshed,
            (done, total) => progress.Report(1, "Importing objects", done, total));
        var commit = IdeTree.CommitVoltIde(gitDir, tree, head, $"volt: IDE @ {fetched.ProjectVersion}");
        Git.UpdateRef(gitDir, IdeTree.Range, commit);
        Files.WriteSrcFiles(root, ideFiles.Select(f => new SrcFile(f.Path, f.Content)).ToList(),
            (done, total) => progress.Report(2, "Writing files", done, total));
        progress.Enter(3, "Finalizing");
        Git.ReadTreeToIndex(root, commit);
        Git.UpdateRef(gitDir, $"refs/heads/{Git.CurrentBranch(root) ?? "main"}", commit);

        Sidecar.SaveIdeRefs(root, new IdeRefs { ProjectVersion = fetched.ProjectVersion, Items = fetched.Items, Folders = fetched.Folders });
        return InitResult.Ok(project, root, gitCreated: true, ideFiles.Count, scaffold.Created.Count, corpus);
    }

    /// <summary>volt rebind — re-point an EXISTING workspace's binding to a different/renamed project. Rewrites
    /// only <c>.git/volt/config.json</c> (vendor + project name); the folder, <c>src/</c> and git history are all
    /// untouched. The bridge is reselected by the caller (connector); the user runs <c>volt pull</c> afterward to
    /// bring in the newly-bound project's code through the normal safe merge.</summary>
    public static string? Rebind(string root, string vendor, string projectName)
    {
        if (string.IsNullOrEmpty(projectName)) return "rebind needs --project-name";
        if (!Config.ConfigExists(root)) return "not a Volt workspace — run `volt init` first";
        var cfg = Config.LoadConfig(root);
        cfg.Bridge.Vendor = vendor;
        cfg.Project.Platform = vendor;
        cfg.Project.ProjectName = projectName;
        Config.SaveConfig(root, cfg);
        return null;
    }

    /// <summary>An IDE project name → a safe folder name (illegal chars stripped, whitespace collapsed, no
    /// leading/trailing dot, Windows reserved device names escaped). IEC names are normally clean; belt-and-braces.</summary>
    private static string SafeFolderName(string name)
    {
        var s = System.Text.RegularExpressions.Regex.Replace(name, @"[<>:""/\\|?*\x00-\x1f]+", "_");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim().Trim('.', ' ');
        if (s.Length == 0) return "volt-workspace";
        // Reserved device names (CON, NUL, COM1…) can't be a folder on Windows even with an extension — escape them.
        if (System.Text.RegularExpressions.Regex.IsMatch(s, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            s = "_" + s;
        return s;
    }

    /// <summary>volt status — fetch the live bridge snapshot (health + refs) and render it through the shared
    /// status model.</summary>
    /// <param name="localOnly">Skip the IDE walk. `refs` enumerates the ENTIRE project on the IDE's single
    /// STA thread — seconds of frozen CODESYS on a big project — and it is needed for exactly one thing: the
    /// INCOMING set. Outgoing and merge state are pure git (see StatusModel), so a refresh triggered by a LOCAL
    /// edit has no reason to touch the IDE at all. The cheap health call still runs, so online/mismatch stay
    /// accurate; only Incoming is left uncomputed, and <see cref="StatusData.IncomingStale"/> says so, so a client
    /// keeps showing the last known incoming instead of rendering "nothing incoming" (which would be a lie).</param>
    public static StatusData Status(string root, BridgeClient bridge, bool localOnly = false)
    {
        var cfg = Config.ConfigExists(root) ? Config.LoadConfig(root) : null;
        var snap = new BridgeSnapshot { Online = false, Detail = "offline" };
        try
        {
            var health = bridge.GetHealth();
            var online = health.Connected;
            var mismatch = cfg is not null ? Config.ProjectMismatch(cfg, health) : null;
            var detail = online ? $"{health.Platform}/{health.ProjectName ?? "?"}" : (health.Status ?? "offline");
            if (!(online && mismatch is null && !localOnly))
                snap = new BridgeSnapshot { Online = online, Detail = detail, ProjectMismatch = mismatch };
            else if (cfg is null)
                snap = BuildSnap(online, detail, null, bridge.GetRefs()); // no binding → no identity to guard against
            else
            {
                // The walk CARRIES the binding, so the bridge decides identity against its LIVE served project
                // (OpGuard, in-op) instead of this command deciding it from `health` — a per-vendor THROTTLED
                // snapshot (~5s on TwinCAT) that, right after a rebind/reopen, still names the OLD project. Inside
                // that window status walked the OTHER project and rendered every tracked file as incoming-removed
                // and every foreign file as incoming-added — a full-project phantom diff, in the same second
                // `volt pull` refused WRONG_PROJECT. The pre-op `Config.ProjectMismatch` above stays: it is what
                // reports a mismatch the snapshot CAN see (and the only source of the structured pair below).
                var bound = new ProjectId(cfg.Project.Platform, cfg.Project.ProjectName);
                try
                {
                    snap = BuildSnap(online, detail, null, bridge.GetRefs(
                        new RefsRequest { ExpectedPlatform = bound.Platform, ExpectedProjectName = bound.ProjectName }));
                }
                catch (PipeCallException e) when (e.Code == BridgeErrorCodes.WrongProject)
                {
                    // Refused live — the same verdict `volt pull` gives, rendered through the SAME structured
                    // mismatch path (so `status --json` keeps its projectMismatch and Online stays true) instead of
                    // degrading into a generic error. DiffFields is empty ON PURPOSE: we only reach here when the
                    // health snapshot's fields all AGREED with the binding, so the snapshot has no disagreement to
                    // list — the refusal is the evidence, and its message names the live pair. Carrying that pair
                    // structurally would need identity on the error frame, which the wire does not have yet.
                    snap = new BridgeSnapshot
                    {
                        Online = online,
                        Detail = detail,
                        ProjectMismatch = new ProjectMismatch(
                            bound, new ProjectId(health.Platform, health.ProjectName ?? ""), Array.Empty<string>()),
                    };
                }
            }
        }
        catch (Exception ex)
        {
            snap = new BridgeSnapshot { Online = false, Detail = ex.Message };
        }
        var data = StatusModel.BuildStatusData(root, snap);
        // Only a real `refs` can tell us what the IDE has. Say when we didn't ask, so nobody reads the empty
        // Incoming as "the IDE has no changes for you".
        data.IncomingStale = localOnly && snap.Online && snap.ProjectMismatch is null;
        return data;
    }

    /// <summary>volt pull — fetch the IDE, commit it onto refs/remotes/volt/ide, then git-merge into the branch.
    /// On conflict the sidecar is intentionally NOT advanced.</summary>
    /// <param name="force">Discard uncommitted <c>src/</c> edits and take the IDE's state. Both frontends have
    /// offered a "Force Pull" button with a "this cannot be undone" confirm since before this parameter existed —
    /// volt-control passed <c>--force</c>, the CLI silently ignored the unknown flag, and the user got a plain
    /// pull. A destructive-looking button that does nothing is worse than no button, which is why this is wired
    /// rather than removed. Scoped to <c>src/</c>: everything else in the workspace is the engineer's.</param>
    public static PullResult Pull(string root, BridgeClient bridge, bool dryRun = false, Action<ProgressFrame>? onProgress = null, bool force = false)
    {
        if (!Config.ConfigExists(root)) return PullResult.Refused("not a Volt workspace — run `volt init` first");
        var gitDir = Git.ResolveGitDir(root);
        Files.EnsureGitattributes(root);

        if (Git.IsMerging(root))
            return PullResult.Refused("a merge is already in progress — finish it with `volt merge --continue` or `volt merge --abort` first");

        var cfg = Config.LoadConfig(root);
        var sidecar = Sidecar.LoadIdeRefs(root);

        // ONE path for dry-run and real pull. Always `fetch` (incremental), compute incoming, then the up-to-date
        // short-circuit; dry-run returns the preview, the real pull falls through to the merge. The fetch carries
        // the bound project so the bridge guards it in-op (no pre-op health round-trip), and runs as the first of
        // three streamed phases (fetch → import objects → merge; materialize is folded, the merge is indeterminate).
        var progress = new PhaseProgress(onProgress, "pull", 3);
        FetchResponse fetched;
        try
        {
            // Show the phase the instant the CLI reaches it — the bridge's own frames don't arrive until AFTER its
            // silent precompile+walk, so without this the bar dead-spins on the bare title for seconds.
            progress.Enter(0, "Fetching from IDE");
            fetched = bridge.FetchChanges(new FetchRequest
            {
                KnownItems = sidecar?.Items ?? new Dictionary<string, string>(),
                ExpectedPlatform = cfg.Project.Platform,
                ExpectedProjectName = cfg.Project.ProjectName,
            }, progress.Wrap(0, "Fetching from IDE"));
        }
        catch (PipeCallException e) when (IsPreconditionRefusal(e.Code)) { return PullResult.Refused(e.Message); }
        catch (BridgeError e) when (IsPreconditionRefusal(e.Code)) { return PullResult.Refused(e.Message); }

        // Confirm we fetched the bound project BEFORE merging. The bridge enforced the guard server-side and echoes
        // what it walked (confirm it — cheap; Platform is always stamped, so no version-skew fallback is possible).
        var bindErr = Config.VerifyFetchedIdentity(cfg, fetched.Platform, fetched.ProjectName);
        if (bindErr is not null) return PullResult.Refused(bindErr);

        var incoming = StatusModel.ComputeIncoming(fetched.Items, sidecar?.Items ?? new Dictionary<string, string>());
        var synced = incoming.Added.Concat(incoming.Modified).Concat(incoming.Removed).OrderBy(x => x, StringComparer.Ordinal).ToList();

        StatusData PostStatus() => StatusModel.BuildStatusData(root, new BridgeSnapshot
        {
            Online = true,
            Detail = $"{cfg.Project.Platform}/{cfg.Project.ProjectName}",
            ProjectMismatch = null,
            Items = fetched.Items,
            Folders = fetched.Folders,
            ProjectVersion = fetched.ProjectVersion,
        });

        if (dryRun)
            return PullResult.Ok(synced, PostStatus(), synced.Count == 0
                ? "dry run — already up to date with the IDE"
                : "dry run — these IDE items would be merged in");

        // --force discards local work, so it must run even when there is nothing INCOMING: "up to date with the
        // IDE" is exactly the state a user is in when they edit locally and then want their edit thrown away.
        // Short-circuiting first (as the non-force path does) is what made Force Pull look broken.
        if (force)
        {
            var discarded = Git.DiscardSrc(root);
            // Fall through to the merge only if the IDE actually moved; otherwise the discard IS the whole job.
            if (sidecar is not null && fetched.ProjectVersion == sidecar.ProjectVersion && synced.Count == 0)
                return PullResult.Ok(synced, PostStatus(), discarded == 0
                    ? "already up to date with the IDE — nothing local to discard"
                    : $"discarded {discarded} local change(s); workspace now matches the IDE");
        }
        else if (sidecar is not null && fetched.ProjectVersion == sidecar.ProjectVersion && synced.Count == 0)
            return PullResult.Ok(synced, PostStatus(), "already up to date with the IDE");

        // Auto-commit-on-pull: commit any local edits, then merge (git won't merge a dirty tree). --force discards
        // only UNCOMMITTED src/ edits (Git.DiscardSrc is worktree-scoped), so after one there is usually nothing
        // left to commit and the IDE's state wins. It is NOT an unconditional "IDE wins": a local edit that an
        // earlier pull/push already auto-committed survives the discard and still goes through this ordinary 3-way
        // merge — which can return a CONFLICT. Honouring the button's "cannot be undone" promise literally would be
        // a separate, deliberate change (merge with -X theirs, or reset the branch to volt/ide under force), and the
        // <param name="force"> doc above has to be rewritten with it.
        Git.AutoCommitSrc(root);
        var ideFiles = fetched.Changed.SelectMany(Materialize.MaterializeItem).ToList();
        var newSidecar = new IdeRefs { ProjectVersion = fetched.ProjectVersion, Items = fetched.Items, Folders = fetched.Folders };
        var head = Git.HeadCommit(root);
        var parentIde = IdeTree.VoltIdeHead(gitDir);

        var tree = IdeTree.BuildVoltIdeTree(gitDir, head, parentIde, ideFiles, fetched.Removed,
            fetched.LibrariesRefreshed,
            (done, total) => progress.Report(1, "Importing objects", done, total));
        progress.Enter(2, "Merging");
        var parent = parentIde ?? head;
        var commit = IdeTree.CommitVoltIde(gitDir, tree, parent, $"volt: IDE @ {fetched.ProjectVersion}");
        Git.UpdateRef(gitDir, IdeTree.Range, commit);

        var outcome = Git.GitMerge(root, IdeTree.Range, $"volt: merge IDE @ {fetched.ProjectVersion}");
        if (outcome.Kind == ResultKinds.Conflict)
        {
            // Stash the IDE refs this pull WOULD have adopted, beside the in-progress merge, so `volt merge
            // --continue` can advance the baseline once conflicts are resolved — no "pull again" tax.
            Sidecar.SavePendingIdeRefs(root, newSidecar);
            return PullResult.Conflict(outcome.Paths.Select(Files.StripSrcPrefix).ToList(), PostStatus());
        }

        Sidecar.SaveIdeRefs(root, newSidecar);
        Sidecar.ClearPendingIdeRefs(root); // a clean pull leaves no merge — drop any stash from a past conflict
        return PullResult.Ok(synced, PostStatus());
    }

    /// <summary>volt push — diff HEAD against the IDE baseline, send the changes (with ifVersion guards), then
    /// fast-forward refs/remotes/volt/ide to HEAD's tree. Operates on COMMITTED
    /// history; a dirty tree is auto-committed first.</summary>
    public static PushResult Push(string root, BridgeClient bridge, bool force = false, string? forceWithLease = null, bool dryRun = false, Action<ProgressFrame>? onProgress = null)
    {
        if (!Config.ConfigExists(root)) return PushResult.Rejected("not a Volt workspace — run `volt init` first");
        var gitDir = Git.ResolveGitDir(root);
        var cfg = Config.LoadConfig(root);
        // No pre-op health round-trip: the push carries the bound project and the bridge guards it BEFORE applying,
        // regardless of --force (identity is checked even when the version lease is skipped). The version lease
        // (ExpectedProjectVersion) additionally guards concurrent edits on any bridge, including older ones.
        var sidecar = Sidecar.LoadIdeRefs(root);
        var voltHead = IdeTree.VoltIdeHead(gitDir);
        if (sidecar is null || voltHead is null)
            return PushResult.Rejected("no IDE baseline yet — run `volt pull` once before pushing");

        // Unrecognized-extension guard (BEFORE committing anything): a `.dut` etc. can't sync — fail loud instead
        // of silently skipping and reporting "nothing to push".
        var foreign = Git.DiffWorktree(root, IdeTree.Range, "src")
            .Where(r => r.Kind != DiffKinds.Delete)
            .Select(r => Files.StripSrcPrefix(r.Kind == DiffKinds.Rename ? r.NewPath : r.Path))
            .Where(rel => !Extensions.IsTrackedPath(rel))
            .ToList();
        if (foreign.Count > 0)
            return PushResult.Rejected(
                "unrecognized file extension — these can't sync to the IDE and were NOT pushed. Rename each to its " +
                "Volt kind extension (DUTs — struct/enum/union/alias — are all .dut; POUs .fb/.prg/.fun/.itf; " +
                "global var list .gvl):\n" + string.Join("\n", foreign.Select(p => "  " + p)));

        // The same refusal `Pull` makes, and for a sharper reason: a push's FIRST act is an auto-commit, and a
        // commit during a merge concludes it. Without this, the natural move after a conflicted pull — push your
        // own work back — silently resolved the merge with `<<<<<<< HEAD` still in the files, and then sent that
        // to a live PLC.
        if (Git.IsMerging(root))
            return PushResult.Rejected(
                "a merge is in progress — finish it with `volt merge --continue` or `volt merge --abort` first. " +
                "(Pushing now would conclude the merge with its conflicts unresolved.)");

        Git.AutoCommitSrc(root);

        var forcing = force || forceWithLease is not null;
        var guardItems = sidecar.Items;
        var expectedProjectVersion = forceWithLease is not null ? forceWithLease : force ? null : sidecar.ProjectVersion;

        var rows = Git.DiffRefs(root, IdeTree.Range, "HEAD", "src");

        var affected = rows.SelectMany(r => r.Kind == DiffKinds.Rename
            ? new[] { Files.StripSrcPrefix(r.OldPath), Files.StripSrcPrefix(r.NewPath) }
            : new[] { Files.StripSrcPrefix(r.Path) }).ToList();
        // A referenced library's files are read-only by LOCATION, not by extension. The element signatures the
        // bridge renders beside each `.library` stub carry SOURCE extensions (.fb/.fun/.itf/.dut/.gvl - every arm
        // of LibSignatureRenderer), so `Extensions.IsReadOnly`, which keys on the extension alone, calls them
        // WRITABLE. Pushing one is never right and is destructive, because a push op is keyed by BARE NAME:
        // `Library Manager/CAA/HANDLE.dut` pushes as item "HANDLE.dut", which either creates junk inside the
        // Library Manager or OVERWRITES the project's own DUT that happens to share the short name.
        var libraryRoots = IdeTree.LibraryRoots(Git.ListTree(gitDir, IdeTree.Range).Select(e => e.Path));
        var readOnly = affected.Where(p => Extensions.IsReadOnly(p) || IdeTree.IsUnderLibraryRoot(p, libraryRoots)).ToList();
        if (readOnly.Count > 0)
            return PushResult.Rejected("read-only items can't be pushed — revert these:\n" + string.Join("\n", readOnly.Select(p => "  " + p)));

        // Read every changed blob in ONE `git cat-file --batch` (was a `git show` spawn per file — matters on a
        // large / --force push). The BLOB at HEAD, NOT the worktree file: `.gitattributes` (`* text=auto eol=lf`)
        // eol-smudges the worktree, so a direct read could diverge from what the IDE must receive.
        var blobs = Git.ReadBlobsBatch(root, rows.Where(r => r.Kind != DiffKinds.Delete)
            .Select(r => $"HEAD:src/{Files.StripSrcPrefix(r.Kind == DiffKinds.Rename ? r.NewPath : r.Path)}")
            .Distinct(StringComparer.Ordinal).ToList());
        // TrimStart('﻿'): a BOM is a file-encoding artifact, never content, and `Encoding.UTF8.GetString`
        // does not remove one. Visual Studio and TcXaeShell save UTF-8 WITH a BOM by default on Windows, so any
        // user who opens a workspace file there and saves gets one — and it lands in front of the header keyword,
        // where `.Trim()` leaves it (U+FEFF is not whitespace under .NET Core). The push was then refused with
        // `Unrecognized code header: PROGRAM PLC_PRG`, which reads as self-contradictory because the offending
        // character is invisible. Strip it here, at the one place a workspace file's bytes become text bound for
        // the PLC, rather than teaching every downstream parser about it.
        string HeadSrc(string rel) =>
            blobs.TryGetValue($"HEAD:src/{rel}", out var b) ? Encoding.UTF8.GetString(b).TrimStart('﻿') : "";

        var ops = new List<PushOp>();
        void SetForChange(string rel)
        {
            var item = Materialize.PathToItem(rel);
            if (item is null || !Extensions.IsPushable(rel)) return;
            var ifVersion = guardItems.TryGetValue(item.Value.Name, out var v) ? v : null;
            ops.Add(new SetItemOp
            {
                Name = item.Value.Name,
                ToFolder = ifVersion is null ? item.Value.Folder : null, // create: placement; update: unchanged
                SourceText = HeadSrc(rel),
                IfVersion = ifVersion,
            });
        }

        foreach (var row in rows)
        {
            if (row.Kind == DiffKinds.Delete)
            {
                var rel = Files.StripSrcPrefix(row.Path);
                var item = Materialize.PathToItem(rel);
                if (item is null || !Extensions.IsPushable(rel)) continue;
                if (guardItems.TryGetValue(item.Value.Name, out var v))
                    ops.Add(new DeleteItemOp { Name = item.Value.Name, IfVersion = v });
            }
            else if (row.Kind == DiffKinds.Rename)
            {
                var newRel = Files.StripSrcPrefix(row.NewPath);
                if (!Extensions.IsPushable(newRel)) continue;
                var o = Materialize.PathToItem(Files.StripSrcPrefix(row.OldPath));
                var n = Materialize.PathToItem(newRel)!.Value;
                if (o is null) { SetForChange(newRel); continue; }
                if (!guardItems.TryGetValue(o.Value.Name, out var ver))
                    throw new InvalidOperationException($"renamed item '{o.Value.Name}' has no known IDE version — run `volt pull` first");
                ops.Add(new SetItemOp
                {
                    Name = o.Value.Name,
                    ToName = o.Value.Name != n.Name ? n.Name : null,
                    ToFolder = o.Value.Folder != n.Folder ? n.Folder : null,
                    SourceText = row.Identical ? null : HeadSrc(newRel),
                    IfVersion = ver,
                });
            }
            else SetForChange(Files.StripSrcPrefix(row.Path));
        }

        if (ops.Count == 0) return PushResult.Ok(new List<string>(), null, "nothing to push — the IDE already matches your workspace");
        if (dryRun) return PushResult.Ok(ops.Select(o => o.Name).ToList(), null, "dry run — would push these item(s)");

        PushResponse resp;
        try
        {
            // Label up front — PushService walks the whole project (silently) before its first "applying" frame.
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Phase = "Pushing to IDE", Done = 0, Total = null });
            resp = bridge.PushBatch(new PushRequest
            {
                Ops = ops,
                ExpectedProjectVersion = expectedProjectVersion,
                Force = forcing,
                ExpectedPlatform = cfg.Project.Platform,
                ExpectedProjectName = cfg.Project.ProjectName,
            }, onProgress);
        }
        catch (PipeCallException e) when (IsPreconditionRefusal(e.Code)) { return PushResult.Rejected(e.Message); }
        catch (BridgeError e) when (IsPreconditionRefusal(e.Code)) { return PushResult.Rejected(e.Message); }
        if (!resp.Accepted)
        {
            if (resp.Conflicts?.Any(c => c.Name == "<project>") == true)
                return PushResult.Rejected(forceWithLease is not null
                    ? $"--force-with-lease is stale: the IDE is at {resp.CurrentProjectVersion}, not {forceWithLease} — run `volt pull` first"
                    : "the IDE changed since your last sync — run `volt pull` first (or push --force)");
            var lines = string.Join("\n", (resp.Conflicts ?? new()).Select(c => $"  {c.Name}: {c.Reason}"));
            return PushResult.Rejected($"the bridge rejected the push:\n{lines}");
        }

        // Point volt/ide AT HEAD — exactly what was pushed. New IDE state comes from the receipt (no follow-up `refs`).
        Sidecar.SaveIdeRefs(root, new IdeRefs { ProjectVersion = resp.NewProjectVersion!, Items = resp.NewItems!, Folders = resp.NewFolders! });
        Git.UpdateRef(gitDir, IdeTree.Range, Git.HeadCommit(root)!);

        var status = StatusModel.BuildStatusData(root, new BridgeSnapshot
        {
            Online = true,
            Detail = $"{cfg.Project.Platform}/{cfg.Project.ProjectName}",
            ProjectMismatch = null,
            Items = resp.NewItems!,
            Folders = resp.NewFolders!,
            ProjectVersion = resp.NewProjectVersion!,
        });
        return PushResult.Ok(ops.Select(o => o.Name).ToList(), status);
    }

    /// <summary>volt build — build via the IDE, return normalized diagnostics.</summary>
    public static BuildResult Build(string root, BridgeClient bridge, bool full, Action<ProgressFrame>? onProgress = null)
    {
        if (!Config.ConfigExists(root)) return BuildResult.Refuse("not a Volt workspace — run `volt init` first");
        // No pre-op health round-trip: the build carries the bound project and the bridge guards it in-op, so the
        // diagnostics are for the bound project, not whatever happens to be open.
        var cfg = Config.LoadConfig(root);
        BuildResponse r;
        try
        {
            r = bridge.Build(new BuildRequest
            {
                BuildType = full ? "full" : "incremental",
                ExpectedPlatform = cfg.Project.Platform,
                ExpectedProjectName = cfg.Project.ProjectName,
            }, onProgress);
        }
        catch (PipeCallException e) when (IsPreconditionRefusal(e.Code)) { return BuildResult.Refuse(e.Message); }
        catch (BridgeError e) when (IsPreconditionRefusal(e.Code)) { return BuildResult.Refuse(e.Message); }
        return new BuildResult { Success = r.Success, Duration = r.Duration, Diagnostics = r.Diagnostics };
    }

    /// <summary>How many workspace items differ from the IDE baseline — local changes not yet pushed. 0 when unbound.</summary>
    public static int UnpushedCount(string root)
    {
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            if (IdeTree.VoltIdeHead(gitDir) is null) return 0;
            return Git.DiffWorktree(root, IdeTree.Range, "src").Count;
        }
        catch { return 0; }
    }

    /// <summary>volt show &lt;ref&gt; &lt;src-rel-path&gt; — raw file bytes at a ref (HEAD / VOLTIDE / MERGE_* /
    /// WORKSPACE / BRIDGE). <c>Absent</c> distinguishes "the item legitimately isn't present at this ref" (an
    /// added/removed item in a diff — the caller renders an EMPTY pane) from a genuine error (bad path, no merge):
    /// CmdShow maps Absent → exit 2 (which the diff content-provider renders as ""), a real error → exit 1.</summary>
    public static (byte[]? Bytes, string? Error, bool Absent) Show(string root, BridgeClient bridge, string @ref, string rel)
    {
        if (@ref == "BRIDGE")
        {
            var name = Extensions.FullNameFromPath(rel);
            if (name is null) return (null, $"unrecognized path: {rel}", false);
            var resp = bridge.FetchChanges(new FetchRequest { KnownItems = new() { [name] = "" }, OnlyItems = new() { name } });
            var item = resp.Changed.FirstOrDefault(i => i.Name == name);
            return item is not null ? (Encoding.UTF8.GetBytes(item.SourceText), null, false) : (null, $"bridge has no item {name}", true);
        }
        if (@ref == "WORKSPACE")
        {
            var p = System.IO.Path.Combine(root, Files.SrcDir, rel);
            return File.Exists(p) ? (File.ReadAllBytes(p), null, false) : (null, $"{rel} is not in the workspace", true);
        }
        var gitRef = @ref switch
        {
            "VOLTIDE" => IdeTree.Range,
            "MERGE_OURS" => "HEAD",
            "MERGE_THEIRS" => "MERGE_HEAD",
            "MERGE_BASE" => Git.MergeBase(root, "HEAD", "MERGE_HEAD"),
            _ => @ref,
        };
        if (gitRef is null) return (null, "no merge in progress (MERGE_BASE unavailable)", false);
        var bytes = Git.GitShowBytes(root, gitRef, $"{Files.SrcDir}/{rel}");
        return bytes is not null ? (bytes, null, false) : (null, $"{rel} not found at {@ref}", true);
    }

    /// <summary>volt merge — finish a conflicted pull: --continue | --abort | --resolve.</summary>
    public static (int Code, string Message) Merge(string root, bool cont = false, bool abort = false, string? resolve = null, bool useOurs = false, bool useTheirs = false)
    {
        if (abort)
        {
            if (!Git.IsMerging(root)) { Sidecar.ClearPendingIdeRefs(root); return (0, "no merge in progress"); }
            Git.MergeAbort(root);
            Sidecar.ClearPendingIdeRefs(root); // discard the stashed baseline — we're back to the pre-pull state
            return (0, "merge aborted — workspace restored");
        }
        if (resolve is not null)
        {
            // ASK, never assume. This read `useTheirs ? "theirs" : "ours"` with `useOurs` never read at all, so
            // omitting both flags silently took OURS — on the one command whose entire purpose is to choose a
            // side. Defaulting to ours is also the more surprising direction: it discards the IDE's version.
            if (useOurs == useTheirs)
                return (2, useOurs
                    ? $"--use-ours and --use-theirs are mutually exclusive — pick one for '{resolve}'"
                    : $"which side for '{resolve}'? Pass --use-ours (keep your workspace's version) or " +
                      "--use-theirs (take the IDE's).");

            var side = useTheirs ? "theirs" : "ours";
            Git.CheckoutSide(root, $"{Files.SrcDir}/{resolve}", side);
            return (0, $"resolved {resolve} using {side}");
        }
        if (cont)
        {
            if (!Git.IsMerging(root)) return (1, "no merge in progress — nothing to continue");
            // Refuse if anything is genuinely unresolved BEFORE auto-staging (staging would silently resolve it):
            //  - a file still holding conflict markers (a both-modified conflict not finished editing), OR
            //  - a STRUCTURAL conflict (modify/delete, add/add, …) which carries NO markers and must be resolved
            //    explicitly via `volt merge --resolve` — auto-staging it would silently drop one side.
            var unresolved = Git.ConflictMarkerFiles(root).Concat(Git.StructuralConflictFiles(root))
                .Distinct(StringComparer.Ordinal).OrderBy(p => p, StringComparer.Ordinal).ToList();
            if (unresolved.Count > 0)
                return (2, $"still {unresolved.Count} file(s) unresolved — resolve them (or `volt merge --resolve <path> --use-ours|--use-theirs`) first:\n" + string.Join("\n", unresolved.Select(p => "  " + p)));

            // Is the in-progress merge the one volt pull started? (Captured before the commit clears MERGE_HEAD.)
            // Only THEN may we adopt the stashed baseline — never a stale stash from an unrelated manual merge.
            var isVoltMerge = Git.MergeHead(root) is { } mh && mh == IdeTree.VoltIdeHead(Git.ResolveGitDir(root));

            // Auto-stage src (mirrors pull/push auto-commit) so an editor-resolved tree finalises without `git add`.
            Git.StageSrc(root);
            Git.MergeContinue(root);

            // The one thing git can't do: advance Volt's IDE baseline to the state this merge resolved against.
            if (isVoltMerge && Sidecar.LoadPendingIdeRefs(root) is { } pending)
            {
                Sidecar.SaveIdeRefs(root, pending);
                Sidecar.ClearPendingIdeRefs(root);
                return (0, "merge completed — IDE baseline synced");
            }
            return (0, "merge completed");
        }
        return (1, "merge: pass --continue, --abort, or --resolve <path> [--use-ours|--use-theirs]");
    }

    private static BridgeSnapshot BuildSnap(bool online, string detail, ProjectMismatch? mismatch, RefsResponse refs) => new()
    {
        Online = online,
        Detail = detail,
        ProjectMismatch = mismatch,
        Items = refs.Items,
        Folders = refs.Folders,
        ProjectVersion = refs.ProjectVersion,
    };
}
