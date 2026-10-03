using System;
using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Volt.Engine.Item;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt push` when the bridge answers ACCEPTED WITH CONFLICTS — the live IDE refused one op after others had
/// landed (openspec <c>push-keeps-what-landed</c>, task 2.4b, spec "the CLI adopts only what landed").
///
/// <para>Before this the CLI read conflicts only on <c>accepted:false</c>, and on <c>accepted:true</c> pointed
/// <c>volt/ide</c> at HEAD and adopted the receipt for every name it pushed — so a refused edit would have been marked
/// synced (<c>volt status</c> in sync while the IDE never got it). The engine answers this shape since the same change,
/// so the two land together (review R6).</para></summary>
public class PartialPushCommandTests
{
    private static FakeIde.Item Pou(string name, string impl = "x := 1;", string decl = "") =>
        FakeIde.Item.TextualPou(name, decl.Length > 0 ? decl : $"PROGRAM {name}\nVAR\nEND_VAR", impl);

    private static void Edit(string root, string file, string from, string to)
    {
        var path = Path.Combine(root, "src", file);
        var text = File.ReadAllText(path);
        Assert.Contains(from, text);
        File.WriteAllText(path, text.Replace(from, to));
    }

    /// <summary>Spec "a partially refused push": the refused op left nothing in the IDE, so after the push only its edit
    /// is outgoing, and the next push re-sends exactly it.</summary>
    [Fact]
    public void A_partly_refused_push_leaves_only_the_refused_edit_outgoing_and_the_next_push_resends_only_it()
    {
        var refuse = true;
        FakeIde ide = null!;
        ide = new FakeIde(Pou("PLC_PRG"), Pou("Z_Late"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RefuseContentWrite = item => refuse && ide.Name(item) == "Z_Late"
                ? new InvalidOperationException("the IDE could not write 'Z_Late'") : null,
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Edit(root, "PLC_PRG.pou", "x := 1;", "x := 2;");
            Edit(root, "Z_Late.pou", "x := 1;", "x := 3;");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.Equal(new[] { "PLC_PRG.pou" }, r.Items!.ToArray());
            Assert.Contains("Z_Late.pou", r.Reason);
            Assert.Contains("the IDE could not write 'Z_Late'", r.Reason);
            var status = Commands.Status(root, client);
            Assert.Equal(new[] { "Z_Late.pou" }, status.Outgoing.Modified.ToArray());
            Assert.Empty(status.Outgoing.Added);
            Assert.Equal(0, status.Incoming.Count);

            refuse = false;
            ide.Recorded.Clear();
            var again = Commands.Push(root, client);
            Assert.True(again.Kind == "ok", $"push rejected: {again.Reason}");
            Assert.Equal(new[] { "Z_Late.pou" }, again.Items!.ToArray());
            Assert.DoesNotContain(ide.Recorded, x => x.Contains("PLC_PRG"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Spec "a rename lands beside a refused op" (review R3): the IDE's native rename rewrites <c>W</c>, which
    /// references the renamed item and is in no op. Its post-rename version must enter the baseline as on a full push
    /// — "applied names only" would have left it at its old version and the next push would report a phantom conflict —
    /// while the refused <c>Z_Late</c> keeps its old one.</summary>
    [Fact]
    public void A_rename_landing_beside_a_refused_op_adopts_the_rewritten_reference_and_keeps_the_refused_item_old()
    {
        FakeIde ide = null!;
        ide = new FakeIde(
            FakeIde.Item.TextualPou("A_Motor", "FUNCTION_BLOCK A_Motor\nVAR\nEND_VAR", ";"),
            Pou("W_User", "inst();", "PROGRAM W_User\nVAR\n\tinst : A_Motor;\nEND_VAR"),
            Pou("Z_Late"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RewritesReferencesOnRename = true,
            RefuseContentWrite = item => ide.Name(item) == "Z_Late"
                ? new InvalidOperationException("the IDE could not write 'Z_Late'") : null,
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var before = Sidecar.LoadIdeRefs(root)!.Items;
            File.Move(Path.Combine(root, "src", "A_Motor.pou"), Path.Combine(root, "src", "A_Drive.pou"));
            Edit(root, "Z_Late.pou", "x := 1;", "x := 3;");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x == "rename:A_Motor->A_Drive");
            var refs = Volt.Engine.Sync.RefsService.Handle(ide);
            var after = Sidecar.LoadIdeRefs(root)!.Items;
            Assert.NotEqual(before["W_User.pou"], refs.Items["W_User.pou"]);       // premise: the IDE rewrote W_User
            Assert.Equal(refs.Items["W_User.pou"], after["W_User.pou"]);
            Assert.Equal(refs.Items["A_Drive.pou"], after["A_Drive.pou"]);
            Assert.False(after.ContainsKey("A_Motor.pou"), "the renamed-away name stayed in the baseline");
            Assert.Equal(before["Z_Late.pou"], after["Z_Late.pou"]);
            Assert.Equal(new[] { "Z_Late.pou" }, Commands.Status(root, client).Outgoing.Modified.ToArray());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Spec "the refused op partly landed" (review R4): an update whose declaration the IDE kept before a member
    /// create failed keeps its OLD baseline on purpose, so the next push is refused (<c>STALE_ITEM_VERSION</c>) instead
    /// of overwriting state nobody has seen; the push says to pull first, and after the pull the push re-sends the
    /// remaining edit.</summary>
    [Fact]
    public void A_refused_op_that_partly_landed_needs_a_pull_before_the_next_push()
    {
        var failMethod = true;
        var ide = new FakeIde(Pou("A_First"),
                              FakeIde.Item.TextualPou("K_Motor", "FUNCTION_BLOCK K_Motor\nVAR\nEND_VAR", ";"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            FailCreate = (name, kind) => failMethod && kind == ItemKind.PlcMethod
                ? new InvalidOperationException($"The name '{name}' is not valid for this object.") : null,
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var before = Sidecar.LoadIdeRefs(root)!.Items;
            Edit(root, "A_First.pou", "x := 1;", "x := 2;");
            var motor = Path.Combine(root, "src", "K_Motor.pou");
            var text = File.ReadAllText(motor).Replace("\r\n", "\n");
            Assert.Contains("VAR\nEND_VAR", text);
            File.WriteAllText(motor, text.Replace("VAR\nEND_VAR", "VAR\n\tn : INT;\nEND_VAR").TrimEnd('\n') +
                                     "\n\nMETHOD M_Go : BOOL\nIMPLEMENTATION ST\nM_Go := TRUE;\nEND_METHOD\n");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.Contains("the declaration of 'K_Motor' was written before it and stays", r.Reason);
            Assert.Contains("pull", r.Reason);   // the CLI's own advice for an op that partly landed
            Assert.Equal(before["K_Motor.pou"], Sidecar.LoadIdeRefs(root)!.Items["K_Motor.pou"]);

            failMethod = false;
            var refused = Commands.Push(root, client);
            Assert.Equal(ResultKinds.Rejected, refused.Kind);
            Assert.Contains("STALE_ITEM_VERSION", refused.Reason);

            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var resent = Commands.Push(root, client);
            Assert.True(resent.Kind == "ok", $"push rejected: {resent.Reason}");
            Assert.Equal(new[] { "K_Motor.pou" }, resent.Items!.ToArray());
            Assert.True(ide.Exists("M_Go"));
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Step 2 review (finding 3): a RENAME+EDIT refused after the native rename ran. The IDE holds the new name
    /// and not the old, so the op the CLI would re-send (`set K_Motor.pou … toName L_Drive.pou`) names an item that is
    /// gone — the advice must be to pull first, not "change it, then push again". Measured before the fix: the advice
    /// was "the IDE will not take this text", because the receipt check looked only at the OLD name, now absent.</summary>
    [Fact]
    public void A_rename_refused_after_the_rename_ran_advises_a_pull_first()
    {
        FakeIde ide = null!;
        ide = new FakeIde(Pou("A_First"),
                          FakeIde.Item.TextualPou("K_Motor",
                              "FUNCTION_BLOCK K_Motor\nVAR\n\ta : INT;\n\tb : INT;\n\tc : INT;\n\td : INT;\n\te : INT;\nEND_VAR",
                              "a := 1;\nb := 2;\nc := 3;\nd := 4;\ne := 5;"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RefuseContentWrite = item => ide.Name(item) == "L_Drive"
                ? new InvalidOperationException("the IDE could not write 'L_Drive'") : null,
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Edit(root, "A_First.pou", "x := 1;", "x := 2;");
            Edit(root, "K_Motor.pou", "e := 5;", "e := 6;");   // a rename WITH an edit: the content write follows the rename
            File.Move(Path.Combine(root, "src", "K_Motor.pou"), Path.Combine(root, "src", "L_Drive.pou"));

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.True(ide.Exists("L_Drive"), "premise: the rename ran before the refused write");
            Assert.False(ide.Exists("K_Motor"));
            Assert.Contains("'K_Motor' was renamed to 'L_Drive'", r.Reason);
            Assert.Contains("run `volt pull` first", r.Reason);
            Assert.DoesNotContain("the IDE will not take this text", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Step 2 review (finding 6): a hand LAYOUT that landed beside a refused op. A full push adopts the IDE's
    /// canonical layout, so it never comes back as an IDE change (network-text-literal-nwl, "a hand layout does not come
    /// back as an IDE change"); a partial push pinned it as "another program than the text pushed" instead, and the next
    /// pull brought a whitespace-only diff in as an IDE edit.</summary>
    [Fact]
    public void A_hand_layout_landing_beside_a_refused_op_is_adopted_and_not_reported_as_another_program()
    {
        const string canonical = "IMPLEMENTATION LD\nNETWORK\n  t1(IN := a, PT := pt);\nEND_NETWORK";
        var refuse = true;
        FakeIde ide = null!;
        ide = new FakeIde(
            new FakeIde.Item("A_Prg", ItemKind.PlcPou, "", true,
                             "PROGRAM A_Prg\nVAR\n  t1 : TON;\n  a : BOOL;\n  pt : TIME;\nEND_VAR", canonical, "LD", null),
            Pou("Z_Late"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RefuseContentWrite = item => refuse && ide.Name(item) == "Z_Late"
                ? new InvalidOperationException("the IDE could not write 'Z_Late'") : null,
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var path = Path.Combine(root, "src", "A_Prg.pou");
            var pulled = File.ReadAllText(path).Replace("\r\n", "\n");
            Assert.Contains(canonical, pulled);
            File.WriteAllText(path, pulled.Replace("  t1(IN := a, PT := pt);", "  t1(\n    IN := a,\n    PT := pt\n  );"));
            Edit(root, "Z_Late.pou", "x := 1;", "x := 3;");

            var r = Commands.Push(root, client);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.DoesNotContain("as another program", r.Reason);
            Assert.Equal(pulled, File.ReadAllText(path).Replace("\r\n", "\n"));   // the IDE's layout, adopted
            Assert.Equal(new[] { "Z_Late.pou" }, Commands.Status(root, client).Outgoing.Modified.ToArray());
            var pull = Commands.Pull(root, client);
            Assert.Equal("ok", pull.Kind);
            Assert.DoesNotContain("A_Prg.pou", pull.Synced!);

            refuse = false;
            var again = Commands.Push(root, client);
            Assert.True(again.Kind == "ok", $"push rejected: {again.Reason}");
            Assert.Equal(new[] { "Z_Late.pou" }, again.Items!.ToArray());
            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Gate step 2, round 2 (finding 4): a forced replace of an item the IDE will not open DELETES the original
    /// before its create — and when the create fails the original is gone, which the bridge's reason says. The CLI's
    /// advice must not contradict it: before the fix it answered "nothing of it landed" (the item is in neither the
    /// baseline — it was never readable — nor the receipt, so the receipt check read it as untouched).</summary>
    [Fact]
    public void A_forced_replace_whose_create_fails_is_not_advised_as_nothing_landed()
    {
        var failCreate = false;
        var ide = new FakeIde(Pou("A_First"), Pou("Broken"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            FailCreate = (name, _) => failCreate && name == "Broken"
                ? new InvalidOperationException("the IDE could not create 'Broken'") : null,
        };
        ide.UnopenedItems.Add("Broken");
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.False(File.Exists(Path.Combine(root, "src", "Broken.pou")), "premise: an unopened item is not materialized");
            Edit(root, "A_First.pou", "x := 1;", "x := 2;");
            File.WriteAllText(Path.Combine(root, "src", "Broken.pou"), "PROGRAM Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 5;\nEND_PROGRAM\n");
            failCreate = true;

            var r = Commands.Push(root, client, force: true);

            Assert.True(r.Kind == ResultKinds.Partial, $"expected a partial push, got {r.Kind}: {r.Reason}");
            Assert.False(ide.Exists("Broken"), "premise: the replace deleted the original before its create failed");
            Assert.Contains("the IDE's 'Broken' was deleted before it", r.Reason);
            Assert.DoesNotContain("nothing of it landed", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Gate step 2, round 2 (finding 5): THE REF FIRST, THEN THE SIDECAR, THEN THE WORKING TREE — on a partial
    /// push too. It fast-forwarded the workspace onto the IDE's layout commit BEFORE writing volt/ide and the sidecar, so a
    /// failure in that gap left HEAD on the layout commit with the old volt/ide and baseline. The fast-forward is made to
    /// fail here (the index is locked once the push reaches the bridge): volt/ide and the sidecar must already hold what
    /// landed.</summary>
    [Fact]
    public void A_partial_push_writes_the_ide_ref_and_the_baseline_before_it_moves_the_working_tree()
    {
        const string canonical = "IMPLEMENTATION LD\nNETWORK\n  t1(IN := a, PT := pt);\nEND_NETWORK";
        FakeIde ide = null!;
        ide = new FakeIde(
            new FakeIde.Item("A_Prg", ItemKind.PlcPou, "", true,
                             "PROGRAM A_Prg\nVAR\n  t1 : TON;\n  a : BOOL;\n  pt : TIME;\nEND_VAR", canonical, "LD", null),
            Pou("B_Other"), Pou("Z_Late"))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            RefuseContentWrite = item => ide.Name(item) == "Z_Late"
                ? new InvalidOperationException("the IDE could not write 'Z_Late'") : null,
        };
        var (root, host, client) = Bound(ide);
        var indexLock = Path.Combine(root, ".git", "index.lock");
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var gitDir = Path.Combine(root, ".git");
            var refBefore = IdeTree.VoltIdeHead(gitDir);
            var otherBefore = Sidecar.LoadIdeRefs(root)!.Items["B_Other.pou"];
            var path = Path.Combine(root, "src", "A_Prg.pou");
            var pulled = File.ReadAllText(path).Replace("\r\n", "\n");
            File.WriteAllText(path, pulled.Replace("  t1(IN := a, PT := pt);", "  t1(\n    IN := a,\n    PT := pt\n  );"));
            Edit(root, "B_Other.pou", "x := 1;", "x := 2;");   // lands, and changes its version in the baseline
            Edit(root, "Z_Late.pou", "x := 1;", "x := 3;");
            ide.OnWalkItems = () => File.WriteAllText(indexLock, "");   // after the auto-commit: the push is at the bridge

            var threw = Record.Exception(() => Commands.Push(root, client));
            ide.OnWalkItems = null;
            File.Delete(indexLock);

            Assert.NotNull(threw);   // premise: the working-tree fast-forward failed
            Assert.NotEqual(refBefore, IdeTree.VoltIdeHead(gitDir));
            var otherNow = Volt.Engine.Sync.RefsService.Handle(ide).Items["B_Other.pou"];
            Assert.NotEqual(otherBefore, otherNow);   // premise: B_Other landed
            Assert.Equal(otherNow, Sidecar.LoadIdeRefs(root)!.Items["B_Other.pou"]);
        }
        finally { if (File.Exists(indexLock)) File.Delete(indexLock); host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
