using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// DATA LOSS regression, the CREATE half: a push that would CREATE an item whose body is the
/// <c>(* @volt-graphical: LANG *)</c> marker must be refused, not written.
///
/// <para><see cref="GraphicalChildGuardTests"/> pins the UPDATE half — an existing CFC/SFC body is never
/// overwritten, decided from the IDE's live state. The create path had no such guard and could not have had the
/// same one: there is no live body to read. So the marker fell through as ordinary source, the item was created
/// with an EMPTY implementation, and the push reported success.</para>
///
/// <para>This was measured, not theorised. The corpus-migration gate
/// (<c>test/migration/corpus-migration.test.ts</c>) pushes a real project into a BLANK one — every item a create
/// — and the two committed CFC/SFC fixtures came back as empty function blocks. A user migrating a machine
/// builder's project would have lost every CFC and SFC POU in it with nothing said.</para>
///
/// <para>Refusal, not best-effort: a marker means Volt has no text form for that body, so there is nothing to
/// create it FROM. Writing the declaration and dropping the body is the silent-data-loss outcome this repo
/// refuses on principle.</para>
/// </summary>
public class CreateUnauthorableBodyTests
{
    private const string Bare = "FB_Cfc";
    private const string Name = Bare + ".fb";
    private const string Decl = "FUNCTION_BLOCK " + Bare + "\nVAR\nEND_VAR";

    private static string Marker(string lang) => $"(* @volt-graphical: {lang} *)";

    /// <summary>An empty project — so every op below is a CREATE (<c>IfVersion == null</c>).</summary>
    private static FakeIde Empty() => new();

    private static PushResponse Create(FakeIde ide, string sourceText) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = Name, IfVersion = null, SourceText = sourceText } },
        });

    /// <summary>Nothing was created, written, moved or deleted — a refusal must not leave a stub behind, which is
    /// why the guard runs before <c>CreateChild</c> rather than after it.</summary>
    private static void AssertNothingMutated(FakeIde ide) =>
        Assert.DoesNotContain(ide.Recorded, r =>
            r.StartsWith("write") || r.StartsWith("create:") || r.StartsWith("delete:") || r.StartsWith("move:")
            || r.StartsWith("rename:"));

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    public void Creating_a_pou_whose_body_is_a_marker_is_refused(string language)
    {
        var ide = Empty();

        var resp = Create(ide, $"{Decl}\n(* @volt-implementation *)\n{Marker(language)}\n\nEND_FUNCTION_BLOCK\n");

        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts ?? [], c => c.Reason.Contains(language) && c.Reason.Contains("cannot author"));
        AssertNothingMutated(ide);
    }

    /// <summary>The child case: the POU itself is ordinary ST, one METHOD is CFC. The whole push is refused —
    /// creating the parent and quietly emptying the method is the same loss, one level down.</summary>
    [Fact]
    public void Creating_a_pou_whose_child_body_is_a_marker_is_refused()
    {
        var ide = Empty();

        var resp = Create(ide,
            $"{Decl}\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR\nEND_VAR\n(* @volt-implementation *)\n{Marker("CFC")}\nEND_METHOD\n");

        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts ?? [], c => c.Reason.Contains("'M'") && c.Reason.Contains("CFC"));
        AssertNothingMutated(ide);
    }

    /// <summary>The guard must not swallow ordinary creates: a normal ST body still lands.</summary>
    [Fact]
    public void Creating_a_pou_with_a_textual_body_still_works()
    {
        var ide = Empty();

        var resp = Create(ide, $"{Decl}\n(* @volt-implementation *)\nx := 1;\n\nEND_FUNCTION_BLOCK\n");

        // `Conflicts` is null on an accepted push, so the message has to survive that to be readable when it isn't.
        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? []).Select(c => c.Reason)));
        Assert.Contains(ide.Recorded, r => r.StartsWith("create:"));
    }
}
