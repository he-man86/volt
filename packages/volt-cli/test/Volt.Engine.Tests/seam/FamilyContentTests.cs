using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Seam;

/// <summary>The IEC layout's record as the new contract's <see cref="Content"/> loses nothing (openspec
/// <c>volt-cli-rework</c> step 5): every item of the six corpora, read by the IEC reader, comes back field for field —
/// bodies, their stated languages, members and accessors, signatures and every object property.</summary>
public class FamilyContentTests
{
    /// <summary>Every field of the record, as one text, so two records compare by value and a difference names its field.</summary>
    internal static string Describe(ItemContent c)
    {
        var sb = new StringBuilder();
        sb.Append($"kind={c.Kind}\ndecl={c.Declaration}\nbody={c.Body ?? "<null>"}\nwhy={c.Unsupported}\nstated={c.Stated}\n");
        sb.Append($"props={string.Join("|", PropertyLines.Write(c.Properties))}\n");
        foreach (var m in c.Members)
        {
            sb.Append($"member {m.Kind} {m.Name} folder={m.Folder} ret={m.ReturnType} type={m.DataType}\n decl={m.Declaration}\n");
            sb.Append($" body={m.Body ?? "<null>"} why={m.Unsupported} stated={m.Stated}\n props={string.Join("|", PropertyLines.Write(m.Properties))}\n");
            foreach (var (name, a) in new[] { ("get", m.Getter), ("set", m.Setter) })
                sb.Append(a is null ? $" {name}=<none>\n"
                    : $" {name} decl={a.Declaration ?? "<null>"} body={AccessorBody(a)} why={a.Unsupported} stated={a.Stated}\n");
        }
        return sb.ToString();
    }

    /// <summary>A SIGNATURE accessor (no stated language, no code) is one fact the IEC record spells two ways — <c>""</c> from
    /// the IEC reader, <c>null</c> from a host's read, both "no body to write" (<c>Accessor.Code</c>) — and Content has
    /// one spelling for it, so it is described as one.</summary>
    private static string AccessorBody(Accessor a) =>
        a.Stated is null && string.IsNullOrEmpty(a.Body) ? "<signature>" : a.Body ?? "<null>";

    public static IEnumerable<object[]> CorpusProjectsWithSources() =>
        Directory.GetDirectories(CorpusProjects.CorpusRoot()).Select(d => new object[] { Path.GetFileName(d) });

    [Theory]
    [MemberData(nameof(CorpusProjectsWithSources))]
    public void Every_corpus_item_comes_back_from_Content_field_for_field(string project)
    {
        var read = 0;
        foreach (var file in Directory.EnumerateFiles(Path.Combine(CorpusProjects.CorpusRoot(), project), "*", SearchOption.AllDirectories))
        {
            if (CorpusProjects.KindOf(file) is not { } kind || !ItemKind.IsSourceKind(kind)) continue;
            ItemContent item;
            try { item = AbstractMemberFold.Apply(StReader.Read(File.ReadAllText(file), kind, Path.GetFileNameWithoutExtension(file))); }
            catch (BridgeException) { continue; }   // a text the reader refuses has no record to convert
            read++;

            var content = FamilyContent.ToContent(item);

            Assert.Equal(Describe(item), Describe(FamilyContent.ToItemContent(content)));
        }
        Assert.True(read > 0, $"{project}: no source item read — did the corpus move?");
    }

    [Fact]
    public void Every_object_property_crosses_as_the_key_its_line_spells_and_comes_back()
    {
        var props = new ObjectProperties(new ObjectClass(ObjectClass.Check, "CheckBounds"), true, true, true, true, 4,
            "A,B", new[] { "X", "it's $1" }, "a\ncomment", true,
            new[] { new NetVarSetting("Pack", " spaced "), new NetVarSetting("Empty", "") }, new FileLink("Import", "C:\\x.gvl"));

        var set = FamilyContent.ToContent(new ItemContent(ItemKind.Kinds.Dut, "TYPE T : INT; END_TYPE", null, new List<Member>(), props)).Properties;

        Assert.Equal(new[] { "CLASS", "EXCLUDE_FROM_BUILD", "LINK_ALWAYS", "EXTERNAL", "ENABLE_SYSTEM_CALL", "ONLINE_CHANGE_RESERVE",
                             "COMPILER_DEFINES", "UNDEFINE", "UNDEFINE", "COMMENT", "PARAMETER_LIST", "NETVAR", "NETVAR", "FILE_LINK" },
                     set.Items.Select(p => p.Key));
        Assert.Equal(props, FamilyContent.ToObjectProperties(set));
    }

    [Fact]
    public void A_body_whose_text_its_stated_language_does_not_spell_is_refused_not_guessed()
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, "PROGRAM P", "x := 1;", new List<Member>(), ObjectProperties.None,
                                   Stated: StatedLanguage.Shown("LD"));

        var ex = Assert.Throws<BridgeException>(() => FamilyContent.ToContent(item));
        Assert.Contains("does not spell back", ex.Message);
    }

    /// <summary>A body with text and no stated language is a reader's bug, named as the contract it reached — the one
    /// contract there is, not a step of the change that built it.</summary>
    [Fact]
    public void A_body_with_no_stated_language_is_refused_as_a_reader_bug_naming_the_contract()
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, "PROGRAM P", "x := 1;", new List<Member>(), ObjectProperties.None);

        var ex = Assert.Throws<BridgeException>(() => FamilyContent.ToContent(item));
        Assert.Equal(BridgeErrorCodes.InternalError, ex.ErrorCode);
        Assert.Equal("the pou's body reached the contract with no stated language: a body's language is a fact its reader states",
                     ex.Message);
    }
}
