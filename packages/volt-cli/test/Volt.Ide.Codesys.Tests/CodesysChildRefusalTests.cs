using System;
using System.Reflection;
using Volt.Ide.Codesys;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>THE DRIVER, NOT THE ENGINE, TELLS CODESYS'S REFUSAL OF A CHILD FROM A FAULT (openspec
    /// <c>push-without-header-check</c> 5Qa review). The push words a refused member as a fact about the POU's
    /// declaration (DIALECT C2k); it used to word every failed create that way. Only CODESYS's own measured answer is a
    /// refusal — from wherever it sits in the chain a reflective call builds.</summary>
    public class CodesysChildRefusalTests
    {
        private const string Measured =
            "Object 'Method' is not accepted by parent object, or invalid (e. g. missing plugin or device description).";

        [Fact]
        public void The_measured_not_accepted_answer_is_a_refusal_with_the_vendors_words()
        {
            Assert.Equal(Measured, CodesysDriver.ChildRefusal(new InvalidOperationException(Measured)));
            Assert.Equal(Measured, CodesysDriver.ChildRefusal(new TargetInvocationException(new InvalidOperationException(Measured))));
        }

        /// <summary>openspec <c>push-keeps-what-landed</c> gate step 1: the live PLCAssist repro (CODESYS SP21, 2026-10-03,
        /// tasks.md 1.1) — a METHOD named <c>Log</c> under a function block is refused with this message, and it reached
        /// the client as <c>INTERNAL_ERROR</c> because this classifier did not know it. It is the vendor refusing a child
        /// by its NAME, as "not accepted" is by its kind: a refusal, not a fault.</summary>
        [Fact]
        public void The_measured_name_not_valid_answer_is_a_refusal_with_the_vendors_words()
        {
            const string log = "The name 'Log' is not valid for this object.";
            Assert.Equal(log, CodesysDriver.ChildRefusal(new InvalidOperationException(log)));
            Assert.Equal(log, CodesysDriver.ChildRefusal(new TargetInvocationException(new InvalidOperationException(log))));
        }

        [Theory]
        [InlineData("Unbound tree item")]
        [InlineData("Object reference not set to an instance of an object.")]
        [InlineData("CODESYS: no create for item kind 9999 ('M')")]
        public void Any_other_failure_is_not_a_refusal(string message) =>
            Assert.Null(CodesysDriver.ChildRefusal(new InvalidOperationException(message)));
    }
}
