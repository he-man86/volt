using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// READING ONE LIBRARY RETURNS ITS API (openspec <c>directed-library-signatures</c> 2.1, 2.3).
///
/// <para>A directed <c>fetch { onlyItems: ["Standard.library"] }</c> answered the manifest alone — LIBRARY, NAMESPACE,
/// RESOLUTION and the format line — so a client that reads items one at a time could not learn a function block's pins
/// (TON's IN/PT → Q/ET) without a full fetch of the whole project and every library. Reproduced live on both vendors
/// (tasks.md 1.1, <c>scripts/library-signature-cost-*.log</c>).</para>
///
/// <para>The fixture is the CODESYS fixture project's shape as recorded: refs under the Application's Library Manager,
/// a wildcard ref named <c>CmpIoMgr Interfaces, %2A (System)</c> whose RESOLUTION is <c>CmpIoMgr Interfaces, * (System)</c>,
/// and the vendor's <c>LibraryPath</c> LOWER-CASED (<c>standard, 3.5.18.0 (system)</c>). The two refs that share one
/// RESOLUTION (<c>CAA Callback</c> + <c>CAA Callback Extern</c>) are in 4 of the 5 CODESYS corpora (1.3 F1). The ref
/// <c>System_VisuElemBase</c> (<c>VisuElemBase, * (System)</c>) is Pro2193's, and as recorded it matches NO signature
/// (<c>library-signature-cost-codesys-pro2193-settled.log</c>: <c>-&gt; NONE</c>) — so the fixture gives it none.</para>
/// </summary>
public class DirectedLibraryReadTests
{
    private const string LibMan = "Device/Plc Logic/Application/Library Manager";

    private const string Standard = "Standard.library";
    private const string IoMgrItf = "CmpIoMgr Interfaces, %2A (System).library";
    private const string VisuElemBase = "System_VisuElemBase.library";
    private const string EventMgrFacade = "CmpEventMgr.library";
    private const string Callback = "CAA Callback.library";
    private const string CallbackExtern = "CAA Callback Extern.library";

    private static FakeIde.Item Ref(string bareName, string title, string resolution) =>
        FakeIde.Item.Library(bareName, LibraryManifest.Build(title, title, resolution, placeholder: true, system: false), LibMan);

    private static LibVar V(string name, string type) => new(name, type);

    private static LibSignature Fb(string name, string libraryPath, LibVar[] inputs, LibVar[] outputs) =>
        new(name, libraryPath, "FunctionBlock", inputs, outputs, Array.Empty<LibVar>(), Array.Empty<LibVar>(), null, null);

    private static LibSignature Fn(string name, string libraryPath, string returns) =>
        new(name, libraryPath, "Function", new[] { V("x", "UDINT") }, Array.Empty<LibVar>(), Array.Empty<LibVar>(),
            Array.Empty<LibVar>(), null, returns);

    private static readonly LibSignature Ton = Fb("TON", "standard, 3.5.18.0 (system)",
        new[] { V("IN", "BOOL"), V("PT", "TIME") }, new[] { V("Q", "BOOL"), V("ET", "TIME") });
    private static readonly LibSignature RTrig = Fb("R_TRIG", "standard, 3.5.18.0 (system)",
        new[] { V("CLK", "BOOL") }, new[] { V("Q", "BOOL") });
    private static readonly LibSignature IoMgrFn = Fn("IoMgrGetConfigApplication", "cmpiomgr interfaces, 3.5.19.30 (system)", "UDINT");
    private static readonly LibSignature CallbackFn = Fn("CB_RegisterCallback", "caa callback extern, 3.5.17.0 (caa technical workgroup)", "BOOL");
    // The facade split (left for the owner, design.md): an implementation library no ref names.
    private static readonly LibSignature FacadeOrphan = Fn("SysTypesHelper", "systypes interfaces, 3.5.2.0 (system)", "BOOL");

    private static FakeIde.Item[] Refs(bool calbackExternFirst)
    {
        var cb = Ref("CAA Callback", "CAA Callback", "CAA Callback Extern, 3.5.17.0 (CAA Technical Workgroup)");
        var cbx = Ref("CAA Callback Extern", "CAA Callback Extern", "CAA Callback Extern, 3.5.17.0 (CAA Technical Workgroup)");
        return new[]
        {
            Ref("Standard", "Standard", "Standard, 3.5.18.0 (System)"),
            Ref("CmpIoMgr Interfaces, %2A (System)", "CmpIoMgr Interfaces", "CmpIoMgr Interfaces, * (System)"),
            Ref("System_VisuElemBase", "VisuElemBase", "VisuElemBase, * (System)"),
            Ref("CmpEventMgr", "CmpEventMgr", "CmpEventMgr, 3.5.17.0 (System)"),
            calbackExternFirst ? cbx : cb,
            calbackExternFirst ? cb : cbx,
        };
    }

    private static FakeIde Project(bool callbackExternFirst = false)
    {
        var items = new List<FakeIde.Item>
        {
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;", "Device/Plc Logic/Application"),
        };
        items.AddRange(Refs(callbackExternFirst));
        return new FakeIde(items.ToArray())
        {
            LibSignatures = new[] { Ton, RTrig, IoMgrFn, CallbackFn, FacadeOrphan },
        };
    }

    private static FetchResponse Full(FakeIde ide) => FetchService.Handle(ide, new FetchRequest { Init = true });

    private static FetchResponse Directed(FakeIde ide, params string[] names) =>
        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(), OnlyItems = names.ToList() });

    private static string FolderOf(FetchResponse res, string fullName) =>
        res.Changed.Single(c => c.Name == fullName).Folder!;

    /// <summary>The items a full fetch writes in one library's folder: its `.library` and every signature beside it.</summary>
    private static string[] InFolder(FetchResponse res, string folder) =>
        res.Changed.Where(c => c.Folder == folder).Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray();

    private static string Describe(FetchedItem c) => $"{c.Folder}|{c.Name}|{c.Version}|{c.SourceText}";

    // ── the gap ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>THE REPORTED GAP. A directed read of Standard answers its manifest AND its signatures — TON with its
    /// pins — beside the `.library`, and no other library's items.</summary>
    [Fact]
    public void A_directed_read_of_a_library_returns_its_signatures()
    {
        var res = Directed(Project(), Standard);

        var lib = res.Changed.Single(c => c.Name == Standard);
        var ton = res.Changed.SingleOrDefault(c => c.Name == "TON.pou");
        Assert.True(ton is not null,
            $"a directed read of {Standard} answered [{string.Join(", ", res.Changed.Select(c => c.Name))}] — the manifest " +
            "alone, so a client cannot learn TON's pins without a full fetch");
        Assert.Equal(lib.Folder, ton!.Folder);
        foreach (var pin in new[] { "IN : BOOL", "PT : TIME", "Q : BOOL", "ET : TIME" })
            Assert.Contains(pin, ton.SourceText);
        Assert.Contains(res.Changed, c => c.Name == "R_TRIG.pou" && c.Folder == lib.Folder);
        Assert.All(res.Changed, c => Assert.Equal(lib.Folder, c.Folder));   // no other library's items
    }

    /// <summary>The same bytes a full fetch writes: folder, name, version and text of the `.library` and of every
    /// signature in its folder (spec "reading a library returns its signatures": "exactly as a full fetch writes them").</summary>
    [Fact]
    public void A_directed_library_read_equals_the_full_fetch_for_that_library()
    {
        var full = Full(Project());
        var folder = FolderOf(full, Standard);

        var directed = Directed(Project(), Standard);

        Assert.Equal(InFolder(full, folder), directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
    }

    /// <summary>The directed read still says it is NOT the complete set for every library folder: with
    /// `librariesRefreshed` true, `IdeTree.DroppedLibraryFile` would delete the folders of every library nobody named
    /// (design.md "Choice: how").</summary>
    [Fact]
    public void A_directed_library_read_does_not_claim_the_libraries_refreshed()
    {
        var res = Directed(Project(), Standard);

        Assert.False(res.LibrariesRefreshed);
        Assert.Empty(res.Removed);
    }

    // ── R1: the wildcard ref ─────────────────────────────────────────────────────────────────────────────

    /// <summary>A ref whose RESOLUTION version is `*` owns the signatures of the library it resolved to — matched on
    /// title AND company, case-insensitive, as recorded (`CmpIoMgr Interfaces, * (System)` ↔
    /// `cmpiomgr interfaces, 3.5.19.30 (system)`). Today the full fetch folders them under `(unresolved)`: ~10% of each
    /// CODESYS corpus's library API.</summary>
    [Fact]
    public void A_full_fetch_writes_a_wildcard_refs_signatures_beside_its_library()
    {
        var full = Full(Project());

        var fn = full.Changed.Single(c => c.Name == "IoMgrGetConfigApplication.pou");
        Assert.Equal(FolderOf(full, IoMgrItf), fn.Folder);
        Assert.DoesNotContain(LibraryLayout.UnresolvedFolder, fn.Folder!);
    }

    /// <summary>A WILDCARD ref that matches zero signatures — `System_VisuElemBase` (`VisuElemBase, * (System)`), recorded
    /// `-&gt; NONE` on Pro2193 — answers its manifest alone and is named in a Warn, like an exact-RESOLUTION facade. (The
    /// recordings hold no wildcard ref whose RESOLUTION title differs from its item name AND has signatures, so "title of
    /// the RESOLUTION, not the item name" is not separable on recorded data: gate step 2, tasks.md 2.1.)</summary>
    [Fact]
    public void A_wildcard_ref_with_no_matched_signature_is_named_in_a_warning()
    {
        string log;
        FetchResponse res;
        using (var capture = new LogCapture())
        {
            res = Directed(Project(), VisuElemBase);
            log = capture.Read();
        }

        Assert.Equal(new[] { VisuElemBase }, res.Changed.Select(c => c.Name).ToArray());   // the manifest alone
        var warns = WarnLines(log);
        Assert.True(warns.Any(l => l.Contains(VisuElemBase, StringComparison.Ordinal)),
            $"no Warn names {VisuElemBase}, a wildcard ref that matched zero signatures; warnings were:\n{string.Join("\n", warns)}");
    }

    /// <summary>The company is part of the identity: a wildcard `(System)` ref does not claim a same-titled library of
    /// another company — it stays loudly `(unresolved)`.</summary>
    [Fact]
    public void A_wildcard_ref_does_not_claim_another_companys_library()
    {
        var ide = Project();
        ide.LibSignatures = new[] { Fn("OtherVendorFn", "cmpiomgr interfaces, 1.0.0.0 (some other gmbh)", "BOOL") };

        var full = Full(ide);

        var fn = full.Changed.Single(c => c.Name == "OtherVendorFn.pou");
        Assert.NotEqual(FolderOf(full, IoMgrItf), fn.Folder);
        Assert.Contains(LibraryLayout.UnresolvedFolder, fn.Folder!);
    }

    /// <summary>A directed read of a wildcard ref answers the folder and bytes the full fetch writes (directed == full).</summary>
    [Fact]
    public void A_directed_read_of_a_wildcard_ref_equals_the_full_fetch()
    {
        var full = Full(Project());
        var folder = FolderOf(full, IoMgrItf);

        var directed = Directed(Project(), IoMgrItf);

        Assert.Contains(directed.Changed, c => c.Name == "IoMgrGetConfigApplication.pou");
        Assert.Equal(InFolder(full, folder), directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
    }

    /// <summary>The facade split stays the owner's (design.md): an implementation library no ref names is still
    /// foldered under `(unresolved)` by a full fetch — nothing is guessed into a real library's folder.</summary>
    [Fact]
    public void The_facade_split_stays_unresolved()
    {
        var full = Full(Project());

        Assert.Contains(LibraryLayout.UnresolvedFolder, full.Changed.Single(c => c.Name == "SysTypesHelper.pou").Folder!);
    }

    // ── a named library that matched nothing is said, not silent ──────────────────────────────────────────

    /// <summary>A named library to which no extracted signature could be attributed — the facade `CmpEventMgr`, whose
    /// elements sit in `cmpeventmgr implementation` — is named in a Warn, so "the manifest alone" is never silent.</summary>
    [Fact]
    public void A_named_library_with_no_matched_signature_is_named_in_a_warning()
    {
        string log;
        FetchResponse? res = null;
        using (var capture = new LogCapture())
        {
            res = Directed(Project(), EventMgrFacade);
            log = capture.Read();
        }

        Assert.Contains(res.Changed, c => c.Name == EventMgrFacade);   // the manifest still answers
        var warns = WarnLines(log);
        Assert.True(warns.Any(l => l.Contains(EventMgrFacade, StringComparison.Ordinal)),
            $"no Warn names {EventMgrFacade}, which matched zero signatures; warnings were:\n{string.Join("\n", warns)}");
    }

    /// <summary>The directed answer COUNTS the extracted signatures no NAMED library claimed (design.md "Left for the
    /// owner"): a directed read of Standard claims TON and R_TRIG; the other 3 — the wildcard ref's, the CAA pair's and the
    /// facade orphan — are claimed by no named library, and the log says how many.</summary>
    [Fact]
    public void A_directed_library_read_counts_the_signatures_no_named_library_claimed()
    {
        string log;
        using (var capture = new LogCapture())
        {
            Directed(Project(), Standard);
            log = capture.Read();
        }

        Assert.True(log.Split('\n').Any(l => l.Contains("3 extracted signatures", StringComparison.Ordinal)
                                             && l.Contains("claimed by no named library", StringComparison.Ordinal)),
            $"no log line counts the 3 extracted signatures claimed by no named library; the log was:\n{log}");
    }

    /// <summary>…and a named library that DID match is not warned about.</summary>
    [Fact]
    public void A_named_library_that_matched_is_not_warned_about()
    {
        string log;
        using (var capture = new LogCapture())
        {
            Directed(Project(), Standard);
            log = capture.Read();
        }

        Assert.DoesNotContain(WarnLines(log), l => l.Contains(Standard, StringComparison.Ordinal));
    }

    // ── two refs, one library (1.3 F1) ───────────────────────────────────────────────────────────────────

    /// <summary>Two refs with the SAME RESOLUTION name one compiled library: never refused, its signatures written ONCE,
    /// beside the ref with the ordinal-least FULL name (`CAA Callback Extern.library` — the folder every corpus shows),
    /// whatever the walk order. Today the ref walked LAST wins, an order nobody chose.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Two_refs_with_one_resolution_get_the_signatures_once_beside_the_ordinal_least_name(bool externFirst)
    {
        var full = Full(Project(externFirst));

        var cb = full.Changed.Where(c => c.Name == "CB_RegisterCallback.pou").ToList();
        Assert.Single(cb);
        Assert.Equal(FolderOf(full, CallbackExtern), cb[0].Folder);
    }

    /// <summary>A directed read naming EITHER ref returns them in the owner's folder, with the full fetch's bytes — and no
    /// zero-match Warn for the ref that does not own them.</summary>
    [Theory]
    [InlineData(Callback)]
    [InlineData(CallbackExtern)]
    public void A_directed_read_of_either_ref_with_one_resolution_returns_them(string named)
    {
        var full = Full(Project());
        var owner = FolderOf(full, CallbackExtern);
        var expected = full.Changed.Single(c => c.Name == "CB_RegisterCallback.pou");

        string log;
        FetchResponse res;
        using (var capture = new LogCapture())
        {
            res = Directed(Project(), named);
            log = capture.Read();
        }

        var got = res.Changed.SingleOrDefault(c => c.Name == "CB_RegisterCallback.pou");
        Assert.True(got is not null, $"a directed read of {named} did not return the CAA Callback Extern signatures");
        Assert.Equal(Describe(expected), Describe(got!));
        Assert.Equal(owner, got!.Folder);
        Assert.DoesNotContain(WarnLines(log), l => l.Contains(named, StringComparison.Ordinal));
    }

    /// <summary>One signature path claimed by refs with DIFFERENT RESOLUTIONs — only the wildcard rule can produce it:
    /// `CmpIoMgr Interfaces, * (System)` beside a direct `CmpIoMgr Interfaces, 3.5.19.30 (System)` — is an ambiguous owner,
    /// never resolved by order. (No corpus has one: 0 occurrences.)
    /// <para>Scope (gate step 2, default — the owner may overrule): a DIRECTED read naming either claimant refuses by name
    /// — the client asked for that library's API and no one owner exists. A FULL fetch does not throw (a throwing guard on
    /// the full read path would make the whole project unpullable, CLAUDE.md); it keeps the path's signatures loudly
    /// under `(unresolved)` — attributed to neither — and names both refs and the path in a Warn.</para></summary>
    private static FakeIde AmbiguousProject()
    {
        var ide = Project();
        ide.AddItem(Ref("CmpIoMgr Interfaces", "CmpIoMgr Interfaces", "CmpIoMgr Interfaces, 3.5.19.30 (System)"));
        return ide;
    }

    [Theory]
    [InlineData(IoMgrItf)]
    [InlineData("CmpIoMgr Interfaces.library")]
    public void A_directed_read_of_a_path_claimed_by_refs_with_different_resolutions_refuses_by_name(string named)
    {
        var ex = Assert.Throws<BridgeException>(() => Directed(AmbiguousProject(), named));

        Assert.Contains(IoMgrItf, ex.Message);
        Assert.Contains("CmpIoMgr Interfaces.library", ex.Message);
        Assert.Contains("cmpiomgr interfaces, 3.5.19.30 (system)", ex.Message);
    }

    [Fact]
    public void A_full_fetch_keeps_a_path_claimed_by_refs_with_different_resolutions_unresolved_and_warns()
    {
        string log;
        FetchResponse full;
        using (var capture = new LogCapture())
        {
            full = Full(AmbiguousProject());
            log = capture.Read();
        }

        Assert.Contains(LibraryLayout.UnresolvedFolder, full.Changed.Single(c => c.Name == "IoMgrGetConfigApplication.pou").Folder!);
        Assert.Contains(full.Changed, c => c.Name == "TON.pou" && c.Folder == FolderOf(full, Standard));   // the rest still pulls
        var warns = WarnLines(log);
        Assert.True(warns.Any(l => l.Contains(IoMgrItf, StringComparison.Ordinal)
                                   && l.Contains("CmpIoMgr Interfaces.library", StringComparison.Ordinal)
                                   && l.Contains("cmpiomgr interfaces, 3.5.19.30 (system)", StringComparison.Ordinal)),
            $"no Warn names both claimants and the path; warnings were:\n{string.Join("\n", warns)}");
    }

    // ── 2.3: one extraction per read, no session cache ─────────────────────────────────────────────────────

    /// <summary>No bridge cache (archived <c>cache-library-signatures</c> D1, 0.1 R5): two directed reads in a row each
    /// run the vendor's own extraction — CODESYS keeps its precompile warm by itself, TwinCAT has no build in the path
    /// (1.2). A directed read naming two libraries extracts once.</summary>
    [Fact]
    public void Each_directed_library_read_extracts_once_and_nothing_is_cached()
    {
        var ide = Project();

        Directed(ide, Standard);
        Directed(ide, IoMgrItf);
        Assert.Equal(2, ide.ExtractCalls);

        Directed(ide, Standard, IoMgrItf);
        Assert.Equal(3, ide.ExtractCalls);
    }

    /// <summary>A directed read naming TWO libraries answers both folders exactly as the full fetch writes them — neither
    /// library's signatures dropped nor put under `(unresolved)`.</summary>
    [Fact]
    public void A_directed_read_of_two_libraries_equals_the_full_fetch_for_both()
    {
        var full = Full(Project());
        var expected = InFolder(full, FolderOf(full, Standard)).Concat(InFolder(full, FolderOf(full, IoMgrItf)))
            .OrderBy(s => s, StringComparer.Ordinal).ToArray();

        var directed = Directed(Project(), Standard, IoMgrItf);

        Assert.Equal(expected, directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
    }

    /// <summary>A directed read naming a library AND a POU answers the library's folder and the POU, each as the full
    /// fetch writes it.</summary>
    [Fact]
    public void A_directed_read_of_a_library_and_a_pou_equals_the_full_fetch_for_both()
    {
        var full = Full(Project());
        var expected = InFolder(full, FolderOf(full, Standard))
            .Append(Describe(full.Changed.Single(c => c.Name == "PLC_PRG.pou")))
            .OrderBy(s => s, StringComparer.Ordinal).ToArray();

        var directed = Directed(Project(), Standard, "PLC_PRG.pou");

        Assert.Equal(expected, directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
    }

    /// <summary>A directed read that names no library extracts nothing — the read that names `PLC_PRG.pou` stays the
    /// build-free walk it is today.</summary>
    [Fact]
    public void A_directed_read_naming_no_library_extracts_nothing()
    {
        var ide = Project();

        var res = Directed(ide, "PLC_PRG.pou");

        Assert.Equal(0, ide.ExtractCalls);
        Assert.Equal(new[] { "PLC_PRG.pou" }, res.Changed.Select(c => c.Name).ToArray());
    }

    // ── log capture ──────────────────────────────────────────────────────────────────────────────────────

    private static string[] WarnLines(string log) =>
        log.Split('\n').Where(l => l.Contains("[warn]", StringComparison.Ordinal)).ToArray();

    /// <summary>VoltLog into a private directory for one test (the assembly runs serially, TestParallelism.cs).</summary>
    private sealed class LogCapture : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));

        public LogCapture()
        {
            VoltLog.Init("codesys", _dir);
            VoltLog.Level = VoltLogLevel.Debug;
        }

        public string Read() =>
            Directory.Exists(_dir) ? string.Concat(Directory.GetFiles(_dir, "codesys-*.log").Select(File.ReadAllText)) : "";

        public void Dispose()
        {
            VoltLog.Level = VoltLogLevel.Info;
            try { Directory.Delete(_dir, true); } catch { }
        }
    }
}
