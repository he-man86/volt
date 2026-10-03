using System;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine;
using Xunit;

namespace _3S.CoDeSys.TaskConfig
{
    /// <summary>The vendor's <c>KindOfTask</c>, with the six names measured on SP21 (<c>probe-task-kind.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-task-kind.py</c>)).
    /// <c>Reflection.FindEnum</c> finds an enum by its simple name in the AppDomain, so this IS the enum to the driver.</summary>
    public enum KindOfTask { Cyclic, Freewheeling, Event, ExternalEvent, Status, ParentSynchron }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// AN UNKNOWN TASK <c>Type:</c> IS THE REQUEST'S FAULT — BAD_REQUEST, NAMING THE TYPES THERE ARE (openspec
    /// <c>bridge-refusal-review</c> 2.25, as <c>TcTaskSchedule</c> answers a malformed descriptor).
    ///
    /// <para>It was an <c>InvalidOperationException</c>, which the push reports as INTERNAL_ERROR — a Volt bug — for a
    /// typo in a `.task` file. And <c>Enum.Parse</c> took a NUMBER too: <c>Type: 99</c> parsed as an undefined
    /// <c>KindOfTask</c> and was written into the task as if it named one.</para>
    /// </summary>
    public class CodesysTaskKindTests
    {
        /// <summary>Drive the real private helper. A reimplementation here would test itself.</summary>
        private static object TaskKind(string type)
        {
            var m = typeof(CodesysObjectModel).GetMethod("TaskKind", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(m);
            try { return m!.Invoke(null, new object[] { type })!; }
            catch (TargetInvocationException tie) { throw tie.InnerException!; }
        }

        [Fact]
        public void A_named_type_is_its_vendor_value()
        {
            Assert.Equal(_3S.CoDeSys.TaskConfig.KindOfTask.Freewheeling, TaskKind("Freewheeling"));
        }

        [Theory]
        [InlineData("Cyclicc")]
        [InlineData("99")]            // a number names no type, defined or not
        [InlineData("1")]
        [InlineData("cyclic")]        // the read side renders the enum's own names; the file's line is one of them
        public void Anything_else_is_a_bad_request_naming_the_types(string type)
        {
            var ex = Assert.Throws<BridgeException>(() => TaskKind(type));
            Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
            Assert.Contains($"'{type}'", ex.Message);
            Assert.Contains("Cyclic, Freewheeling, Event, ExternalEvent, Status, ParentSynchron", ex.Message);
        }

        /// <summary>The push PRE-FLIGHT asks the same lookup (<c>ICodeStore.ValidateTask</c>), so the request's own fault is
        /// refused before the batch's first write rather than by the descriptor write after earlier ops landed (review
        /// 2e+2g, low).</summary>
        [Fact]
        public void The_pre_flight_refuses_an_unknown_type_with_the_same_answer()
        {
            var driver = new CodesysDriver(projects: null);
            var settings = new Volt.Engine.Format.Task.TaskSettings("Cyclicc", "10", "ms", "1", null, null, System.Array.Empty<string>());

            var ex = Assert.Throws<BridgeException>(() => driver.ValidateTask(settings));
            Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
            Assert.Contains("'Cyclicc'", ex.Message);
            driver.ValidateTask(settings with { Type = "Cyclic" });   // a named type passes
        }
    }
}
