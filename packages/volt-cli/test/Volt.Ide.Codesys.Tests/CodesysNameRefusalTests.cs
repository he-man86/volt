using Volt.Engine.Item;
using Volt.Ide.Codesys;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>THE PRE-FLIGHT'S NAME REFUSALS ARE CODESYS'S MEASURED ONES (openspec <c>push-keeps-what-landed</c> 3.1;
    /// the words: <c>scripts/member-name-refusal*.log</c>, held to the source by Repo.Gates
    /// <c>RefusedNamesMatchTheLogsTests</c>; the SHAPES: <c>scripts/identifier-names.log</c>, openspec
    /// <c>bridge-refusal-review</c> 3.1). Each row below is a logged SP21 verdict.</summary>
    public class CodesysNameRefusalTests
    {
        private static string Refused(string word) =>
            $"CODESYS does not take '{word}' as a name (\"The name '{word}' is not valid for this object.\")";

        [Theory]
        [InlineData("Log")]           // the PLCAssist repro
        [InlineData("lOg")]           // any case (measured)
        [InlineData("INT_TO_REAL")]
        [InlineData("__NEW")]
        [InlineData("END_METHOD")]    // CODESYS refuses it; TcXaeShell takes it
        [InlineData("LDT_TO_LDT")]
        public void A_word_CODESYS_refused_is_refused_with_its_own_words(string word) =>
            Assert.Equal(Refused(word), CodesysDriver.NameRefusal(ItemKind.Kinds.Method, word));

        [Theory]
        [InlineData("INT_TO_INT")]          // accepted, read back
        [InlineData("TIME_OF_DAY_TO_INT")]  // a long spelling is no conversion stem
        [InlineData("GET")]
        [InlineData("FB_init")]
        [InlineData("DoIt")]                // never asked: no guess
        public void A_word_CODESYS_took_or_was_never_asked_is_not_refused(string word) =>
            Assert.Null(CodesysDriver.NameRefusal(ItemKind.Kinds.Method, word));

        /// <summary>The WORDS were measured for a POU and a METHOD / ACTION / PROPERTY, never for an interface member:
        /// there a word reaches the IDE, as every unmeasured word does.</summary>
        [Theory]
        [InlineData(ItemKind.Kinds.InterfaceMethod)]
        [InlineData(ItemKind.Kinds.InterfaceProperty)]
        public void A_refused_word_is_not_guessed_at_for_an_interface_member(string kind) =>
            Assert.Null(CodesysDriver.NameRefusal(kind, "Log"));

        /// <summary>…except a word that WAS asked on an interface member: <c>a__b</c> was refused for an interface
        /// METHOD and PROPERTY (<c>identifier-names.log</c>, "double underscore"), so it is refused before the batch's
        /// first write, not mid-batch after earlier ops landed (review 3a+3b).</summary>
        [Theory]
        [InlineData(ItemKind.Kinds.InterfaceMethod, "a__b")]
        [InlineData(ItemKind.Kinds.InterfaceProperty, "a__b")]
        [InlineData(ItemKind.Kinds.InterfaceMethod, "A__B")]
        public void A_word_asked_on_an_interface_member_is_refused_there(string kind, string word) =>
            Assert.Equal(Refused(word), CodesysDriver.NameRefusal(kind, word));

        /// <summary>bridge-refusal-review 3.1: every name that is no ASCII identifier and does not open with a backtick
        /// was refused by SP21 for all six kinds, with the word refusal's own message (<c>identifier-names.log</c>,
        /// 37 shapes x 6 kinds, 222 refusals). It was <c>StReader.IsIdentifier</c>'s INVALID_ST, unmeasured.</summary>
        [Theory]
        [InlineData("Fööbar")]
        [InlineData("Ünit")]
        [InlineData("Привет")]
        [InlineData("2Fast")]
        [InlineData("My-Name")]
        [InlineData("a.b")]
        [InlineData("a$b")]
        [InlineData("a b")]        // a no-break space: the signature line does not split at it
        [InlineData("a​b")]
        [InlineData("`ab")]             // a backtick that never closes
        [InlineData("a`b")]             // a backtick inside a plain name
        public void A_name_shape_CODESYS_refused_is_refused_for_every_kind(string name)
        {
            foreach (var kind in new[] { ItemKind.Kinds.Pou, ItemKind.Kinds.Method, ItemKind.Kinds.Action,
                                         ItemKind.Kinds.Property, ItemKind.Kinds.InterfaceMethod,
                                         ItemKind.Kinds.InterfaceProperty })
                Assert.Equal(Refused(name), CodesysDriver.NameRefusal(kind, name));
        }

        /// <summary>…and a BACKTICK-QUOTED name was CREATED for all six kinds and built clean — whatever stands between the
        /// backticks (a hyphen, a space, a keyword, nothing), and with text after the closing one. A lone underscore and a
        /// trailing one are identifiers.</summary>
        [Theory]
        [InlineData("`ab`")]
        [InlineData("`a-b`")]
        [InlineData("`2Fast`")]
        [InlineData("`INT`")]
        [InlineData("``")]
        [InlineData("`a`b")]
        [InlineData("_")]
        [InlineData("Trail_")]
        public void A_name_shape_CODESYS_created_is_not_refused(string name)
        {
            foreach (var kind in new[] { ItemKind.Kinds.Pou, ItemKind.Kinds.Method, ItemKind.Kinds.InterfaceProperty })
                Assert.Null(CodesysDriver.NameRefusal(kind, name));
        }
    }
}
