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

    /// <summary>One WILDCARD ref whose title + company match TWO compiled versions (`cmpiomgr interfaces, 3.5.19.30` and
    /// `…, 3.5.20.0`) has no one library to own: writing both beside it would declare every element twice in one folder.
    /// The other face of the different-RESOLUTION refusal (design.md "Two refs, one library": "or two compiled versions
    /// of X"); 0 occurrences in the corpora. A directed read naming the ref refuses by name; a full fetch keeps both paths
    /// `(unresolved)` and warns.</summary>
    private static FakeIde TwoVersionsProject()
    {
        var ide = Project();
        ide.LibSignatures = ide.LibSignatures.Append(Fn("IoMgrGetConfigApplication", "cmpiomgr interfaces, 3.5.20.0 (system)", "UDINT")).ToArray();
        return ide;
    }

    [Fact]
    public void A_directed_read_of_a_wildcard_ref_matching_two_compiled_versions_refuses_by_name()
    {
        var ex = Assert.Throws<BridgeException>(() => Directed(TwoVersionsProject(), IoMgrItf));

        Assert.Contains(IoMgrItf, ex.Message);
        Assert.Contains("cmpiomgr interfaces, 3.5.19.30 (system)", ex.Message);
        Assert.Contains("cmpiomgr interfaces, 3.5.20.0 (system)", ex.Message);
    }

    [Fact]
    public void A_full_fetch_keeps_two_compiled_versions_of_one_wildcard_ref_unresolved_and_warns()
    {
        string log;
        FetchResponse full;
        using (var capture = new LogCapture())
        {
            full = Full(TwoVersionsProject());
            log = capture.Read();
        }

        var fns = full.Changed.Where(c => c.Name == "IoMgrGetConfigApplication.pou").ToList();
        Assert.Equal(2, fns.Count);
        Assert.All(fns, f => Assert.Contains(LibraryLayout.UnresolvedFolder, f.Folder!));
        Assert.Contains(full.Changed, c => c.Name == "TON.pou" && c.Folder == FolderOf(full, Standard));
        Assert.True(WarnLines(log).Any(l => l.Contains(IoMgrItf, StringComparison.Ordinal)
                                            && l.Contains("cmpiomgr interfaces, 3.5.20.0 (system)", StringComparison.Ordinal)),
            $"no Warn names the wildcard ref and both versions; the log was:\n{log}");
    }

    /// <summary>A signature path that carries NO company (`cmpiomgr interfaces, 3.5.19.30`) is not claimed by a wildcard
    /// ref (gate step 3, finding 3 — the gate's ruling on the narrowing of design §0): the wildcard rule is title AND
    /// company, recorded on live strings where every path carries a company (tasks.md 1.1). A company-less path has no
    /// recording, so matching it on the title alone would be a guess; it stays loudly `(unresolved)`, and a directed read
    /// of the wildcard does not return it. 0 occurrences in the recordings.</summary>
    [Fact]
    public void A_wildcard_ref_does_not_claim_a_path_without_a_company()
    {
        FakeIde P() { var p = Project(); p.LibSignatures = p.LibSignatures.Append(Fn("IoMgrNoCompany", "cmpiomgr interfaces, 3.5.19.30", "BOOL")).ToArray(); return p; }

        var full = Full(P());
        Assert.Contains(LibraryLayout.UnresolvedFolder, full.Changed.Single(c => c.Name == "IoMgrNoCompany.pou").Folder!);
        Assert.Equal(FolderOf(full, IoMgrItf), full.Changed.Single(c => c.Name == "IoMgrGetConfigApplication.pou").Folder);

        var directed = Directed(P(), IoMgrItf);
        Assert.DoesNotContain(directed.Changed, c => c.Name == "IoMgrNoCompany.pou");
        Assert.Contains(directed.Changed, c => c.Name == "IoMgrGetConfigApplication.pou");
    }

    /// <summary>ONE full name in TWO folders with ONE RESOLUTION (Pro2193's root and Application Library Managers, tasks.md
    /// 1.1 F5 — there with different RESOLUTIONs, 0 occurrences with one) keeps the signatures beside the stub that
    /// SURVIVES (gate step 3, finding 1). `DedupeByFullName` keeps the LAST-walked `.library` of a name, and CODESYS walks
    /// the root Library Manager last; an owner tie-broken by folder instead (`Device/…` &lt; `Library Manager/…`) put the
    /// signatures in a folder whose stub was deduped away — no `IdeTree.LibraryRoots` root, so they lost the read-only
    /// guard and the removal exemption. Same on a directed read.</summary>
    [Fact]
    public void Two_copies_of_one_library_name_keep_the_signatures_beside_the_surviving_stub()
    {
        FakeIde P() => new(
            FakeIde.Item.Library("X", LibraryManifest.Build("X", "X", "X, 1.0 (S)", placeholder: true, system: false), LibMan),
            FakeIde.Item.Library("X", LibraryManifest.Build("X", "X", "X, 1.0 (S)", placeholder: true, system: false), "Library Manager"))
        {
            LibSignatures = new[] { Fn("XFn", "x, 1.0 (s)", "BOOL") },
        };

        foreach (var res in new[] { Full(P()), Directed(P(), "X.library") })
        {
            var stub = res.Changed.Single(c => c.Name == "X.library");
            Assert.Equal("Library Manager/X", stub.Folder);
            Assert.Equal(stub.Folder, res.Changed.Single(c => c.Name == "XFn.pou").Folder);
        }
    }

    // ── 2.3 / design §3 Choice 2: a per-RESOLUTION session cache for directed reads ─────────────────────────

    /// <summary>The owner's recorded decision (proposal: "the extraction is cached per library RESOLUTION in the session,
    /// so repeated reads cost one extraction"), confirmed by 1.2: on CODESYS every extraction runs <c>Build(app)</c>
    /// (22.4-22.9 s after one edit on Pro2193) and REPLACES the engineer's message view, while the precompiled library set
    /// is untouched by an edit or a Clean (7229 → 7229). So two directed reads with no library change extract ONCE —
    /// whichever libraries they name, alone or together — and the later reads answer the full fetch's bytes.
    /// (This replaced <c>Each_directed_library_read_extracts_once_and_nothing_is_cached</c>, which encoded §0's
    /// no-cache default that the owner's decision overrides.)</summary>
    [Fact]
    public void Two_directed_reads_with_no_library_change_extract_once()
    {
        var ide = Project();
        var full = Full(Project());

        Directed(ide, Standard);
        var second = Directed(ide, IoMgrItf);
        var third = Directed(ide, Standard, IoMgrItf);

        Assert.Equal(1, ide.ExtractCalls);
        Assert.Equal(InFolder(full, FolderOf(full, IoMgrItf)), second.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
        Assert.Contains(third.Changed, c => c.Name == "TON.pou" && c.Folder == FolderOf(full, Standard));
    }

    /// <summary>The key is the NAMED library's `.library` version — the change signal D1 already trusts for the full
    /// fetch: a named library whose version moved (an upgrade re-resolves it) extracts again, and the answer is the new
    /// extraction's.</summary>
    [Fact]
    public void A_directed_read_of_a_library_whose_version_moved_extracts_again()
    {
        var ide = Project();
        Directed(ide, Standard);

        ide.RemoveItem("Standard");
        ide.AddItem(Ref("Standard", "Standard", "Standard, 3.5.19.0 (System)"));
        var ton19 = Fb("TON", "standard, 3.5.19.0 (system)", new[] { V("IN", "BOOL"), V("PT", "LTIME") }, new[] { V("Q", "BOOL"), V("ET", "LTIME") });
        ide.LibSignatures = new[] { ton19, IoMgrFn, CallbackFn, FacadeOrphan };
        var res = Directed(ide, Standard);

        Assert.Equal(2, ide.ExtractCalls);
        Assert.Contains("PT : LTIME", res.Changed.Single(c => c.Name == "TON.pou").SourceText);
    }

    /// <summary>A version that moved on a library nobody NAMED voids the cache too (gate step 3, finding 2). The answer
    /// depends on every ref, not only the named ones: the matcher is built over every walked ref, and both refusals
    /// (different RESOLUTIONs on one path, one wildcard over two compiled versions) depend on which compiled paths the
    /// extraction holds. So the key is every walked ref's version — the full fetch's own signal (D1: ANY `.library`
    /// version change re-extracts). (This replaced <c>A_moved_version_of_an_unnamed_library_does_not_extract_again</c>,
    /// whose premise — a per-NAMED-library key — let a reused extraction answer differently from a full fetch, against
    /// the spec's "the same items a full fetch writes".)</summary>
    [Fact]
    public void A_moved_version_of_an_unnamed_library_extracts_again()
    {
        var ide = Project();
        Directed(ide, Standard);

        ide.RemoveItem("CmpEventMgr");
        ide.AddItem(Ref("CmpEventMgr", "CmpEventMgr", "CmpEventMgr, 3.5.19.0 (System)"));
        Directed(ide, Standard);

        Assert.Equal(2, ide.ExtractCalls);
    }

    /// <summary>The finding's repro: a wildcard ref resolved to 3.5.17.0, then an UNNAMED exact ref to 3.5.19.30 is added
    /// with its compiled library. A fresh directed read of the wildcard refuses (the 3.5.19.30 path is claimed by two
    /// RESOLUTIONs, and the wildcard matches two compiled versions); the session that had cached the 3.5.17.0 extraction
    /// must answer the same, not the stale signatures.</summary>
    [Fact]
    public void A_directed_read_after_an_unnamed_library_was_added_answers_as_a_fresh_read()
    {
        var io17 = Fn("IoMgrGetConfigApplication", "cmpiomgr interfaces, 3.5.17.0 (system)", "UDINT");
        var io19 = Fn("IoMgrGetConfigApplication", "cmpiomgr interfaces, 3.5.19.30 (system)", "UDINT");
        FakeIde Before() { var p = Project(); p.LibSignatures = new[] { Ton, RTrig, io17, CallbackFn, FacadeOrphan }; return p; }
        void Upgrade(FakeIde p)
        {
            p.AddItem(Ref("CmpIoMgr Interfaces 3519", "CmpIoMgr Interfaces", "CmpIoMgr Interfaces, 3.5.19.30 (System)"));
            p.LibSignatures = p.LibSignatures.Append(io19).ToArray();
        }

        var fresh = Before();
        Upgrade(fresh);
        var freshEx = Assert.Throws<BridgeException>(() => Directed(fresh, IoMgrItf));

        var session = Before();
        Directed(session, IoMgrItf);
        Upgrade(session);
        var sessionEx = Assert.Throws<BridgeException>(() => Directed(session, IoMgrItf));

        Assert.Equal(freshEx.Message, sessionEx.Message);
        Assert.Equal(2, session.ExtractCalls);
    }

    /// <summary>The full fetch is unchanged (D1: it extracts iff a library moved, always on init) — it never READS the
    /// cache, and its extraction refreshes it, so a directed read after it extracts nothing.</summary>
    [Fact]
    public void A_full_fetch_never_reads_the_cache_and_refreshes_it()
    {
        var ide = Project();
        Directed(ide, Standard);

        Full(ide);
        Assert.Equal(2, ide.ExtractCalls);

        Directed(ide, IoMgrItf);
        Assert.Equal(2, ide.ExtractCalls);
    }

    /// <summary>The cache belongs to ONE bound project: after the bridge serves another project, a directed read extracts
    /// again even where the `.library` version is the same (a wildcard ref's manifest does not name the version it
    /// resolved to).</summary>
    [Fact]
    public void A_directed_read_after_the_served_project_changed_extracts_again()
    {
        var ide = Project();
        Directed(ide, Standard);

        ide.HealthProjectName = "OtherProject";
        Directed(ide, Standard);

        Assert.Equal(2, ide.ExtractCalls);
    }

    /// <summary>`volt show BRIDGE` asks for the manifest only (design §3 Choice 3, R3): the incoming diff pane of a
    /// drifted library compares the manifest, so it neither extracts nor touches the cache.</summary>
    [Fact]
    public void A_manifest_only_directed_read_extracts_nothing_and_answers_the_manifest()
    {
        var ide = Project();

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(), OnlyItems = new() { Standard }, LibraryManifestOnly = true,
        });

        Assert.Equal(0, ide.ExtractCalls);
        Assert.Equal(new[] { Standard }, res.Changed.Select(c => c.Name).ToArray());
        Assert.Equal(Describe(Full(Project()).Changed.Single(c => c.Name == Standard)), Describe(res.Changed.Single()));

        Directed(ide, Standard);
        Assert.Equal(1, ide.ExtractCalls);   // nothing was cached by the manifest-only read
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
}
