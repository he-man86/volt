using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>THE PRE-FLIGHT'S NAME REFUSALS ARE TCXAESHELL'S MEASURED ONES (openspec <c>push-keeps-what-landed</c> 3.1;
/// the words: <c>scripts/member-name-refusal*-tc.log</c>, held to the source by Repo.Gates
/// <c>RefusedNamesMatchTheLogsTests</c>). Each row below is a logged TwinCAT 3.1.4024 verdict.</summary>
public class TcNameRefusalTests
{
    [Theory]
    [InlineData("Log")]
    [InlineData("LOG")]
    [InlineData("INT_TO_REAL")]
    [InlineData("__NEW")]
    [InlineData("END_ACTION")]
    public void A_word_TwinCAT_refused_is_refused_with_its_own_words(string word) =>
        Assert.Equal($"TwinCAT does not take '{word}' as a name (\"Creating the child named '{word}' is not possible on node (Name mismatch)\")",
                     BeckhoffDriver.NameRefusal(word));

    [Theory]
    [InlineData("END_METHOD")]     // TcXaeShell takes it (CODESYS refuses it), read back
    [InlineData("END_PROPERTY")]
    [InlineData("LDT_TO_LDT")]     // LDT is a CODESYS-only type word
    [InlineData("INT_TO_INT")]
    [InlineData("DoIt")]           // never asked: no guess
    public void A_word_TwinCAT_took_or_was_never_asked_is_not_refused(string word) =>
        Assert.Null(BeckhoffDriver.NameRefusal(word));
}
