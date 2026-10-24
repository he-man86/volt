using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Wire;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE WIRE'S FINAL SHAPE, as a client meets it over the pipe (openspec <c>wire-final-shape</c> 3.3–3.5, design
/// sections 2–5): health states the bridge's catalog and leaves unstated facts out, a project name is compared like a
/// path, every unreadable entry carries a code, a baseline carries its applications, and a push answer is enough to
/// update a baseline — the lease an error frame with the IDE's version, every op that did not land named.
/// </summary>
public class WireFinalShapeTests
{
    private const string Prg = "PROGRAM {0}\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := {1};\nEND_PROGRAM\n";

    private static FakeIde Project() => new(
        FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("B", "PROGRAM B\nVAR\nEND_VAR", "x := 2;", "POUs"));

    private static (BridgePipeHost Host, PipeClient Client) Serve(FakeIde ide)
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        return (host, new PipeClient(pipe));
    }

    private static object Bound(object body)
    {
        var json = JsonSerializer.SerializeToNode(body)!.AsObject();
        json["expectedPlatform"] = "codesys";
        json["expectedProjectName"] = "FakeProject";
        return json;
    }

    // ── section 2: health ──

    [Theory]
    [InlineData(true, new[] { "FBD", "LD", "ST" })]
    [InlineData(false, new[] { "ST" })]
    public void Health_lists_the_languages_the_bridge_shows_as_the_network_text_switch_leaves_them(bool graphical, string[] shown)
    {
        var was = Volt.Engine.Format.Network.NetworkTextSwitch.Enabled;
        var (host, client) = Serve(Project());
        using (host)
        {
            try
            {
                Volt.Engine.Format.Network.NetworkTextSwitch.Enabled = graphical;
                var health = client.Call(Ops.Health);
                Assert.Equal(shown, health.GetProperty("languages").EnumerateArray().Select(l => l.GetString()));
                Assert.False(health.TryGetProperty("networkText", out _));
            }
            finally { Volt.Engine.Format.Network.NetworkTextSwitch.Enabled = was; }
        }
    }

    [Fact]
    public void Health_lists_every_kind_with_a_file_and_whether_a_push_writes_it()
    {
        var (host, client) = Serve(Project());
        using (host)
        {
            var kinds = client.Call(Ops.Health).GetProperty("kinds").EnumerateArray()
                .ToDictionary(k => k.GetProperty("extension").GetString()!, k => k.GetProperty("writable").GetBoolean());

            Assert.Equal(kinds.Keys.OrderBy(k => k, StringComparer.Ordinal), kinds.Keys);
            Assert.All(new[] { "pou", "dut", "gvl", "itf", "task" }, x => Assert.True(kinds[x], x));
            Assert.All(new[] { "device", "library", "projectsettings" }, x => Assert.False(kinds[x], x));
            Assert.DoesNotContain(kinds.Keys, k => k.StartsWith(".", StringComparison.Ordinal));
            Assert.DoesNotContain("method", kinds.Keys);   // a member is no file
        }
    }

    [Fact]
    public void A_row_whose_dirty_the_IDE_did_not_state_carries_none()
    {
        var ide = Project();
        ide.Projects.Add(new ProjectEntry("codesys", "FakeProject", HealthStatus.Healthy, Dirty: null));
        ide.Projects.Add(new ProjectEntry("codesys", "Other", HealthStatus.Idle, Dirty: true));
        var (host, client) = Serve(ide);
        using (host)
        {
            var rows = client.Call(Ops.Health).GetProperty("projects").EnumerateArray().ToList();

            Assert.False(rows[0].TryGetProperty("dirty", out _));
            Assert.True(rows[1].GetProperty("dirty").GetBoolean());
            Assert.All(rows, r => Assert.False(r.TryGetProperty("version", out _)));
        }
    }

    // ── section 3: connect, and a project name compared like a path ──

    [Fact]
    public void A_project_name_is_matched_ignoring_case_like_a_path()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            Assert.Empty(client.Call(Ops.Connect, new { project = "FAKEPROJECT" }).EnumerateObject());
            var refs = client.Call(Ops.Refs, new { expectedPlatform = "codesys", expectedProjectName = "fakeproject" });
            Assert.Equal("FakeProject", refs.GetProperty("projectName").GetString());   // answered in the IDE's spelling
        }
    }

    // ── section 4: refs / fetch ──

    [Fact]
    public void Every_unreadable_entry_carries_its_code()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("Broken", "PROGRAM Broken\nVAR\nEND_VAR", ";", "Data"),
            FakeIde.Item.TextualPou("Unknown", "PROGRAM Unknown\nVAR\nEND_VAR", ";", "Other"));
        ide.UnopenedItems.Add("Broken");
        ide.UnclassifiableItems = new[] { "Unknown" };
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = client.Call(Ops.Refs);
            var item = Assert.Single(refs.GetProperty("unreadable").EnumerateArray().ToList());
            Assert.Equal("Data/Broken.pou", item.GetProperty("name").GetString());
            Assert.Equal(BridgeErrorCodes.Unreadable, item.GetProperty("code").GetString());
            var node = Assert.Single(refs.GetProperty("unreadableNodes").EnumerateArray().ToList());
            Assert.Equal(BridgeErrorCodes.Unreadable, node.GetProperty("code").GetString());
        }
    }

    /// <summary>A baseline whose applications the client does not know is SERVED, not refused (gate 3a, finding 2): the
    /// CLI's recovery pull rebuilds its baseline from the `volt/ide` tree, which states no application, and the only
    /// honest statement it can make is none. Requiring `knownApplications` made it claim `[]` — "the read stated no
    /// application" — which places a path an unread device hides in the pool.</summary>
    [Theory]
    [InlineData(Ops.Refs)]
    [InlineData(Ops.Fetch)]
    public void A_baseline_without_its_applications_is_served(string op)
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            client.Call(op, new { knownItems = new Dictionary<string, string>() });
            Assert.Equal(1, ide.WalkCalls);
        }
    }

    // ── section 5: push ──

    /// <summary>The spec's scenario: a rename's receipt holds the new path in <c>newItems</c> and the old in
    /// <c>removed</c>, so a baseline is updated without a second read.</summary>
    [Fact]
    public void A_rename_answers_the_new_path_in_newItems_and_the_old_in_removed()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = RefsService.Handle(ide);
            var push = client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = refs.ProjectVersion,
                ops = new object[] { new { op = "set", name = "POUs/B.pou", to = "POUs/C.pou", ifVersion = refs.Items["POUs/B.pou"] } },
            }));

            var after = RefsService.Handle(ide);
            Assert.Equal(after.ProjectVersion, push.GetProperty("newProjectVersion").GetString());
            var newItems = push.GetProperty("newItems").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString());
            Assert.Equal(new[] { "POUs/C.pou" }, newItems.Keys);
            Assert.Equal(after.Items["POUs/C.pou"], newItems["POUs/C.pou"]);
            Assert.Equal(new[] { "POUs/B.pou" }, push.GetProperty("removed").EnumerateArray().Select(r => r.GetString()));
            Assert.Equal(0, push.GetProperty("conflicts").GetArrayLength());
            Assert.False(push.TryGetProperty("accepted", out _));
            Assert.False(push.TryGetProperty("currentProjectVersion", out _));

            // The baseline the client builds from the receipt is the IDE's: `baseline − removed + newItems`.
            var baseline = new Dictionary<string, string>(refs.Items);
            foreach (var r in push.GetProperty("removed").EnumerateArray()) baseline.Remove(r.GetString()!);
            foreach (var (path, version) in newItems) baseline[path] = version!;
            Assert.Equal(after.Items.OrderBy(k => k.Key), baseline.OrderBy(k => k.Key));
        }
    }

    [Fact]
    public void A_delete_answers_its_path_in_removed()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = RefsService.Handle(ide);
            var push = client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = refs.ProjectVersion,
                ops = new object[] { new { op = "deleteItem", name = "A.pou", ifVersion = refs.Items["A.pou"] } },
            }));

            Assert.Equal(new[] { "A.pou" }, push.GetProperty("removed").EnumerateArray().Select(r => r.GetString()));
            Assert.Empty(push.GetProperty("newItems").EnumerateObject());
        }
    }

    [Fact]
    public void A_stale_lease_is_the_error_frame_carrying_the_IDEs_project_version()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var current = RefsService.Handle(ide).ProjectVersion;
            var ex = Assert.Throws<PipeCallException>(() => client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = "0000000000000000",
                ops = new object[] { new { op = "set", name = "N.pou", sourceText = string.Format(Prg, "N", 1) } },
            })));

            Assert.Equal(BridgeErrorCodes.StaleProjectVersion, ex.Code);
            Assert.Equal(current, ex.ErrorData!.Value.GetProperty("currentProjectVersion").GetString());
            Assert.False(ide.Exists("N"));
        }
    }

    /// <summary>A refusal before the first write lands nothing: the refused op has its code, every other op is
    /// NOT_ATTEMPTED, and there is no <c>newProjectVersion</c> — the one rule a client reads.</summary>
    [Fact]
    public void A_refusal_before_the_first_write_names_every_other_op_not_attempted_and_lands_nothing()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = RefsService.Handle(ide);
            var push = client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = refs.ProjectVersion,
                ops = new object[]
                {
                    new { op = "set", name = "N.pou", sourceText = string.Format(Prg, "N", 1) },
                    new { op = "set", name = "Bad.pou", sourceText = "not a POU at all" },
                },
            }));

            Assert.False(push.TryGetProperty("newProjectVersion", out _));
            var conflicts = push.GetProperty("conflicts").EnumerateArray()
                .ToDictionary(c => c.GetProperty("name").GetString()!, c => c.GetProperty("code").GetString());
            Assert.Equal(BridgeErrorCodes.InvalidSt, conflicts["Bad.pou"]);
            Assert.Equal(ConflictCodes.NotAttempted, conflicts["N.pou"]);
            Assert.Empty(push.GetProperty("newItems").EnumerateObject());
            Assert.Empty(push.GetProperty("removed").EnumerateArray());
            Assert.False(ide.Exists("N"));
        }
    }

    /// <summary>A conflict's <c>name</c> is its op's; the item it collides with is <c>existing</c>.</summary>
    [Fact]
    public void A_rename_onto_a_held_path_names_the_op_and_the_item_it_collides_with()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = RefsService.Handle(ide);
            var push = client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = refs.ProjectVersion,
                ops = new object[] { new { op = "set", name = "A.pou", to = "POUs/B.pou", ifVersion = refs.Items["A.pou"] } },
            }));

            var conflict = Assert.Single(push.GetProperty("conflicts").EnumerateArray().ToList());
            Assert.Equal("A.pou", conflict.GetProperty("name").GetString());
            Assert.Equal(ConflictCodes.ItemExists, conflict.GetProperty("code").GetString());
            Assert.Equal("POUs/B.pou", conflict.GetProperty("existing").GetString());
            Assert.Equal(refs.Items["POUs/B.pou"], conflict.GetProperty("currentVersion").GetString());
        }
    }

    /// <summary>A create onto a path it holds itself names no <c>existing</c>: the colliding item is the op's own.</summary>
    [Fact]
    public void A_create_onto_its_own_held_path_names_no_existing()
    {
        var ide = Project();
        var (host, client) = Serve(ide);
        using (host)
        {
            var refs = RefsService.Handle(ide);
            var push = client.Call(Ops.Push, Bound(new
            {
                expectedProjectVersion = refs.ProjectVersion,
                ops = new object[] { new { op = "set", name = "A.pou", sourceText = string.Format(Prg, "A", 3) } },
            }));

            var conflict = Assert.Single(push.GetProperty("conflicts").EnumerateArray().ToList());
            Assert.Equal(ConflictCodes.ItemExists, conflict.GetProperty("code").GetString());
            Assert.False(conflict.TryGetProperty("existing", out _));
        }
    }

    // ── gate 3a: the receipt is the push's own delta, in every mode ──

    /// <summary>A CASE-ONLY RENAME IS A RENAME, and a held key is exact: the receipt names the old spelling in
    /// <c>removed</c> and the new in <c>newItems</c>, so `baseline − removed + newItems` holds ONE entry for the item.</summary>
    [Fact]
    public void A_case_only_rename_answers_the_old_spelling_in_removed()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("foo", "PROGRAM foo\nVAR\nEND_VAR", "x := 1;", "Folder"));
        var refs = RefsService.Handle(ide);

        var push = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Folder/foo.pou", To = "Folder/Foo.pou", IfVersion = refs.Items["Folder/foo.pou"] } },
        });

        Assert.Empty(push.Conflicts);
        Assert.Equal(new[] { "Folder/foo.pou" }, push.Removed);
        Assert.Equal(new[] { "Folder/Foo.pou" }, push.NewItems.Keys);
        var baseline = new Dictionary<string, string>(refs.Items, StringComparer.Ordinal);
        foreach (var r in push.Removed) baseline.Remove(r);
        foreach (var (path, version) in push.NewItems) baseline[path] = version;
        Assert.Equal(RefsService.Handle(ide).Items.OrderBy(k => k.Key, StringComparer.Ordinal),
                     baseline.OrderBy(k => k.Key, StringComparer.Ordinal));
    }

    /// <summary><c>newItems</c> DOES NOT DEPEND ON <c>returnSources</c>: an item the IDE changed beside the push (here
    /// between the pre-apply walk and the receipt) is the next read's in both modes, and <c>newSources</c> carries no
    /// text for an item <c>newItems</c> does not name.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void An_item_the_IDE_changed_beside_the_push_is_in_newItems_in_neither_mode(bool returnSources)
    {
        var ide = Project();
        var refs = RefsService.Handle(ide);
        var walks = 0;
        ide.OnWalkItems = () => { if (++walks == 2) ide.EditImplementation("B", "x := 9;"); };

        var push = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            ReturnSources = returnSources,
            Ops = new List<PushOp> { new SetItemOp { Name = "A.pou", IfVersion = refs.Items["A.pou"], SourceText = string.Format(Prg, "A", 5) } },
        });

        Assert.Equal(2, walks);
        Assert.Empty(push.Conflicts);
        Assert.Equal(new[] { "A.pou" }, push.NewItems.Keys);
        Assert.Empty(push.Removed);
        if (returnSources) Assert.Equal(new[] { "A.pou" }, push.NewSources!.Keys);
    }

    /// <summary>A PARTLY-LANDED FIRST OP'S PATH THE RECEIPT COULD NOT SEE IS UNSEEN, NOT GONE: with the receipt walk unable
    /// to enumerate the item's folder, the answer names that folder in <c>unwalkedFolders</c> and does not claim the item
    /// in <c>removed</c> — a client applying `baseline − removed + newItems` keeps it.</summary>
    [Fact]
    public void A_partly_landed_op_under_a_folder_the_receipt_could_not_read_is_not_removed()
    {
        FakeIde ide = null!;
        ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";", "Dir"))
        {
            FailCreate = (name, kind) =>
            {
                if (kind != ItemKind.PlcMethod) return null;
                ide.UnwalkableFolders = new[] { "Dir" };
                return new InvalidOperationException($"The name '{name}' is not valid for this object.");
            },
        };
        var refs = RefsService.Handle(ide);

        var push = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "Dir/K.pou", IfVersion = refs.Items["Dir/K.pou"],
                    SourceText = "FUNCTION_BLOCK K\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n\n" +
                                 "METHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n",
                },
            },
        });

        var c = Assert.Single(push.Conflicts);
        Assert.True(c.PartiallyApplied);
        Assert.Contains("Dir", push.UnwalkedFolders);
        Assert.DoesNotContain("Dir/K.pou", push.Removed);
    }
}
