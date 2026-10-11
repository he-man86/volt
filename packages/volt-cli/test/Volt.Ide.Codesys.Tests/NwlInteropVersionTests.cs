using System;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    // An NWL type whose constructor does not take a string, as SP18's Operand does not (NWLObject 4.1.0.0).
    internal sealed class NwlOperandWithoutStringCtor { public NwlOperandWithoutStringCtor(int _) { } }

    /// <summary>
    /// A GRAPHICAL WRITE ON AN OLDER CODESYS IS REFUSED BY NAME. Measured on SP18 (2026-10-10): every LD/FBD create
    /// failed as <c>INTERNAL_ERROR Constructor on type '_3S.CoDeSys.NWLObject.Operand' not found</c>, which tells the
    /// user nothing. A missing constructor is now a coded UNSUPPORTED refusal that
    /// names the object model and what still works.
    /// </summary>
    public class NwlInteropVersionTests
    {
        [Fact]
        public void A_missing_constructor_is_an_unsupported_refusal_that_says_why()
        {
            var ex = Assert.Throws<Volt.Engine.BridgeException>(() =>
                NwlInterop.New(new NwlOperandWithoutStringCtor(0), nameof(NwlOperandWithoutStringCtor), "x"));
            Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
            Assert.Contains("NwlOperandWithoutStringCtor", ex.Message);
            Assert.Contains("(String)", ex.Message);
            Assert.Contains("SP21 or later", ex.Message);
            Assert.Contains("Structured text and declarations still sync", ex.Message);
        }
    }
}
