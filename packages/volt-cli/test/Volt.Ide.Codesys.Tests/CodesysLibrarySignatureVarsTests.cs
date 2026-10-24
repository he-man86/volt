using System;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A LIBRARY PIN WITH NO NAME IS REFUSED BY NAME, ON BOTH VENDORS (volt-cli-rework 3.1b review). TwinCAT refuses it
    /// (<c>TcLibraryUntypedPinTests</c>); CODESYS dropped it without a word, so an FB rendered with a pin missing and every
    /// call naming it read as the engineer's error. The one nameless variable CODESYS states is an alias's base, which the
    /// caller reads as <c>AliasBase</c>.
    /// </summary>
    public class CodesysLibrarySignatureVarsTests
    {
        public sealed class Var
        {
            public Var(string? name, string? type) { Name = name; Type = type; }
            public string? Name { get; }
            public string? Type { get; }
            public string? Initial => null;
        }

        public sealed class Sig
        {
            public string Name { get; init; } = "FB_Gate";
            public string Flags { get; init; } = "";
            public object[] Inputs { get; init; } = Array.Empty<object>();
            public object[] AllVariables { get; init; } = Array.Empty<object>();
        }

        [Fact]
        public void A_pin_with_a_type_and_no_name_is_refused_naming_the_signature()
        {
            var sig = new Sig { Inputs = new object[] { new Var("bOpen", "BOOL"), new Var("", "INT") } };
            var ex = Assert.Throws<Volt.Engine.BridgeException>(() => CodesysObjectModel.LibraryVars(sig, "Inputs"));
            Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unreadable, ex.ErrorCode);
            Assert.Contains("FB_Gate", ex.Message);
            Assert.Contains("INT", ex.Message);
            Assert.Contains("no name", ex.Message);
        }

        [Fact]
        public void A_variable_with_no_name_in_a_non_alias_signature_is_refused()
        {
            var sig = new Sig { Name = "ST_Pair", AllVariables = new object[] { new Var(null, "INT") } };
            var ex = Assert.Throws<Volt.Engine.BridgeException>(() => CodesysObjectModel.LibraryVars(sig, "AllVariables"));
            Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unreadable, ex.ErrorCode);
            Assert.Contains("ST_Pair", ex.Message);
        }

        [Fact]
        public void An_alias_base_is_the_one_nameless_variable_and_is_not_a_member()
        {
            var sig = new Sig { Name = "T_Alias", Flags = "Alias", AllVariables = new object[] { new Var("", "DINT") } };
            Assert.Empty(CodesysObjectModel.LibraryVars(sig, "AllVariables"));
        }

        [Fact]
        public void Named_and_typed_pins_are_read_as_stated()
        {
            var sig = new Sig { Inputs = new object[] { new Var("bOpen", "BOOL") } };
            var v = Assert.Single(CodesysObjectModel.LibraryVars(sig, "Inputs"));
            Assert.Equal(("bOpen", "BOOL"), (v.Name, v.Type));
        }
    }
}
