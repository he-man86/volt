using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

// `CodesysObjectModel.Build` reaches the command manager as `_3S.CoDeSys.ScriptDriverProjects.Common.CommandManager`
// (by FULL name in the AppDomain), so the double carries the vendor's namespace - as the message store beside it does.
namespace _3S.CoDeSys.ScriptDriverProjects
{
    internal static class Common
    {
        public static object? CommandManager { get; set; }
    }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>The vendor's <c>_3S.CoDeSys.Core.Components.TypeGuidAttribute</c>: the bridge matches it by NAME and
    /// reads its <c>Guid</c> property, so a test attribute of the same name is the contract.</summary>
    [AttributeUsage(AttributeTargets.Class)]
    public sealed class TypeGuidAttribute : Attribute
    {
        public TypeGuidAttribute(string guid) => Guid = new Guid(guid);
        public Guid Guid { get; }
    }

    // The four categories measured on CODESYS 3.5.21.40 (openspec codesys-build-own-messages-only, task 1.2).
    [TypeGuid("97f48d64-a2a3-4856-b640-75c046e37ea9")] public sealed class BuildCategory { public string Text => "Build"; }
    [TypeGuid("220493a1-f49b-4416-9a3f-a545db707cbe")] public sealed class AdditionalChecksCategory { public string Text => "Additional code checks"; }
    [TypeGuid("194b48a9-ab51-43ae-b9a9-51d3edaaddf3")] public sealed class ScriptMessagesCategory { public string Text => "Script Messages"; }
    [TypeGuid("05581bd1-66d3-4251-aff2-047cc8e9adf7")] public sealed class OfflineHelpCategory { public string Text => "Offline Help"; }

    /// <summary>A message as the bridge reads it: <c>Text</c>, <c>Severity</c>, <c>ObjectGuid</c>.</summary>
    public sealed class CategoryMessage
    {
        public CategoryMessage(string severity, string text) { Severity = severity; Text = text; }
        public Guid ObjectGuid => Guid.Empty;
        public string Severity { get; }
        public string Text { get; }
    }

    /// <summary>`MessageStorage`: categories, each with its own messages.</summary>
    public sealed class CategorizedMessageStore
    {
        private readonly List<(object Category, CategoryMessage[] Messages)> _byCategory;
        public CategorizedMessageStore(params (object Category, CategoryMessage[] Messages)[] byCategory) =>
            _byCategory = byCategory.ToList();
        public IEnumerable<object> Categories => _byCategory.Select(c => c.Category);
        public IEnumerable<CategoryMessage> GetMessages(object category) =>
            _byCategory.Single(c => ReferenceEquals(c.Category, category)).Messages;
    }

    /// <summary>
    /// A BUILD REPORTS ONLY ITS OWN MESSAGES (openspec <c>codesys-build-own-messages-only</c>).
    ///
    /// <para>The read took EVERY category of the IDE's message store, and the store is the whole message window: a
    /// script's stderr lands in "Script Messages", so one stderr line failed every later build of a clean project
    /// (live, PLCAssist, CODESYS 3.5.21.40). Only the Build and Additional-code-checks categories are the build's.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the message-store and command-manager doubles are process-wide
    public class CodesysBuildOwnMessagesTests
    {
        public sealed class CommandManager
        {
            public int Builds { get; private set; }
            public void ExecuteCommand(Guid command, string[] args) => Builds++;
        }

        public sealed class ApplicationNode { public Guid guid { get; } = Guid.NewGuid(); }

        private static (bool Success, List<Volt.Contracts.BridgeDiagnostic> Diagnostics) BuildWith(object? store)
        {
            var cmd = new CommandManager();
            _3S.CoDeSys.ScriptDriverProjects.Common.CommandManager = cmd;
            _3S.CoDeSys.ScriptDriverSystem.APEnvironment.MessageStorage = store;
            try
            {
                var success = new CodesysObjectModel(null).Build(new ApplicationNode());
                Assert.Equal(1, cmd.Builds);
                return (success, new CodesysDriver(null).GetBuildDiagnostics().ToList());
            }
            finally
            {
                _3S.CoDeSys.ScriptDriverProjects.Common.CommandManager = null;
                _3S.CoDeSys.ScriptDriverSystem.APEnvironment.MessageStorage = null;
            }
        }

        private static CategoryMessage[] Msgs(params CategoryMessage[] m) => m;

        /// <summary>Task 2.1 - the live shape: a script's stderr (an ERROR in "Script Messages") and the bridge's own
        /// start line beside a clean build. The build succeeds and reports only its own lines.</summary>
        [Fact]
        public void A_foreign_category_error_does_not_fail_a_clean_build_nor_appear_in_its_diagnostics()
        {
            var store = new CategorizedMessageStore(
                (new OfflineHelpCategory(), Msgs(new CategoryMessage("Information", "No Offline Help installed"))),
                (new ScriptMessagesCategory(), Msgs(
                    new CategoryMessage("Information", "Volt bridge started on pipe volt.bridge.codesys"),
                    new CategoryMessage("Error", "live-run.py:9: DeprecationWarning: execfile() not supported in 3.x"),
                    new CategoryMessage("Error", "execfile(start, g)"))),
                (new BuildCategory(), Msgs(
                    new CategoryMessage("Information", "------ Build started: Application: Device.Plc Logic.Application -------"),
                    new CategoryMessage("Information", "Compile complete -- 0 errors, 0 warnings"))),
                (new AdditionalChecksCategory(), Msgs(
                    new CategoryMessage("Information", "Additional code checks complete -- 0 errors"))));

            var (success, diagnostics) = BuildWith(store);

            Assert.True(success);
            Assert.Equal(
                new[]
                {
                    "------ Build started: Application: Device.Plc Logic.Application -------",
                    "Compile complete -- 0 errors, 0 warnings",
                    "Additional code checks complete -- 0 errors",
                },
                diagnostics.Select(d => d.Message));
            Assert.All(diagnostics, d => Assert.Equal(Volt.Contracts.Severity.Info, d.Severity));
        }

        /// <summary>Task 2.2 - a real compile error in the Build category still fails the build and is reported, with
        /// its severity as before.</summary>
        [Fact]
        public void A_compile_error_in_the_build_category_still_fails_the_build()
        {
            var store = new CategorizedMessageStore(
                (new ScriptMessagesCategory(), Msgs(new CategoryMessage("Information", "Volt: loading volt.dll"))),
                (new BuildCategory(), Msgs(
                    new CategoryMessage("Error", "Identifier 'nUndeclaredMeasure' not defined"),
                    new CategoryMessage("Information", "Compile complete -- 2 errors, 0 warnings"))));

            var (success, diagnostics) = BuildWith(store);

            Assert.False(success);
            var error = Assert.Single(diagnostics, d => d.Severity == Volt.Contracts.Severity.Error);
            Assert.Equal("Identifier 'nUndeclaredMeasure' not defined", error.Message);
            Assert.DoesNotContain(diagnostics, d => d.Message.StartsWith("Volt:", StringComparison.Ordinal));
        }

        /// <summary>Task 2.3 - a store with no Build category is not a clean build: the build's messages are somewhere
        /// this cannot read, so it is the Unreadable error, never an empty list.</summary>
        [Fact]
        public void No_build_category_is_an_unreadable_error_not_a_clean_build()
        {
            var store = new CategorizedMessageStore(
                (new OfflineHelpCategory(), Msgs(new CategoryMessage("Information", "No Offline Help installed"))),
                (new ScriptMessagesCategory(), Msgs(new CategoryMessage("Information", "Volt: loading volt.dll"))));

            var (success, diagnostics) = BuildWith(store);

            Assert.False(success);
            var d = Assert.Single(diagnostics);
            Assert.Equal(Volt.Contracts.Severity.Error, d.Severity);
            Assert.Contains("97f48d64-a2a3-4856-b640-75c046e37ea9", d.Message);
            Assert.Contains("UNKNOWN", d.Message);
        }

        /// <summary>Task 2.3 (guard kept) - an unreachable store is still the Unreadable error.</summary>
        [Fact]
        public void An_unreachable_store_is_still_an_unreadable_error()
        {
            var (success, diagnostics) = BuildWith(null);

            Assert.False(success);
            var d = Assert.Single(diagnostics);
            Assert.Equal(Volt.Contracts.Severity.Error, d.Severity);
            Assert.Contains("MessageStorage is unreachable", d.Message);
        }
    }
}
