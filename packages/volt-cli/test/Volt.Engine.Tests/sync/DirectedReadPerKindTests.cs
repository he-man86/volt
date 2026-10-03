using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY READABLE EXTENSION IS READABLE ON ITS OWN (openspec <c>directed-library-signatures</c> 2.4, spec "every
/// readable extension is readable by a directed fetch").
///
/// <para>One row per <see cref="ItemKind.Kinds"/> constant, data-driven: a kind added to <c>ItemKind</c> without a row
/// fails <see cref="Every_kind_has_exactly_one_row"/>. A row says HOW the kind is read:</para>
/// <list type="bullet">
/// <item><b>File</b> — the kind is a file of its own; a directed <c>fetch { onlyItems: [X.ext] }</c> must answer the
/// same item (folder, name, version, text) a full fetch writes — and, for a library, the same signature files beside
/// it (that row is the red half of this change until 3.1).</item>
/// <item><b>ThroughOwner</b> — the kind is inlined in its owner's file (<see cref="ItemKind.IsInlinedInPou"/>: members,
/// accessors, a TwinCAT task's call references) and has no wire name of its own; the row reads the OWNER directed,
/// asserts it equals the full fetch's owner, AND that the row's own child text (<c>Shows</c>) is in that owner text —
/// so a member both fetches dropped the same way cannot pass.</item>
/// <item><b>NotRendered</b> — inlined in its owner like the above, but NO fetch returns its content: a TRANSITION
/// "never reaches the item's file" (<see cref="ItemKind"/>, IsMember's note). The row asserts the content is in
/// NEITHER answer, so it is never counted as readable; it FAILS the day a reader renders one (move it to
/// ThroughOwner then).</item>
/// <item><b>NeverAnItem</b> — a folder or a container manager (<see cref="ItemKind.IsContainerManager"/>): a path segment,
/// never a file, so there is nothing to read.</item>
/// </list>
/// <para>Each File and ThroughOwner row runs in the vendor shapes that produce it — the CODESYS Application spine with
/// its Library Manager, and TwinCAT's root with its <c>References</c> node and exact-case RESOLUTION join (tasks.md 1.1).
/// The TwinCAT-only codes — interface accessors 654/655 (CODESYS classifies them 613/614) and the task call reference
/// 650 (CODESYS keeps the calls as a task property) — run in the TwinCAT shape alone.</para>
/// </summary>
public class DirectedReadPerKindTests
{
    public enum Route { File, ThroughOwner, NotRendered, NeverAnItem }

    public enum Vendor { Codesys, Twincat }

    private static readonly Vendor[] Both = { Vendor.Codesys, Vendor.Twincat };
    private static readonly Vendor[] TwincatOnly = { Vendor.Twincat };

    /// <param name="Shows">ThroughOwner / NotRendered: the row's own child text, which must (NotRendered: must NOT) be in
    /// the owner's text.</param>
    private sealed record Row(string Kind, Route Route, string Why, Func<Vendor, FakeIde>? Fixture = null, string? ReadName = null,
        string? Shows = null, Vendor[]? Vendors = null);

    private static string Base(Vendor v) => v == Vendor.Codesys ? "Device/Plc Logic/Application" : "";
    private static string LibFolder(Vendor v) => v == Vendor.Codesys ? "Device/Plc Logic/Application/Library Manager" : "References";
    private static string Platform(Vendor v) => v == Vendor.Codesys ? Vendors.Codesys : Vendors.Twincat;

    private static FakeIde Ide(Vendor v, params FakeIde.Item[] items) =>
        new FakeIde(items.Prepend(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;", Base(v))).ToArray())
        {
            HealthPlatform = Platform(v),
        };

    /// <summary>A read-only descriptor of <paramref name="code"/>: its body is its manifest (<c>ReadManifest</c>).</summary>
    private static Row Descriptor(string kind, int code, string bareName) =>
        new(kind, Route.File, "a read-only descriptor file",
            v => Ide(v, new FakeIde.Item(bareName, code, Base(v), true, $"{kind}\nNAME {bareName}\n", null, null, null)),
            $"{bareName}.{ItemKind.ExtFor(kind)}");

    private static Row Owned(string kind, string why, Func<Vendor, FakeIde> fixture, string ownerName, string shows,
        Vendor[]? vendors = null) =>
        new(kind, Route.ThroughOwner, why, fixture, ownerName, shows, vendors);

    // ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────

    private static FakeIde.Item Fb(Vendor v, params string[] children) =>
        new("FB_Owner", ItemKind.PlcPou, Base(v), true, "FUNCTION_BLOCK FB_Owner\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", null, null,
            children);

    private static FakeIde.Item Itf(Vendor v, params string[] children) =>
        new("I_Owner", ItemKind.PlcItf, Base(v), true, "INTERFACE I_Owner", null, null, null, children);

    private static FakeIde.Item Member(string name, int code, string? decl, string? impl, params string[] children) =>
        new(name, code, "", false, decl, impl, null, null, children.Length == 0 ? null : children);

    private static FakeIde WithMethod(Vendor v) =>
        Ide(v, Fb(v, "M"), Member("M", ItemKind.PlcMethod, "METHOD M : BOOL\nVAR\nEND_VAR", "M := TRUE;"));

    private static FakeIde WithAction(Vendor v) =>
        Ide(v, Fb(v, "A"), Member("A", ItemKind.PlcAction, null, "x := 2;"));

    private static FakeIde WithProperty(Vendor v) =>
        Ide(v, Fb(v, "Pr"),
            Member("Pr", ItemKind.PlcProp, "PROPERTY Pr : INT", null, "Get", "Set"),
            Member("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", "Pr := x;"),
            Member("Set", ItemKind.PlcPropSet, "VAR\nEND_VAR", "x := Pr;"));

    private static FakeIde WithTransition(Vendor v) =>
        Ide(v, Fb(v, "T"), Member("T", ItemKind.PlcTrans, null, "x > 1"));

    private static FakeIde WithInterfaceMethod(Vendor v) =>
        Ide(v, Itf(v, "IM"), Member("IM", ItemKind.PlcItfMeth, "METHOD IM : BOOL", null));

    /// <summary>CODESYS classifies an interface accessor as the POU accessor code (613/614); TwinCAT as 654/655
    /// (ItemKind's own comment) — each vendor's own code. The accessor's declaration is blank, as in every fixture and
    /// live project measured (DIALECT D21/D41): its PRESENCE (`GET … END_GET`) is the content a read must carry.</summary>
    private static FakeIde WithInterfaceProperty(Vendor v, bool setter)
    {
        var code = v == Vendor.Codesys
            ? (setter ? ItemKind.PlcPropSet : ItemKind.PlcPropGet)
            : (setter ? ItemKind.PlcItfPropSet : ItemKind.PlcItfPropGet);
        var accessor = setter ? "Set" : "Get";
        return Ide(v, Itf(v, "IP"),
            Member("IP", ItemKind.PlcItfProp, "PROPERTY IP : INT", null, accessor),
            Member(accessor, code, "", null));
    }

    /// <summary>A TwinCAT task models its POU calls as child items (PlcProgRef, 650), folded into the `.task` file's
    /// `Calls:` line (<see cref="ItemKind.InlinesItsChildren"/>).</summary>
    private static FakeIde WithTaskCall(Vendor v) =>
        Ide(v, new FakeIde.Item("MainTask", ItemKind.PlcTask, Base(v), true,
                "Type:     Cyclic\nInterval: 10ms\nPriority: 1\nCalls:    PLC_PRG\n", null, null, null, new[] { "MainTask.PLC_PRG" }),
            Member("MainTask.PLC_PRG", ItemKind.PlcProgRef, null, null));

    /// <summary>A library ref and one signature of it, spelled as each vendor spells the join: CODESYS's
    /// <c>LibraryPath</c> is lower-cased, TwinCAT's is <c>LibraryManifest.Resolution</c> exactly (1.1).</summary>
    private static FakeIde WithLibrary(Vendor v)
    {
        var (title, resolution, path) = v == Vendor.Codesys
            ? ("Standard", "Standard, 3.5.18.0 (System)", "standard, 3.5.18.0 (system)")
            : ("Tc2_Standard", LibraryManifest.Resolution("Tc2_Standard", "3.4.5.0", "Beckhoff Automation GmbH"),
               LibraryManifest.Resolution("Tc2_Standard", "3.4.5.0", "Beckhoff Automation GmbH"));
        var ide = Ide(v, FakeIde.Item.Library(title, LibraryManifest.Build(title, title, resolution, true, false), LibFolder(v)));
        ide.LibSignatures = new[]
        {
            new LibSignature("TON", path, "FunctionBlock", new[] { new LibVar("IN", "BOOL"), new LibVar("PT", "TIME") },
                new[] { new LibVar("Q", "BOOL"), new LibVar("ET", "TIME") }, Array.Empty<LibVar>(), Array.Empty<LibVar>(), null, null),
        };
        return ide;
    }

    private static string LibraryName(Vendor v) => v == Vendor.Codesys ? "Standard.library" : "Tc2_Standard.library";

    // ── the table ────────────────────────────────────────────────────────────────────────────────────────

    private static readonly Row[] Rows =
    {
        // Source files.
        new(ItemKind.Kinds.Pou, Route.File, "a POU's file",
            v => Ide(v, FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;", Base(v))),
            "FB_A.pou"),
        new(ItemKind.Kinds.Dut, Route.File, "a DUT's file",
            v => Ide(v, new FakeIde.Item("ST_A", ItemKind.PlcDut, Base(v), true, "TYPE ST_A :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", null, null, null)),
            "ST_A.dut"),
        new(ItemKind.Kinds.Gvl, Route.File, "a GVL's file",
            v => Ide(v, new FakeIde.Item("GVL_A", ItemKind.PlcGvl, Base(v), true, "VAR_GLOBAL\n\tg : BOOL;\nEND_VAR", null, null, null)),
            "GVL_A.gvl"),
        new(ItemKind.Kinds.Interface, Route.File, "an interface's file",
            v => Ide(v, new FakeIde.Item("I_A", ItemKind.PlcItf, Base(v), true, "INTERFACE I_A", null, null, null)),
            "I_A.itf"),

        // The library: its manifest AND the signatures a full fetch writes beside it (red until 3.1).
        new(ItemKind.Kinds.Library, Route.File, "a library ref: its manifest and its signatures", WithLibrary, null),

        // Descriptors (read-only manifests) and the one writable descriptor, the task.
        Descriptor(ItemKind.Kinds.Device, ItemKind.PlcDevice, "Dev"),
        Descriptor(ItemKind.Kinds.ProjectInfo, ItemKind.PlcProjectInfo, "Project Information"),
        Descriptor(ItemKind.Kinds.Trace, ItemKind.PlcTrace, "Trace"),
        Descriptor(ItemKind.Kinds.Recipe, ItemKind.PlcRecipe, "Recipe"),
        Descriptor(ItemKind.Kinds.SymbolConfig, ItemKind.PlcSymbolConfig, "Symbol Configuration"),
        Descriptor(ItemKind.Kinds.Task, ItemKind.PlcTask, "MainTask"),
        Descriptor(ItemKind.Kinds.ProjectSettings, ItemKind.PlcProjectSettings, "Project Settings"),
        Descriptor(ItemKind.Kinds.ImagePool, ItemKind.PlcImagePool, "GlobalImagePool"),
        Descriptor(ItemKind.Kinds.ParameterList, ItemKind.PlcParamList, "Params"),
        Descriptor(ItemKind.Kinds.TextList, ItemKind.PlcTextList, "GlobalTextList"),
        Descriptor(ItemKind.Kinds.Visualization, ItemKind.PlcVisObj, "Visu"),
        Descriptor(ItemKind.Kinds.ClassDiagram, ItemKind.PlcClassDiagram, "Diagram"),
        Descriptor(ItemKind.Kinds.ExternalTypes, ItemKind.PlcExtDataTypeCont, "External Types"),
        Descriptor(ItemKind.Kinds.TmcFile, ItemKind.PlcTmcDescription, "Module"),

        // Inlined in the owner's file: no wire name of their own.
        Owned(ItemKind.Kinds.Method, "a METHOD block in its POU's file", WithMethod, "FB_Owner.pou", "M := TRUE;"),
        Owned(ItemKind.Kinds.Action, "an ACTION block in its POU's file", WithAction, "FB_Owner.pou", "x := 2;"),
        Owned(ItemKind.Kinds.Property, "a PROPERTY block in its POU's file", WithProperty, "FB_Owner.pou", "PROPERTY Pr : INT"),
        Owned(ItemKind.Kinds.PropertyGet, "read WITH its property, in the POU's file", WithProperty, "FB_Owner.pou", "Pr := x;"),
        Owned(ItemKind.Kinds.PropertySet, "read WITH its property, in the POU's file", WithProperty, "FB_Owner.pou", "x := Pr;"),
        new(ItemKind.Kinds.Transition, Route.NotRendered, "inlined in its POU, and NOT rendered: no reader models one",
            WithTransition, "FB_Owner.pou", "x > 1"),
        Owned(ItemKind.Kinds.InterfaceMethod, "a METHOD signature in its interface's file", WithInterfaceMethod, "I_Owner.itf",
            "METHOD IM : BOOL"),
        Owned(ItemKind.Kinds.InterfaceProperty, "a PROPERTY signature in its interface's file",
            v => WithInterfaceProperty(v, setter: false), "I_Owner.itf", "PROPERTY IP : INT"),
        Owned(ItemKind.Kinds.InterfacePropertyGet, "TwinCAT's interface accessor (654), read with its property",
            v => WithInterfaceProperty(v, setter: false), "I_Owner.itf", "GET\nEND_GET", TwincatOnly),
        Owned(ItemKind.Kinds.InterfacePropertySet, "TwinCAT's interface accessor (655), read with its property",
            v => WithInterfaceProperty(v, setter: true), "I_Owner.itf", "SET\nEND_SET", TwincatOnly),
        Owned(ItemKind.Kinds.TaskCallReference, "a TwinCAT task's call, folded into the `.task` file's Calls: line",
            WithTaskCall, "MainTask.task", "Calls:    PLC_PRG", TwincatOnly),

        // Never an item.
        new(ItemKind.Kinds.Folder, Route.NeverAnItem, "a path segment, never a file"),
        new(ItemKind.Kinds.LibraryManager, Route.NeverAnItem, "a container manager: the folder of its library refs"),
        new(ItemKind.Kinds.VisualizationManager, Route.NeverAnItem, "a container manager: the folder of its visualizations"),
        new(ItemKind.Kinds.RecipeManager, Route.NeverAnItem, "a container manager: the folder of its recipes"),
    };

    private static IEnumerable<string> AllKinds() =>
        typeof(ItemKind.Kinds).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!);

    private static Row RowFor(string kind) => Rows.Single(r => r.Kind == kind);

    public static IEnumerable<object[]> Cases(Route route) =>
        from r in Rows where r.Route == route
        from v in r.Vendors ?? Both
        select new object[] { r.Kind, v };

    public static IEnumerable<object[]> FileCases() => Cases(Route.File);
    public static IEnumerable<object[]> OwnerCases() => Cases(Route.ThroughOwner);
    public static IEnumerable<object[]> NotRenderedCases() => Cases(Route.NotRendered);

    // ── the gate on the table itself ─────────────────────────────────────────────────────────────────────

    /// <summary>A kind added to <see cref="ItemKind.Kinds"/> without a row fails here — the spec's "a kind without a
    /// directed read" scenario. (34 kinds at the gate, 0.1.)</summary>
    [Fact]
    public void Every_kind_has_exactly_one_row()
    {
        var kinds = AllKinds().OrderBy(k => k, StringComparer.Ordinal).ToArray();
        var rows = Rows.Select(r => r.Kind).OrderBy(k => k, StringComparer.Ordinal).ToArray();

        Assert.Equal(kinds, rows);
        Assert.Equal(kinds.Length, kinds.Distinct().Count());
    }

    /// <summary>The routes agree with <see cref="ItemKind"/>'s own predicates, so a row cannot be filed under the wrong
    /// route to dodge the read: ThroughOwner ⇔ inlined in a POU, NeverAnItem ⇔ folder or container manager, File ⇔ the
    /// kind has a file extension.</summary>
    [Fact]
    public void Each_rows_route_is_the_kinds_own()
    {
        var inlined = Enumerable.Range(-2, 800).Where(ItemKind.IsInlinedInPou).Select(ItemKind.Map).ToHashSet();
        var managers = Enumerable.Range(-2, 800).Where(ItemKind.IsContainerManager).Select(ItemKind.Map).ToHashSet();
        var withFile = ItemKind.FileExtensions.Select(e => ItemKind.KindForWireName("x." + e.Ext)).ToHashSet();

        foreach (var r in Rows)
        {
            if (r.Route == Route.NotRendered)
            {
                Assert.True(inlined.Contains(r.Kind), $"'{r.Kind}' is filed NotRendered, but ItemKind does not inline it");
                continue;
            }
            var expected = inlined.Contains(r.Kind) ? Route.ThroughOwner
                : managers.Contains(r.Kind) || r.Kind == ItemKind.Kinds.Folder ? Route.NeverAnItem
                : withFile.Contains(r.Kind) ? Route.File
                : throw new Xunit.Sdk.XunitException($"kind '{r.Kind}' is neither inlined, a container, nor a file");
            Assert.True(expected == r.Route, $"'{r.Kind}' is filed {r.Route}, but ItemKind makes it {expected}");
        }
    }

    // ── the reads ────────────────────────────────────────────────────────────────────────────────────────

    private static string Describe(FetchedItem c) => $"{c.Folder}|{c.Name}|{c.Version}|{c.SourceText}";

    private static FetchResponse Full(FakeIde ide) => FetchService.Handle(ide, new FetchRequest { Init = true });

    private static FetchResponse Directed(FakeIde ide, string name) =>
        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(), OnlyItems = new() { name } });

    /// <summary>A kind with a file of its own: the directed read answers exactly what the full fetch writes for it — and
    /// for a library, everything the full fetch writes in the library's folder (its signatures).</summary>
    [Theory]
    [MemberData(nameof(FileCases))]
    public void A_directed_read_of_a_file_kind_equals_the_full_fetch(string kind, Vendor vendor)
    {
        var row = RowFor(kind);
        var name = row.ReadName ?? LibraryName(vendor);
        var full = Full(row.Fixture!(vendor));
        var item = full.Changed.SingleOrDefault(c => c.Name == name);
        Assert.True(item is not null, $"the {kind} fixture's full fetch has no '{name}' ({string.Join(", ", full.Changed.Select(c => c.Name))})");

        var directed = Directed(row.Fixture!(vendor), name);

        var expected = kind == ItemKind.Kinds.Library
            ? full.Changed.Where(c => c.Folder == item!.Folder)
            : new[] { item! };
        Assert.Equal(expected.Select(Describe).OrderBy(s => s, StringComparer.Ordinal),
                     directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal));
    }

    /// <summary>A kind inlined in its owner's file is read through the owner: the owner's directed read equals the full
    /// fetch's owner, and the row's own child text is IN that owner text — equality alone passes when both fetches drop
    /// the member the same way.</summary>
    [Theory]
    [MemberData(nameof(OwnerCases))]
    public void An_inlined_kind_is_read_through_its_owner(string kind, Vendor vendor)
    {
        var row = RowFor(kind);
        var full = Full(row.Fixture!(vendor));
        var owner = full.Changed.SingleOrDefault(c => c.Name == row.ReadName);
        Assert.True(owner is not null, $"the {kind} fixture's full fetch has no owner '{row.ReadName}'");
        Assert.True(owner!.SourceText.Contains(row.Shows!, StringComparison.Ordinal),
            $"the {kind} child's text '{row.Shows}' is not in the full fetch's '{row.ReadName}':\n{owner.SourceText}");

        var directed = Directed(row.Fixture!(vendor), row.ReadName!);

        Assert.Equal(new[] { Describe(owner) }, directed.Changed.Select(Describe).ToArray());
    }

    /// <summary>A kind no fetch renders is NOT readable, directed or not: its content is in neither answer. Pinned so the
    /// table never counts it as readable — and so this fails, and the row moves to ThroughOwner, the day a reader renders
    /// one.</summary>
    [Theory]
    [MemberData(nameof(NotRenderedCases))]
    public void A_kind_no_fetch_renders_is_in_neither_answer(string kind, Vendor vendor)
    {
        var row = RowFor(kind);
        var full = Full(row.Fixture!(vendor)).Changed.Single(c => c.Name == row.ReadName);
        var directed = Directed(row.Fixture!(vendor), row.ReadName!).Changed.Single(c => c.Name == row.ReadName);

        Assert.DoesNotContain(row.Shows!, full.SourceText, StringComparison.Ordinal);
        Assert.DoesNotContain(row.Shows!, directed.SourceText, StringComparison.Ordinal);
    }

    /// <summary>A folder or a container manager is never a file: `ExtFor` names no extension for a folder, and a full
    /// fetch writes no file for a container manager (it is the folder its children sit in).</summary>
    [Fact]
    public void A_folder_or_container_manager_is_never_an_item()
    {
        Assert.Throws<ArgumentException>(() => ItemKind.ExtFor(ItemKind.Kinds.Folder));
        foreach (var (kind, code) in new[]
                 {
                     (ItemKind.Kinds.LibraryManager, ItemKind.PlcLibMan),
                     (ItemKind.Kinds.VisualizationManager, ItemKind.PlcVisMan),
                     (ItemKind.Kinds.RecipeManager, ItemKind.PlcRecipeMan),
                 })
        {
            Assert.Equal(Route.NeverAnItem, RowFor(kind).Route);
            var full = Full(new FakeIde(new FakeIde.Item("Manager", code, "App", false, kind, null, null, null)));
            Assert.DoesNotContain(full.Changed, c => c.Name.StartsWith("Manager", StringComparison.Ordinal));
        }
    }
}
