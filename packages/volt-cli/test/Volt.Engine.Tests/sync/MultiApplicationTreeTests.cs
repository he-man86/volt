using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY APPLICATION OF A PROJECT, EACH ITEM UNDER ITS OWN PATH (openspec <c>multi-application-tree</c>).
///
/// <para>Measured 2026-10-17 on the owner's two-device CODESYS project: both devices hold an application with
/// <c>PLC_PRG</c>, <c>MainTask</c> and the same POUs, and the pull put every name ONCE — Device_1's — while Device's
/// application kept only its Library Manager; a push wrote one of each pair. The wire keyed an item by its full name
/// (<c>name.kind</c>) and never by where it lives. The identity is now its PATH in the IDE's own tree
/// (<c>VersionedItem.Identity</c>), so two <c>PLC_PRG.pou</c> in two applications are two items in every map, and a
/// push resolves an op in the folder its path names and nowhere else.</para>
///
/// <para>The fake holds the CODESYS shape: two devices, each <c>Plc Logic/Application</c>, the same names in both.</para>
/// </summary>
public class MultiApplicationTreeTests
{
    private const string AppA = "Device/Plc Logic/Application";
    private const string AppB = "Device_1/Plc Logic/Application";

    private static string Prg(string body) => $"PROGRAM PLC_PRG\nVAR\nEND_VAR\nIMPLEMENTATION ST\n{body}\nEND_PROGRAM\n";

    private static FakeIde TwoDevices()
    {
        var ide = new FakeIde(
            new FakeIde.Item("Device", ItemKind.PlcDevice, "Device", true, "Device: Device", null, null, null),
            new FakeIde.Item("Device_1", ItemKind.PlcDevice, "Device_1", true, "Device: Device_1", null, null, null),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "a := 1;", AppA),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "b := 2;", AppB),
            FakeIde.Item.TextualPou("FB_Shared", "FUNCTION_BLOCK FB_Shared\nVAR\nEND_VAR", "x := 1;", AppA + "/POUs"),
            FakeIde.Item.TextualPou("FB_Shared", "FUNCTION_BLOCK FB_Shared\nVAR\nEND_VAR", "x := 2;", AppB + "/POUs"),
            FakeIde.Item.TextualPou("GVL_Pool", "VAR_GLOBAL\nEND_VAR", "", ""));
        ide.ContainerKinds["Device"] = ItemKind.Device;
        ide.ContainerKinds["Device_1"] = ItemKind.Device;
        ide.ContainerKinds["Device/Plc Logic"] = ItemKind.PlcLogic;
        ide.ContainerKinds["Device_1/Plc Logic"] = ItemKind.PlcLogic;
        ide.ContainerKinds[AppA] = ItemKind.Application;
        ide.ContainerKinds[AppB] = ItemKind.Application;
        return ide;
    }

    [Fact]
    public void Refs_holds_every_item_of_every_application_under_its_own_path()
    {
        var refs = RefsService.Handle(TwoDevices());

        Assert.Contains($"{AppA}/PLC_PRG.pou", refs.Items.Keys);
        Assert.Contains($"{AppB}/PLC_PRG.pou", refs.Items.Keys);
        Assert.Contains($"{AppA}/POUs/FB_Shared.pou", refs.Items.Keys);
        Assert.Contains($"{AppB}/POUs/FB_Shared.pou", refs.Items.Keys);
        Assert.Contains("GVL_Pool.gvl", refs.Items.Keys);
        Assert.Contains("Device/Device.device", refs.Items.Keys);
        Assert.Contains("Device_1/Device_1.device", refs.Items.Keys);
        // The two programs differ, and each path carries its own version.
        Assert.NotEqual(refs.Items[$"{AppA}/PLC_PRG.pou"], refs.Items[$"{AppB}/PLC_PRG.pou"]);
        // The applications are STATED, never parsed out of a vendor segment.
        Assert.Equal(new[] { AppA, AppB }, refs.Applications.OrderBy(a => a, System.StringComparer.Ordinal));
    }

    [Fact]
    public void A_pull_holds_each_application_s_own_text()
    {
        var f = FetchService.Handle(TwoDevices(), new FetchRequest { Init = true });
        var text = f.Changed.ToDictionary(c => c.Name, c => c.SourceText);

        Assert.Contains("a := 1;", text[$"{AppA}/PLC_PRG.pou"]);
        Assert.Contains("b := 2;", text[$"{AppB}/PLC_PRG.pou"]);
        Assert.Equal(new[] { AppA, AppB }, f.Applications.OrderBy(a => a, System.StringComparer.Ordinal));
    }

    [Fact]
    public void A_directed_read_answers_the_path_it_names_and_not_its_twin()
    {
        var f = FetchService.Handle(TwoDevices(), new FetchRequest { OnlyItems = new List<string> { $"{AppB}/PLC_PRG.pou" } });

        var only = Assert.Single(f.Changed);
        Assert.Equal($"{AppB}/PLC_PRG.pou", only.Name);
        Assert.Contains("b := 2;", only.SourceText);
    }

    [Fact]
    public void A_push_to_each_path_lands_in_that_application_only()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = $"{AppA}/PLC_PRG.pou", SourceText = Prg("a := 10;"), IfVersion = refs.Items[$"{AppA}/PLC_PRG.pou"] },
                new SetItemOp { Name = $"{AppB}/PLC_PRG.pou", SourceText = Prg("b := 20;"), IfVersion = refs.Items[$"{AppB}/PLC_PRG.pou"] },
            },
        });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Name}: {c.Reason}")));
        var back = FetchService.Handle(ide, new FetchRequest { Init = true }).Changed.ToDictionary(c => c.Name, c => c.SourceText);
        Assert.Contains("a := 10;", back[$"{AppA}/PLC_PRG.pou"]);
        Assert.DoesNotContain("b := 20;", back[$"{AppA}/PLC_PRG.pou"]);
        Assert.Contains("b := 20;", back[$"{AppB}/PLC_PRG.pou"]);
        Assert.DoesNotContain("a := 10;", back[$"{AppB}/PLC_PRG.pou"]);
    }

    [Fact]
    public void A_stale_version_on_one_application_s_item_names_that_path_and_quotes_its_own_version()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            Ops = new List<PushOp> { new SetItemOp { Name = $"{AppB}/PLC_PRG.pou", SourceText = Prg("b := 3;"), IfVersion = refs.Items[$"{AppA}/PLC_PRG.pou"] } },
        });

        Assert.False(res.Landed());
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal($"{AppB}/PLC_PRG.pou", conflict.Name);
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.Equal(refs.Items[$"{AppB}/PLC_PRG.pou"], conflict.CurrentVersion);
    }

    [Fact]
    public void A_delete_of_one_path_deletes_that_item_and_leaves_its_twin()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = $"{AppA}/POUs/FB_Shared.pou", IfVersion = refs.Items[$"{AppA}/POUs/FB_Shared.pou"] } },
        });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Name}: {c.Reason}")));
        Assert.Equal(new[] { $"{AppA}/POUs/FB_Shared.pou" }, res.Removed);
        Assert.Empty(res.NewItems);
        Assert.Contains($"{AppB}/POUs/FB_Shared.pou", RefsService.Handle(ide).Items.Keys);   // its twin stays
    }

    [Fact]
    public void A_create_lands_in_the_folder_its_path_names_beside_a_twin_of_the_same_name()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);
        var fb = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n";

        var first = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = $"{AppA}/POUs/FB_New.pou", SourceText = fb } },
        });
        Assert.True(first.Landed(), string.Join("; ", (first.Conflicts ?? new()).Select(c => $"{c.Name}: {c.Reason}")));

        // The same name in the OTHER application is a create too, not a collision with the first.
        var second = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = first.NewProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = $"{AppB}/POUs/FB_New.pou", SourceText = fb } },
        });
        Assert.True(second.Landed(), string.Join("; ", (second.Conflicts ?? new()).Select(c => $"{c.Name}: {c.Code} {c.Reason}")));
        Assert.Equal(new[] { $"{AppB}/POUs/FB_New.pou" }, second.NewItems.Keys);
        Assert.Contains($"{AppA}/POUs/FB_New.pou", RefsService.Handle(ide).Items.Keys);   // the first create stays
    }

    [Fact]
    public void A_move_within_one_application_relocates_the_item()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = $"{AppB}/POUs/FB_Shared.pou", To = $"{AppB}/Lib/FB_Shared.pou", IfVersion = refs.Items[$"{AppB}/POUs/FB_Shared.pou"] },
            },
        });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Name}: {c.Reason}")));
        Assert.Equal(new[] { $"{AppB}/Lib/FB_Shared.pou" }, res.NewItems.Keys);
        Assert.Equal(new[] { $"{AppB}/POUs/FB_Shared.pou" }, res.Removed);
        Assert.Contains($"{AppA}/POUs/FB_Shared.pou", RefsService.Handle(ide).Items.Keys);   // its twin stays
    }

    /// <summary>Design §5: a move pairs only within one application; to another it is a delete and a create, which the
    /// client sends as two ops. A `to` in another application is refused by name, before anything lands.</summary>
    [Fact]
    public void A_move_into_another_application_is_refused_by_name()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = $"{AppA}/PLC_PRG.pou", To = $"{AppB}/Moved/PLC_PRG.pou", IfVersion = refs.Items[$"{AppA}/PLC_PRG.pou"] },
            },
        });

        Assert.False(res.Landed());
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("another application", conflict.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move:", System.StringComparison.Ordinal));
    }

    /// <summary>The POU pool counts as its own application (design §5).</summary>
    [Fact]
    public void A_move_between_the_pool_and_an_application_is_refused_by_name()
    {
        var ide = TwoDevices();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "GVL_Pool.gvl", To = $"{AppA}/GVL_Pool.gvl", IfVersion = refs.Items["GVL_Pool.gvl"] } },
        });

        Assert.False(res.Landed());
        Assert.Equal(BridgeErrorCodes.BadRequest, Assert.Single(res.Conflicts!).Code);
    }

    [Fact]
    public void An_item_deleted_in_one_application_is_removed_under_its_own_path_only()
    {
        var ide = TwoDevices();
        var read = RefsService.Handle(ide);
        var baseline = read.Items;
        ide.RemoveItem("FB_Shared", AppB + "/POUs");

        var refs = RefsService.Handle(ide, new RefsRequest { KnownApplications = read.Applications, KnownItems = baseline });
        Assert.Equal(new[] { $"{AppB}/POUs/FB_Shared.pou" }, refs.Removed);
        var fetch = FetchService.Handle(ide, new FetchRequest { KnownApplications = read.Applications, KnownItems = baseline });
        Assert.Equal(new[] { $"{AppB}/POUs/FB_Shared.pou" }, fetch.Removed);
    }

    /// <summary>ABSENCE UNDER AN UNREAD FOLDER PROVES NOTHING, outside every application too (gate review of step 3a). A
    /// known item under a folder the walk could not read is retired only as a MOVE — its file name found at another path
    /// of the same scope, where IEC makes the name unique. Outside every application nothing makes a descriptor's name
    /// unique: two devices each carry an `EtherCAT_Master` (a default name), so Device_1's walked one says nothing about
    /// Device's, which a pull must not delete.</summary>
    [Fact]
    public void A_descriptor_under_an_unread_folder_is_not_removed_because_another_device_holds_one_of_its_name()
    {
        var ide = TwoDevices();
        ide.AddItem(new FakeIde.Item("EtherCAT_Master", ItemKind.PlcDevice, "Device/EtherCAT_Master", true, "Device: EtherCAT_Master", null, null, null));
        ide.AddItem(new FakeIde.Item("EtherCAT_Master", ItemKind.PlcDevice, "Device_1/EtherCAT_Master", true, "Device: EtherCAT_Master", null, null, null));
        var read = RefsService.Handle(ide);
        var baseline = read.Items;
        Assert.Contains("Device/EtherCAT_Master/EtherCAT_Master.device", baseline.Keys);
        ide.UnwalkableFolders = new[] { "Device/EtherCAT_Master" };

        Assert.Empty(RefsService.Handle(ide, new RefsRequest { KnownApplications = read.Applications, KnownItems = baseline }).Removed);
        Assert.Empty(FetchService.Handle(ide, new FetchRequest { KnownApplications = read.Applications, KnownItems = baseline }).Removed);
    }

    /// <summary>…while inside one application an item found at another path of the SAME application is the known one,
    /// moved, and its old path is retired even though its old folder went unread.</summary>
    [Fact]
    public void An_item_moved_within_its_application_out_of_an_unread_folder_is_retired_from_its_old_path()
    {
        var ide = TwoDevices();
        var read = RefsService.Handle(ide);
        ide.RemoveItem("FB_Shared", AppB + "/POUs");
        ide.AddItem(FakeIde.Item.TextualPou("FB_Shared", "FUNCTION_BLOCK FB_Shared\nVAR\nEND_VAR", "x := 2;", AppB + "/Lib"));
        ide.UnwalkableFolders = new[] { AppB + "/POUs" };

        Assert.Equal(new[] { $"{AppB}/POUs/FB_Shared.pou" },
            FetchService.Handle(ide, new FetchRequest { KnownApplications = read.Applications, KnownItems = read.Items }).Removed);
    }

    /// <summary>AN UNREAD DEVICE HIDES ITS APPLICATION. With <c>Device_1</c> unread the walk never states
    /// <c>Device_1/Plc Logic/Application</c>, so the partial walk alone would put the known <c>FB_Util.pou</c> there in the
    /// pool namespace — and a pool POU of the name (CODESYS lets an application hold a POU the pool also holds; the
    /// application's copy wins) paired with it and retired an item the IDE still holds. The application of a known path is
    /// the one the client's baseline was read with (<c>knownApplications</c>); a client that does not know them states none
    /// (the CLI's baseline rebuilt from `volt/ide`, wire-final-shape gate 3a), and nothing under an unread folder outside
    /// every application is retired for it.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void An_item_under_an_unread_device_is_not_removed_because_the_pool_holds_one_of_its_name(bool clientStatesApplications)
    {
        var ide = TwoDevices();
        ide.AddItem(FakeIde.Item.TextualPou("FB_Util", "FUNCTION_BLOCK FB_Util\nVAR\nEND_VAR", "", AppB));
        ide.AddItem(FakeIde.Item.TextualPou("FB_Util", "FUNCTION_BLOCK FB_Util\nVAR\nEND_VAR", "", ""));
        var first = RefsService.Handle(ide);
        Assert.Contains($"{AppB}/FB_Util.pou", first.Items.Keys);
        ide.UnwalkableFolders = new[] { "Device_1" };
        var knownApplications = clientStatesApplications ? first.Applications : null;

        Assert.Empty(RefsService.Handle(ide, new RefsRequest { KnownItems = first.Items, KnownApplications = knownApplications }).Removed);
        Assert.Empty(FetchService.Handle(ide, new FetchRequest { KnownItems = first.Items, KnownApplications = knownApplications }).Removed);
    }

    /// <summary>…while a pool item moved out of an unread pool folder is retired from its old path when the client states
    /// the applications its baseline was read with: the old path lay in the pool then, and the pool is one namespace.</summary>
    [Fact]
    public void A_pool_item_moved_out_of_an_unread_pool_folder_is_retired_when_the_client_states_its_applications()
    {
        var ide = TwoDevices();
        ide.AddItem(FakeIde.Item.TextualPou("FB_Util", "FUNCTION_BLOCK FB_Util\nVAR\nEND_VAR", "", "Old"));
        var first = RefsService.Handle(ide);
        ide.RemoveItem("FB_Util", "Old");
        ide.AddItem(FakeIde.Item.TextualPou("FB_Util", "FUNCTION_BLOCK FB_Util\nVAR\nEND_VAR", "", "New"));
        ide.UnwalkableFolders = new[] { "Old" };

        Assert.Equal(new[] { "Old/FB_Util.pou" },
            FetchService.Handle(ide, new FetchRequest { KnownItems = first.Items, KnownApplications = first.Applications }).Removed);
        Assert.Empty(FetchService.Handle(ide, new FetchRequest { KnownItems = first.Items }).Removed);
    }

    /// <summary>Design §6: a diagnostic carries its item's path, so the same message in two applications is two
    /// diagnostics — each on its own application's item. A driver that names the item's folder is answered from it; one
    /// that names only the bare name of an item two applications hold is answered with no name, never a guess.</summary>
    [Fact]
    public void A_diagnostic_lands_on_its_own_application_s_item()
    {
        var ide = TwoDevicesWith(new List<BridgeDiagnostic>
        {
            new() { Name = $"{AppA}/PLC_PRG", Severity = Severity.Error, Message = "C0046: Identifier 'q' not defined" },
            new() { Name = $"{AppB}/PLC_PRG", Severity = Severity.Error, Message = "C0046: Identifier 'q' not defined" },
            new() { Name = "PLC_PRG", Severity = Severity.Error, Message = "unplaced" },
        });

        var build = BoundWrite.Build(ide, new BuildRequest());

        Assert.Equal($"{AppA}/PLC_PRG.pou", build.Diagnostics[0].Name);
        Assert.Equal($"{AppB}/PLC_PRG.pou", build.Diagnostics[1].Name);
        Assert.Null(build.Diagnostics[2].Name);
    }

    private static FakeIde TwoDevicesWith(List<BridgeDiagnostic> diagnostics)
    {
        var shape = TwoDevices();
        var ide = new FakeIde(shape.AllItems.ToArray()) { BuildSucceeds = false, BuildDiagnostics = diagnostics };
        foreach (var kv in shape.ContainerKinds) ide.ContainerKinds[kv.Key] = kv.Value;
        return ide;
    }

    /// <summary>Design §6: each application has its own Library Manager, and a signature extracted for one lands
    /// beside THAT application's `.library` — never the first application's for both.</summary>
    [Fact]
    public void Library_signatures_land_beside_their_own_application_s_library()
    {
        const string manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.17.0 (System)\n";
        var shape = TwoDevices();
        var ide = new FakeIde(shape.AllItems.Concat(new[]
        {
            FakeIde.Item.Library("Standard", manifest, AppA + "/Library Manager"),
            FakeIde.Item.Library("Standard", manifest, AppB + "/Library Manager"),
        }).ToArray());
        foreach (var kv in shape.ContainerKinds) ide.ContainerKinds[kv.Key] = kv.Value;
        LibSignature Ton(string app) => new("TON", "Standard, 3.5.17.0 (System)", "FunctionBlock",
            new List<LibVar> { new("IN", "BOOL") }, new List<LibVar> { new("Q", "BOOL") }, new List<LibVar>(), new List<LibVar>(),
            null, null, Application: app);
        ide.LibSignatures = new List<LibSignature> { Ton(AppA), Ton(AppB) };

        var f = FetchService.Handle(ide, new FetchRequest { Init = true });
        var names = f.Changed.Select(c => c.Name).ToList();

        Assert.Contains($"{AppA}/Library Manager/Standard/Standard.library", names);
        Assert.Contains($"{AppB}/Library Manager/Standard/Standard.library", names);
        Assert.Contains($"{AppA}/Library Manager/Standard/TON.pou", names);
        Assert.Contains($"{AppB}/Library Manager/Standard/TON.pou", names);
    }

    /// <summary>A signature extracted for an application that holds no `.library` claiming it is that application's to
    /// place — never ANOTHER application's: it does not land beside the first application's library as a second copy.</summary>
    [Fact]
    public void A_signature_only_another_application_claims_is_not_placed_there()
    {
        const string manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.17.0 (System)\n";
        var shape = TwoDevices();
        var ide = new FakeIde(shape.AllItems.Concat(new[] { FakeIde.Item.Library("Standard", manifest, AppA + "/Library Manager") }).ToArray());
        foreach (var kv in shape.ContainerKinds) ide.ContainerKinds[kv.Key] = kv.Value;
        LibSignature Ton(string app) => new("TON", "Standard, 3.5.17.0 (System)", "FunctionBlock",
            new List<LibVar> { new("IN", "BOOL") }, new List<LibVar> { new("Q", "BOOL") }, new List<LibVar>(), new List<LibVar>(),
            null, null, Application: app);
        ide.LibSignatures = new List<LibSignature> { Ton(AppA), Ton(AppB) };

        var f = FetchService.Handle(ide, new FetchRequest { Init = true });

        Assert.Equal(new[] { $"{AppA}/Library Manager/Standard/TON.pou" },
            f.Changed.Select(c => c.Name).Where(n => n.EndsWith("/TON.pou", System.StringComparison.Ordinal)));
    }

    /// <summary>A library in the POOL's Library Manager (the project root's, which every application sees) is claimed by
    /// that one ref from each application's extraction — and is one library: its elements land ONCE beside its
    /// `.library`, not once per application at the same path (gate review of step 3a).</summary>
    [Fact]
    public void A_pool_library_s_signatures_land_once_however_many_applications_extract_them()
    {
        const string manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.17.0 (System)\n";
        var shape = TwoDevices();
        var ide = new FakeIde(shape.AllItems.Concat(new[] { FakeIde.Item.Library("Standard", manifest, "Library Manager") }).ToArray());
        foreach (var kv in shape.ContainerKinds) ide.ContainerKinds[kv.Key] = kv.Value;
        LibSignature Ton(string app) => new("TON", "Standard, 3.5.17.0 (System)", "FunctionBlock",
            new List<LibVar> { new("IN", "BOOL") }, new List<LibVar> { new("Q", "BOOL") }, new List<LibVar>(), new List<LibVar>(),
            null, null, Application: app);
        ide.LibSignatures = new List<LibSignature> { Ton(AppA), Ton(AppB) };

        var f = FetchService.Handle(ide, new FetchRequest { Init = true });

        Assert.Equal(new[] { "Library Manager/Standard/TON.pou" },
            f.Changed.Select(c => c.Name).Where(n => n.EndsWith("/TON.pou", System.StringComparison.Ordinal)));
    }

    /// <summary>PINNED, NICHE: ACCEPTED LOSS (0 occurrences in the corpora: all six are one application each). CODESYS's
    /// precompiled set is one for the whole IDE, so an application's extraction also holds the libraries only ANOTHER
    /// application lists — and those are not this application's (the test above). The cost: a library application A
    /// uses only TRANSITIVELY (a dependency of one it lists, which lands in A's `(unresolved)` on its own) is not
    /// rendered for A once application B lists it directly — its elements sit under B's Library Manager only. The two
    /// cases are the same signature from the same global set; nothing on the wire tells them apart.</summary>
    [Fact]
    public void A_library_another_application_lists_directly_is_not_rendered_for_an_application_that_uses_it_transitively()
    {
        var shape = TwoDevices();
        var ide = new FakeIde(shape.AllItems.Concat(new[]
        {
            FakeIde.Item.Library("X", "LIBRARY X\nNAMESPACE X\nRESOLUTION X, 1.0.0.0 (Acme)\n", AppA + "/Library Manager"),
            FakeIde.Item.Library("Y", "LIBRARY Y\nNAMESPACE Y\nRESOLUTION Y, 1.0.0.0 (Acme)\n", AppB + "/Library Manager"),
        }).ToArray());
        foreach (var kv in shape.ContainerKinds) ide.ContainerKinds[kv.Key] = kv.Value;
        LibSignature Fb(string name, string lib, string app) => new(name, lib, "FunctionBlock",
            new List<LibVar>(), new List<LibVar> { new("Q", "BOOL") }, new List<LibVar>(), new List<LibVar>(),
            null, null, Application: app);
        ide.LibSignatures = new List<LibSignature>
        {
            Fb("FB_X", "X, 1.0.0.0 (Acme)", AppA), Fb("FB_Y", "Y, 1.0.0.0 (Acme)", AppA),   // A: X and its dependency Y
            Fb("FB_Y", "Y, 1.0.0.0 (Acme)", AppB),
        };

        var names = FetchService.Handle(ide, new FetchRequest { Init = true }).Changed.Select(c => c.Name).ToList();

        Assert.Contains($"{AppA}/Library Manager/X/FB_X.pou", names);
        Assert.Equal(new[] { $"{AppB}/Library Manager/Y/FB_Y.pou" },
            names.Where(n => n.EndsWith("/FB_Y.pou", System.StringComparison.Ordinal)));
    }
}
