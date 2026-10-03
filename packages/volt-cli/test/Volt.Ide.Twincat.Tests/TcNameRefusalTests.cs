using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>THE PRE-FLIGHT'S NAME REFUSALS ARE TCXAESHELL'S MEASURED ONES (openspec <c>push-keeps-what-landed</c> 3.1;
/// the words: <c>scripts/member-name-refusal*-tc.log</c>, held to the source by Repo.Gates
/// <c>RefusedNamesMatchTheLogsTests</c>; the SHAPES: <c>scripts/tc-refusal-measure-names.log</c>, openspec
/// <c>bridge-refusal-review</c> 3.1). Each row below is a logged TwinCAT 3.1.4024 verdict.</summary>
public class TcNameRefusalTests
{
    private static string Refused(string word) =>
        $"TwinCAT does not take '{word}' as a name (\"Creating the child named '{word}' is not possible on node (Name mismatch)\")";

    [Theory]
    [InlineData("Log")]
    [InlineData("LOG")]
    [InlineData("INT_TO_REAL")]
    [InlineData("__NEW")]
    [InlineData("END_ACTION")]
    public void A_word_TwinCAT_refused_is_refused_with_its_own_words(string word) =>
        Assert.Equal(Refused(word), BeckhoffDriver.NameRefusal(ItemKind.Kinds.Method, word));

    [Theory]
    [InlineData("END_METHOD")]     // TcXaeShell takes it (CODESYS refuses it), read back
    [InlineData("END_PROPERTY")]
    [InlineData("LDT_TO_LDT")]     // LDT is a CODESYS-only type word
    [InlineData("INT_TO_INT")]
    [InlineData("DoIt")]           // never asked: no guess
    public void A_word_TwinCAT_took_or_was_never_asked_is_not_refused(string word) =>
        Assert.Null(BeckhoffDriver.NameRefusal(ItemKind.Kinds.Method, word));

    /// <summary>The WORDS were measured for a POU and a METHOD / ACTION / PROPERTY, never for an interface member.</summary>
    [Theory]
    [InlineData(ItemKind.Kinds.InterfaceMethod)]
    [InlineData(ItemKind.Kinds.InterfaceProperty)]
    public void A_refused_word_is_not_guessed_at_for_an_interface_member(string kind) =>
        Assert.Null(BeckhoffDriver.NameRefusal(kind, "Log"));

    /// <summary>…except a word that WAS asked on an interface member: <c>a__b</c> was refused for an interface METHOD
    /// and PROPERTY (<c>tc-refusal-measure-names.log</c>, "double underscore"), so it is refused before the batch's first
    /// write (review 3a+3b).</summary>
    [Theory]
    [InlineData(ItemKind.Kinds.InterfaceMethod, "a__b")]
    [InlineData(ItemKind.Kinds.InterfaceProperty, "a__b")]
    [InlineData(ItemKind.Kinds.InterfaceMethod, "A__B")]
    public void A_word_asked_on_an_interface_member_is_refused_there(string kind, string word) =>
        Assert.Equal(Refused(word), BeckhoffDriver.NameRefusal(kind, word));

    /// <summary>bridge-refusal-review 3.1: every name that is no ASCII identifier was refused by TcXaeShell for all six
    /// kinds, "Name mismatch" (<c>tc-refusal-measure-names.log</c>, 42 shapes x 6 kinds, 252 refusals) — a backtick-quoted
    /// name too, which CODESYS creates.</summary>
    [Theory]
    [InlineData("Fööbar")]
    [InlineData("Ünit")]
    [InlineData("Привет")]
    [InlineData("2Fast")]
    [InlineData("My-Name")]
    [InlineData("a.b")]
    [InlineData("a$b")]
    [InlineData("a b")]
    [InlineData("`ab`")]
    [InlineData("`a-b`")]
    [InlineData("`ab")]
    public void A_name_shape_TwinCAT_refused_is_refused_for_every_kind(string name)
    {
        foreach (var kind in new[] { ItemKind.Kinds.Pou, ItemKind.Kinds.Method, ItemKind.Kinds.Action,
                                     ItemKind.Kinds.Property, ItemKind.Kinds.InterfaceMethod,
                                     ItemKind.Kinds.InterfaceProperty })
            Assert.Equal(Refused(name), BeckhoffDriver.NameRefusal(kind, name));
    }

    [Theory]
    [InlineData("_")]
    [InlineData("Trail_")]
    [InlineData("_lead")]
    public void An_identifier_TwinCAT_created_is_not_refused(string name)
    {
        foreach (var kind in new[] { ItemKind.Kinds.Pou, ItemKind.Kinds.Method, ItemKind.Kinds.InterfaceProperty })
            Assert.Null(BeckhoffDriver.NameRefusal(kind, name));
    }
}
