using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// ONE OBJECT THE WALK CANNOT CLASSIFY NEVER FAILS THE WALK (openspec <c>codesys-refs-guid-int32</c>, task 2.2).
///
/// <para>The CODESYS walk reads every child's object to learn its kind, and that read was unguarded: when it failed
/// (measured on a Pro2193 copy — <c>Object of type 'System.Guid' cannot be converted to type 'System.Int32'</c>)
/// the exception left <c>WalkItems</c> and <c>refs</c> answered <c>INTERNAL_ERROR</c> for the whole project, so the
/// project could not be pulled at all. The object is now a <see cref="Volt.Engine.Item.UnreadableObject"/>: every
/// read op names it in <c>unreadable</c>, returns every other item, and — its kind being unknown — reports nothing
/// in its folder as removed.</para>
/// </summary>
public class UnclassifiableObjectTests
{
    private static string Prg(string name) =>
        $"PROGRAM {name}\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 0;\n\nEND_PROGRAM\n";

    private static FakeIde Project(bool withEnum = true)
    {
        var ide = new FakeIde();
        var items = new List<(string, string)> { ("A", ""), ("B", "Data") };
        if (withEnum) items.Add(("SER_OperationModeType", "Data"));
        foreach (var (name, folder) in items)
            PushService.Handle(ide, new PushRequest
            {
                ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
                Ops = new List<PushOp>
                {
                    new SetItemOp { Name = $"{name}.prg", ToFolder = folder, SourceText = Prg(name), IfVersion = null },
                },
            });
        return ide;
    }

    [Fact]
    public void Refs_names_the_object_unreadable_and_returns_every_other_item()
    {
        var ide = Project();
        ide.UnclassifiableItems = new[] { "SER_OperationModeType" };

        var refs = RefsService.Handle(ide);

        Assert.Equal(new[] { "SER_OperationModeType" }, refs.Unreadable);
        Assert.Contains("A.prg", refs.Items.Keys);
        Assert.Contains("B.prg", refs.Items.Keys);
        Assert.DoesNotContain("SER_OperationModeType.prg", refs.Items.Keys);
        Assert.Equal(new[] { "Data", "Data/SER_OperationModeType" }, refs.UnwalkedFolders);   // its folder AND its own subtree
    }

    [Fact]
    public void Fetch_names_it_too_and_neither_read_op_reports_it_removed()
    {
        var ide = Project();
        var baseline = RefsService.Handle(ide);
        ide.UnclassifiableItems = new[] { "SER_OperationModeType" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Equal(new[] { "SER_OperationModeType" }, fetch.Unreadable);
        Assert.Empty(fetch.Removed);
        Assert.Empty(refs.Removed);
    }

    /// <summary>It still EXISTS, so it still counts: the aggregate version is not the one of a project WITHOUT the
    /// object (an unreadable object is not a deleted one), and refs, fetch and the push gate agree on it (the
    /// version-map parity every walk keeps).</summary>
    [Fact]
    public void It_counts_toward_the_project_version_identically_on_every_walk()
    {
        var ide = Project();
        var without = RefsService.Handle(Project(withEnum: false)).ProjectVersion;
        ide.UnclassifiableItems = new[] { "SER_OperationModeType" };

        var refs = RefsService.Handle(ide);
        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });
        var push = PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new List<PushOp>() });

        Assert.NotEqual(without, refs.ProjectVersion);
        Assert.Equal(refs.ProjectVersion, fetch.ProjectVersion);
        Assert.True(push.Accepted, $"an empty push quoting refs' projectVersion was refused (current {push.CurrentProjectVersion})");
    }

    /// <summary>A ROOT-LEVEL object the walk cannot classify protects everything beneath it. In CODESYS the root
    /// children are the Device node(s) and the POUs-view folders, and each non-folder one is classified by reading its
    /// object — so one failed read there means the walk never enters <c>Device/...</c>. Its parent folder is the root
    /// (<c>""</c>), and marking only that folder protected nothing: no real path is under <c>"" + "/"</c>, so every
    /// known item in the subtree read as deleted and <c>volt pull</c> deleted its file.</summary>
    [Fact]
    public void A_root_level_object_that_cannot_be_classified_reports_nothing_beneath_it_removed()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Device", "PROGRAM Device\nVAR\nEND_VAR\n", "n := 0;\n"),
            FakeIde.Item.TextualPou("Main", "PROGRAM Main\nVAR\nEND_VAR\n", "n := 0;\n", "Device/Plc Logic/Application"));
        var baseline = RefsService.Handle(ide);
        Assert.Contains("Main.prg", baseline.Items.Keys);
        ide.UnclassifiableItems = new[] { "Device" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Empty(fetch.Removed);
        Assert.Empty(refs.Removed);
        Assert.Equal(new[] { "Device" }, refs.Unreadable);
    }

    /// <summary>The CODESYS walk's own children-enumeration failure at the root and an unclassifiable root object
    /// speak ONE root spelling, and it covers the whole project.</summary>
    [Fact]
    public void An_unwalkable_root_reports_nothing_removed_anywhere()
    {
        var ide = Project();
        var baseline = RefsService.Handle(ide);
        ide.UnwalkableFolders = new[] { "" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Empty(fetch.Removed);
    }

    /// <summary>The ITEM-NAME INVARIANT holds for objects the walk cannot classify too: <c>CM_Carrier</c> the FB and
    /// <c>CM_Carrier</c> the visualization are TWO objects (a real customer project ships such pairs). Keyed by their
    /// bare name they collapsed into one version entry, so deleting either left <c>projectVersion</c> unchanged and
    /// <c>volt pull</c> said "already up to date" over a real deletion.</summary>
    [Fact]
    public void Two_unclassifiable_objects_with_one_name_are_two_objects_in_the_project_version()
    {
        FakeIde Ide(bool both)
        {
            var items = new List<FakeIde.Item>
            {
                FakeIde.Item.TextualPou("CM_Carrier", "FUNCTION_BLOCK CM_Carrier\nVAR\nEND_VAR\n", "", "Modules"),
                FakeIde.Item.TextualPou("Other", "PROGRAM Other\nVAR\nEND_VAR\n", "n := 0;\n"),
            };
            if (both) items.Add(FakeIde.Item.TextualPou("CM_Carrier", "PROGRAM CM_Carrier\nVAR\nEND_VAR\n", "n := 0;\n", "Visu"));
            return new FakeIde(items.ToArray()) { UnclassifiableItems = new[] { "CM_Carrier" } };
        }

        var withBoth = RefsService.Handle(Ide(both: true));
        var withOne = RefsService.Handle(Ide(both: false));

        Assert.Equal(new[] { "CM_Carrier", "CM_Carrier" }, withBoth.Unreadable);
        Assert.NotEqual(withOne.ProjectVersion, withBoth.ProjectVersion);
    }

    /// <summary>An UPDATE of an object that has since become unclassifiable is refused AS unreadable, by name — never
    /// a stale-version conflict quoting the sentinel. "Pull and merge" cannot help: the object stays unreadable and
    /// no fetch ever sends it.</summary>
    [Fact]
    public void An_update_of_an_object_that_cannot_be_classified_is_refused_as_unreadable()
    {
        var ide = Project();
        var v = RefsService.Handle(ide).Items["SER_OperationModeType.prg"];
        ide.UnclassifiableItems = new[] { "SER_OperationModeType" };

        var push = PushService.Handle(ide, new PushRequest
        {
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "SER_OperationModeType.prg", SourceText = Prg("SER_OperationModeType"), IfVersion = v },
            },
        });

        Assert.False(push.Accepted);
        var c = Assert.Single(push.Conflicts!);
        Assert.Equal(("SER_OperationModeType.prg", BridgeErrorCodes.Unreadable, (string?)null),
                     (c.Name, c.Code, c.CurrentVersion));
    }

    /// <summary>A CREATE that would land on the bare name of an unclassifiable object is refused as unreadable too —
    /// its kind is unknown, so the new item may be that very object — and the refusal never carries the sentinel.</summary>
    [Fact]
    public void A_create_on_the_name_of_an_object_that_cannot_be_classified_is_refused_as_unreadable()
    {
        var ide = Project();
        ide.UnclassifiableItems = new[] { "SER_OperationModeType" };

        var push = PushService.Handle(ide, new PushRequest
        {
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "SER_OperationModeType.fb", ToFolder = "Data", IfVersion = null,
                                SourceText = "FUNCTION_BLOCK SER_OperationModeType\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n" },
            },
        });

        Assert.False(push.Accepted);
        var c = Assert.Single(push.Conflicts!);
        Assert.Equal((BridgeErrorCodes.Unreadable, (string?)null), (c.Code, c.CurrentVersion));
        Assert.Contains("SER_OperationModeType", c.Reason);
    }
}
