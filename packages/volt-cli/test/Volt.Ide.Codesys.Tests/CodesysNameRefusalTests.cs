using Volt.Ide.Codesys;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>THE PRE-FLIGHT'S NAME REFUSALS ARE CODESYS'S MEASURED ONES (openspec <c>push-keeps-what-landed</c> 3.1;
    /// the words: <c>scripts/member-name-refusal*.log</c>, held to the source by Repo.Gates
    /// <c>RefusedNamesMatchTheLogsTests</c>). Each row below is a logged SP21 verdict.</summary>
    public class CodesysNameRefusalTests
    {
        [Theory]
        [InlineData("Log")]           // the PLCAssist repro
        [InlineData("lOg")]           // any case (measured)
        [InlineData("INT_TO_REAL")]
        [InlineData("__NEW")]
        [InlineData("END_METHOD")]    // CODESYS refuses it; TcXaeShell takes it
        [InlineData("LDT_TO_LDT")]
        public void A_word_CODESYS_refused_is_refused_with_its_own_words(string word) =>
            Assert.Equal($"CODESYS does not take '{word}' as a name (\"The name '{word}' is not valid for this object.\")",
                         CodesysDriver.NameRefusal(word));

        [Theory]
        [InlineData("INT_TO_INT")]          // accepted, read back
        [InlineData("TIME_OF_DAY_TO_INT")]  // a long spelling is no conversion stem
        [InlineData("GET")]
        [InlineData("FB_init")]
        [InlineData("DoIt")]                // never asked: no guess
        public void A_word_CODESYS_took_or_was_never_asked_is_not_refused(string word) =>
            Assert.Null(CodesysDriver.NameRefusal(word));
    }
}
