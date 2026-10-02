using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY FIELD OF <see cref="ItemContent"/> SURVIVES THE FORMAT, AND A NEW FIELD CANNOT BE ADDED WITHOUT
/// SAYING SO HERE.
///
/// <para><b>Three separate bugs in one session had one shape</b>: a field the vendor stores, that Volt's model
/// can hold, that something along the way quietly did not carry — an accessor's <c>VAR END_VAR</c> declaration,
/// a coil's edge and negation bits, a task call entry's comment.</para>
///
/// <para><b>Be exact about what this gate does and does not reach, because over-claiming coverage is how the
/// next one gets through.</b> Those three were dropped at the VENDOR boundary
/// (<c>AccessorDeclaration.Keep</c>, <c>NetworkTextWriter.AssignOp</c>, <c>RebuildCallList</c>) — above the
/// drivers, where only a live IDE can be the oracle, which is why all three needed a probe. This file gates the
/// FORMAT boundary: a field that reaches <see cref="ItemContent"/> intact and is then lost by
/// <see cref="StWriter"/> or <see cref="StReader"/>. Same failure shape, different seam, and the one seam that
/// can be gated offline. (Verified by breaking <c>AssembleAccessor</c> to drop a declaration: this test goes
/// red, which is the only evidence that it is a gate and not decoration.)</para>
///
/// <para><b>And it is the half <c>StFixedPointTests</c> cannot see.</b> That one starts from TEXT and proves
/// <c>Write(Read(x)) == x</c> — necessary, and blind to a field the writer never emits, because the reader then
/// never produces it either and the two agree perfectly about nothing. Starting from a fully-populated MODEL is
/// what makes an unemitted field visible.</para>
///
/// <para><b>And the reflection half is the part that survives us.</b> Asserting the round trip on a fixture
/// only covers the fields someone remembered to put in the fixture. So the fixture is checked AGAINST THE
/// RECORD: every property of <see cref="ItemContent"/>, <see cref="Member"/> and <see cref="Accessor"/> must be
/// set to a distinctive non-default value, and adding a field to any of them fails this test until it is either
/// carried through the format or listed as a documented exception. Same principle as <c>bun run check</c> —
/// a contract that is declared in more than one place cannot be extended in only one of them.</para>
/// </summary>
public class ItemContentIsFullyCarriedTests
{
    /// <summary>Fields that legitimately do not round-trip, each with the reason. The list is deliberately
    /// short and deliberately hard to grow: an entry here is a claim that the FORMAT cannot carry the field,
    /// not that carrying it was inconvenient.</summary>
    private static readonly Dictionary<string, string> NotCarried = new()
    {
        [$"{nameof(Member)}.{nameof(Member.ReturnType)}"] =
            "WRITE-only and vendor-driven: TwinCAT wants an interface member's type as the create's vInfo. The " +
            "reader DERIVES it from the declaration rather than carrying it, so it is not a field the text lost.",
        [$"{nameof(Member)}.{nameof(Member.DataType)}"] =
            "Same as ReturnType — derived from the declaration by the reader, never stored in the text.",
        // WHY a body is IMPLEMENTATION LD|FBD UNSUPPORTED left the file on purpose (openspec implementation-keyword 2b,
        // owner decision): the line says the body is read-only and the reason goes to the pull message. The driver sets
        // it on a READ and a file never carries it — ReadOnlyBodyTests pins both halves.
        [$"{nameof(ItemContent)}.{nameof(ItemContent.Unsupported)}"] = UnsupportedIsNotInTheFile,
        [$"{nameof(Member)}.{nameof(Member.Unsupported)}"] = UnsupportedIsNotInTheFile,
        [$"{nameof(Accessor)}.{nameof(Accessor.Unsupported)}"] = UnsupportedIsNotInTheFile,
        // openspec push-without-header-check 5.B (design option B1): a DUT's subtype is the VENDOR's answer, set by the
        // driver on a read and carried on the WIRE NAME (`Materializer`, `X.enum` / `X.dut`), never in the text — the
        // ST reader never sets it and no write reads it. That the fake produces it is DutSubtypeAnswerTests' subject.
        [$"{nameof(ItemContent)}.{nameof(ItemContent.DutSubtype)}"] =
            "The vendor's DUT subtype answer travels as the wire name's extension, not in the file's text.",
    };

    private const string UnsupportedIsNotInTheFile =
        "The reason an LD/FBD body is UNSUPPORTED is reported by the pull, not written into the file.";

    /// <summary>An item with every field of every record populated, each value distinct enough that a swap or a
    /// drop is visible. Trailing newlines are deliberately absent: the format joins parts with one, so a
    /// trailing newline is the one thing it genuinely cannot carry (see <c>AccessorDeclaration.Keep</c>).</summary>
    private static ItemContent Maximal() => new(
        Kind: ItemKind.Kinds.FunctionBlock,
        Declaration: "FUNCTION_BLOCK FB_Everything\nVAR\n\tnCount : INT := 7;\nEND_VAR",
        Body: "nCount := nCount + 1;",
        Members: new List<Member>
        {
            new(Kind: ItemKind.Kinds.Method,
                Name: "DoWork",
                Declaration: "METHOD PUBLIC DoWork : BOOL\nVAR_INPUT\n\tbGo : BOOL;\nEND_VAR",
                Body: "DoWork := bGo;",
                Folder: "Internals",
                ReturnType: "BOOL"),
            new(Kind: ItemKind.Kinds.Property,
                Name: "Level",
                Declaration: "PROPERTY PUBLIC Level : INT",
                Body: null,
                Folder: "Exposed",
                // Both accessors present, with DIFFERENT declarations — the exact asymmetry that made the
                // dropped getter declaration visible to a human reader in the first place.
                Getter: new Accessor("VAR\nEND_VAR", "Level := nCount;"),
                Setter: new Accessor("PRIVATE\nVAR\nEND_VAR", "nCount := Level;"),
                DataType: "INT"),
        });

    // ── the reflection half ────────────────────────────────────────────────────────────────────────────────

    /// <summary>Every property of the three records is populated by <see cref="Maximal"/>. Adding a field to
    /// <see cref="ItemContent"/>, <see cref="Member"/> or <see cref="Accessor"/> fails HERE, before it can fail
    /// silently in production by never being written.</summary>
    [Fact]
    public void The_fixture_populates_every_field_the_records_declare()
    {
        var item = Maximal();
        var covered = new HashSet<string>(StringComparer.Ordinal);

        // AGGREGATED across the fixture, never per instance: a METHOD legitimately has no accessors and a
        // PROPERTY legitimately has no body, so "default on this object" is not "the fixture never exercises
        // it". Asking per instance made this fail on a correct fixture.
        Cover(typeof(ItemContent), item, nameof(ItemContent), covered);
        foreach (var m in item.Members) Cover(typeof(Member), m, nameof(Member), covered);
        foreach (var a in item.Members.SelectMany(m => new[] { m.Getter, m.Setter }).Where(a => a is not null))
            Cover(typeof(Accessor), a!, nameof(Accessor), covered);

        var unset = Declared().Where(f => !covered.Contains(f) && !NotCarried.ContainsKey(f)).ToList();

        Assert.True(unset.Count == 0,
            "These fields exist on the content records and the fixture leaves them at their default, so nothing " +
            "in this file proves they are carried:\n  " + string.Join("\n  ", unset.Distinct()) +
            "\nPopulate them in Maximal(), or add them to NotCarried with the reason the format cannot hold them.");
    }

    private static void Cover(Type t, object instance, string label, HashSet<string> covered)
    {
        foreach (var p in Fields(t))
        {
            var v = p.GetValue(instance);
            var isDefault = v is null
                            || (v is string s && s.Length == 0)
                            || (v is System.Collections.ICollection c && c.Count == 0);
            if (!isDefault) covered.Add($"{label}.{p.Name}");
        }
    }

    /// <summary>Every property that is genuinely a FIELD OF THE MODEL. A record's compiler-generated
    /// <c>EqualityContract</c> is not one, and <c>Accessor.Code</c> is derived from <c>Body</c> with no storage
    /// of its own — carrying it separately would be carrying the same fact twice.</summary>
    private static IEnumerable<PropertyInfo> Fields(Type t) =>
        t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
         .Where(p => p.Name != "EqualityContract")
         .Where(p => !(t == typeof(Accessor) && p.Name == nameof(Accessor.Code)));

    private static IEnumerable<string> Declared() =>
        new[] { typeof(ItemContent), typeof(Member), typeof(Accessor) }
            .SelectMany(t => Fields(t).Select(p => $"{t.Name}.{p.Name}"));

    // ── the round-trip half ────────────────────────────────────────────────────────────────────────────────

    /// <summary>THE GATE. A fully-populated model, written and read back, is the same model — field by field,
    /// so a failure names what was lost instead of dumping two blobs.</summary>
    [Fact]
    public void Every_populated_field_survives_write_then_read()
    {
        var before = Maximal();
        var after = StReader.Read(StWriter.Write(before), before.Kind);

        Assert.Equal(before.Kind, after.Kind);
        Assert.Equal(before.Declaration, after.Declaration);
        Assert.Equal(before.Body, after.Body);
        Assert.Equal(before.Members.Select(m => m.Name), after.Members.Select(m => m.Name));

        foreach (var (b, a) in before.Members.Zip(after.Members))
        {
            Assert.Equal(b.Kind, a.Kind);
            Assert.Equal(b.Name, a.Name);
            Assert.Equal(b.Declaration, a.Declaration);
            Assert.Equal(b.Folder, a.Folder);

            // A PROPERTY has no body in ST — there is no syntax for one between `PROPERTY x : T` and its
            // accessors — so `null` and `""` are the same absence there and the format carries neither. That
            // is a fact about the LANGUAGE, not a thing this layer dropped, and it is the only reason the
            // comparison is normalised. Everything with a real body is compared exactly, below.
            if (b.Kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)
                Assert.Equal(b.Body ?? "", a.Body ?? "");
            else
                Assert.Equal(b.Body, a.Body);
            AssertAccessor(b.Name + ".Getter", b.Getter, a.Getter);
            AssertAccessor(b.Name + ".Setter", b.Setter, a.Setter);
        }
    }

    private static void AssertAccessor(string what, Accessor? before, Accessor? after)
    {
        // Presence IS the object: null means "no such accessor", and a push of null REMOVES it. Conflating
        // null with an empty accessor is how a getter gets silently deleted, so the null-ness is asserted
        // before anything inside it.
        Assert.True(before is null == after is null, $"{what}: presence changed across the round trip");
        if (before is null) return;

        Assert.Equal(before.Declaration, after!.Declaration);
        Assert.Equal(before.Body, after.Body);
    }

    /// <summary>A body that EXISTS is preserved to the character, null stays null and empty stays empty.
    ///
    /// <para>The distinction is load-bearing below the seam: both drivers write a member's implementation on
    /// <c>!= null</c>, so <c>null</c> means "leave the body alone" and <c>""</c> means "clear it". TwinCAT
    /// skipped empty implementations once and emptied bodies stopped being cleared — a real data-loss bug. A
    /// format that collapsed the two would reintroduce it from above.</para></summary>
    [Theory]
    [InlineData("DoWork := bGo;")]
    [InlineData("")]
    public void A_members_own_body_keeps_its_exact_value(string body)
    {
        var before = new ItemContent(
            ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_B\nVAR\nEND_VAR",
            "n := 1;",
            new List<Member>
            {
                new(ItemKind.Kinds.Method, "DoWork",
                    "METHOD PUBLIC DoWork : BOOL\nVAR_INPUT\n\tbGo : BOOL;\nEND_VAR", body),
            });

        var after = StReader.Read(StWriter.Write(before), before.Kind);

        Assert.Equal(body, Assert.Single(after.Members).Body);
    }


    // ── the fake ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>THE FAKE MUST BE ABLE TO PRODUCE EVERY FIELD TOO, or the tests built on it prove less than
    /// they look like they prove.
    ///
    /// <para><b>This is the exact hole that let the accessor bug live.</b> <c>FakeIde.AccessorOf</c> did not
    /// exist: every property came back with a null <c>Getter</c> and <c>Setter</c>, so every engine test that
    /// touched a property agreed with whatever the engine did with accessor declarations — which was to throw
    /// them away. A fake that cannot express a field cannot disagree about it, and a fake that cannot disagree
    /// is not a test double, it is an echo.</para>
    ///
    /// <para>So the same coverage question is asked from the other side: drive <c>FakeIde.ReadContent</c> over
    /// a POU that has a method, a folder, and a property with BOTH accessors, and require the result to
    /// populate every field of the content records. This cannot notice a fake that returns the WRONG value —
    /// nothing offline can, which is what the live probes are for — but it does notice a fake that returns no
    /// value at all, and that is how all of this started.</para></summary>
    [Fact]
    public void The_fake_ide_can_produce_every_field_the_records_declare()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Everything", ItemKind.PlcPouFb, "", true,
                             "FUNCTION_BLOCK FB_Everything\nVAR\n\tnCount : INT;\nEND_VAR", "nCount := nCount + 1;",
                             null, null, Children: new[] { "DoWork", "Level" }),
            new FakeIde.Item("DoWork", ItemKind.PlcMethod, "Internals", false,
                             "METHOD PUBLIC DoWork : BOOL", "DoWork := TRUE;", null, null),
            new FakeIde.Item("Level", ItemKind.PlcProp, "Exposed", false, "PROPERTY PUBLIC Level : INT",
                             null, null, null, Children: new[] { "Get", "Set" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "VAR\nEND_VAR", "Level := nCount;", null, null),
            new FakeIde.Item("Set", ItemKind.PlcPropSet, "", false, "PRIVATE\nVAR\nEND_VAR", "nCount := Level;",
                             null, null));

        var content = ide.ReadContent(new ItemRef("FB_Everything"));
        var covered = new HashSet<string>(StringComparer.Ordinal);

        Cover(typeof(ItemContent), content, nameof(ItemContent), covered);
        foreach (var m in content.Members) Cover(typeof(Member), m, nameof(Member), covered);
        foreach (var a in content.Members.SelectMany(m => new[] { m.Getter, m.Setter }).Where(a => a is not null))
            Cover(typeof(Accessor), a!, nameof(Accessor), covered);

        // `ReturnType`/`DataType` are excluded for the same reason as above and it is the REAL drivers' reason,
        // not a concession to the fake: both are null coming from an IDE, on every vendor.
        var unset = Declared().Where(f => !covered.Contains(f) && !NotCarried.ContainsKey(f)).ToList();

        Assert.True(unset.Count == 0,
            "FakeIde.ReadContent never populates these fields, so no engine test that uses the fake can " +
            "disagree with the engine about them:\n  " + string.Join("\n  ", unset) +
            "\nTeach the fake to produce them, the way AccessorOf had to be taught to produce accessors.");
    }

    /// <summary>The exception list is not a place to park a field: every entry must name a property that still
    /// exists. A renamed or deleted field leaves a stale excuse behind, and a stale excuse is how the next
    /// field gets waved through.</summary>
    [Fact]
    public void Every_documented_exception_still_names_a_real_field()
    {
        var known = Declared().ToHashSet(StringComparer.Ordinal);

        foreach (var key in NotCarried.Keys)
            Assert.True(known.Contains(key), $"NotCarried lists '{key}', which no content record declares.");
    }
}
