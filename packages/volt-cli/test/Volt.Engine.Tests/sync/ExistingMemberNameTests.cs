using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// AN EXISTING MEMBER IS NEVER REFUSED BY ITS NAME (openspec <c>codesys-existing-unicode-members</c>, PLC Assist chat
/// be8c6faa). The name pre-flight (<c>ICodeStore.RefusedName</c>) judges what the push would CREATE: a member the IDE
/// already holds under the item — same kind, same name — is written through, never created, so its name is the IDE's
/// own. It asked every member, on an update too, on the premise that "an existing member can not hold a word its IDE
/// refuses to create"; a Chinese project disproved it — every write to a POU holding a CJK method was refused, though
/// nothing was being created. The live twin: <c>test/e2e/items/unicode-members.test.ts</c>.
/// </summary>
public class ExistingMemberNameTests
{
    /// <summary>A driver refusing every name that is no ASCII identifier, and the word <c>Log</c> — what the CODESYS
    /// driver answered before this change (the shape of the field refusal).</summary>
    private static FakeIde RefusingNonAscii(params FakeIde.Item[] items) => new(items)
    {
        RefusesName = (_, name) =>
            string.Equals(name, "Log", System.StringComparison.OrdinalIgnoreCase) || name.Any(c => c > 0x7f)
                ? $"the IDE does not take '{name}' as a name" : null,
    };

    private const string Decl = "FUNCTION_BLOCK 命令队列管理\nVAR\n\t计数 : INT;\nEND_VAR";

    private static (FakeIde Ide, string Version) WithCjkMethod(System.Func<FakeIde.Item[], FakeIde> make)
    {
        var fb = FakeIde.Item.TextualPou("命令队列管理", Decl, "计数 := 计数 + 1;") with { Children = new[] { "区域可占用" } };
        var m = new FakeIde.Item("区域可占用", ItemKind.PlcMethod, "", false, "METHOD 区域可占用 : BOOL", "区域可占用 := TRUE;", null, null);
        var ide = make(new[] { fb, m });
        return (ide, RefsService.Handle(ide).Items["命令队列管理.pou"]);
    }

    private static PushResponse Update(FakeIde ide, string version, string source) =>
        BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "命令队列管理.pou", IfVersion = version, SourceText = source } },
        });

    private static string Text(string body, string extra = "") =>
        Decl + "\nIMPLEMENTATION ST\n" + body + "\nEND_FUNCTION_BLOCK\n\nMETHOD 区域可占用 : BOOL\nIMPLEMENTATION ST\n区域可占用 := TRUE;\nEND_METHOD\n" + extra;

    /// <summary>Task 1.2, the field bug: patching the body of a POU whose method the IDE holds under a CJK name lands, and
    /// the method is kept. Red before: <c>the IDE refuses to create method '区域可占用' in '命令队列管理'</c>.</summary>
    [Fact]
    public void Patching_the_body_of_a_POU_with_an_existing_CJK_method_lands_and_keeps_the_method()
    {
        var (ide, version) = WithCjkMethod(items => RefusingNonAscii(items));

        var resp = Update(ide, version, Text("计数 := 计数 + 2;"));

        Assert.True(resp.Accepted, string.Join(" | ", (resp.Conflicts ?? new()).Select(c => c.Reason)));
        Assert.Empty(resp.Conflicts ?? new());
        var after = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == "命令队列管理.pou").SourceText;
        Assert.Contains("计数 := 计数 + 2;", after);
        Assert.Contains("METHOD 区域可占用 : BOOL\nIMPLEMENTATION ST\n区域可占用 := TRUE;", after.Replace("\r\n", "\n"));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:", System.StringComparison.Ordinal) || r.StartsWith("delete:", System.StringComparison.Ordinal));   // kept, never re-made
    }

    /// <summary>Task 1.3: beside that existing member, a NEW method named with a word the IDE refuses is still refused by
    /// the pre-flight — before the batch's first op is written.</summary>
    [Fact]
    public void A_new_method_named_Log_beside_an_existing_CJK_method_is_still_refused_before_the_first_write()
    {
        var (ide, version) = WithCjkMethod(items => RefusingNonAscii(items));

        var resp = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "E_A.dut", IfVersion = null, SourceText = "TYPE E_A :\n(\n\ta,\n\tb\n);\nEND_TYPE" },
                new SetItemOp { Name = "命令队列管理.pou", IfVersion = version, SourceText =
                    Text(";", "\nMETHOD Log : BOOL\nIMPLEMENTATION ST\nLog := TRUE;\nEND_METHOD\n") },
            },
        });

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // nothing written — the DUT before it included
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("命令队列管理.pou", conflict.Name);
        Assert.Contains("method 'Log'", conflict.Reason);
        Assert.DoesNotContain("区域可占用", conflict.Reason);
    }

    /// <summary>The same member is "existing" only under its own KIND: an ACTION named like the held METHOD is a create,
    /// and asked.</summary>
    [Fact]
    public void A_new_action_named_like_an_existing_method_is_still_asked()
    {
        var (ide, version) = WithCjkMethod(items => RefusingNonAscii(items));

        var resp = Update(ide, version, Text(";", "\nACTION 区域可占用\nIMPLEMENTATION ST\n;\nEND_ACTION\n"));

        Assert.False(resp.Accepted);
        Assert.Contains("action '区域可占用'", Assert.Single(resp.Conflicts!).Reason);
    }
}
