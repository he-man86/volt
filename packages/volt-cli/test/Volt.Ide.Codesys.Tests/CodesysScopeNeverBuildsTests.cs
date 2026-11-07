using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Format.Network;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;

// The language model is reached as `_3S.CoDeSys.Core.SystemInstances.LanguageModelMgr`, by FULL name in the AppDomain.
namespace _3S.CoDeSys.Core
{
    internal static partial class SystemInstances
    {
        public static object? LanguageModelMgr { get; set; }
    }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A NETWORK SCOPE NEVER BUILDS. A graphical body calling a LIBRARY block (<c>t1 : TON</c>) asks the scope for the
    /// block's pins, and the scope asked the driver's library EXTRACTION — which runs <c>Build</c> on every application
    /// first. So every <c>refs</c>, <c>fetch</c> and <c>push</c> that read such a body compiled the project: outside
    /// the busy gate, rewriting the engineer's message view, 1-2.5 s per refs and 5-9 s per push on the 3.5.21 fixture
    /// (the live e2e test holding one crossed its 30 s budget, and the next eleven tests were refused IDE_BUSY while
    /// the abandoned build ran). The scope reads the signatures the IDE has ALREADY precompiled, and refuses by name
    /// when it has precompiled none.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances and the command manager are process-wide
    public class CodesysScopeNeverBuildsTests
    {
        public sealed class Commands
        {
            public int Builds { get; private set; }
            public void ExecuteCommand(Guid command, string[] args) => Builds++;
        }

        public sealed class Var
        {
            public Var(string name, string type) { Name = name; Type = type; }
            public string Name { get; }
            public string Type { get; }
            public string? Initial => null;
        }

        public sealed class Signature
        {
            public Signature(string name, bool library, params Var[] outputs) { Name = name; IsLibraryObject = library; Outputs = outputs; }
            public string Name { get; }
            public bool IsLibraryObject { get; }
            public string LibraryPath => "standard, 3.5.21.0 (system)";
            public string POUType => "_3S.CoDeSys.Core.LanguageModel.POUType.FunctionBlock";
            public string Flags => "";
            public object? BaseSignature => null;
            public string? ReturnType => null;
            public Guid ObjectGuid { get; } = Guid.NewGuid();
            public Var[] Inputs => new[] { new Var("IN", "BOOL"), new Var("PT", "TIME") };
            public Var[] Outputs { get; }
            public Var[] InOuts => new Var[0];
            public Var[] AllVariables => Inputs.Concat(Outputs).ToArray();
        }

        public sealed class LanguageModel
        {
            private readonly Signature[] _sigs;
            public LanguageModel(params Signature[] sigs) => _sigs = sigs;
            public Signature[] AllPrecompiledSignatures(bool a, bool b) => _sigs;
            public object[] GetAllMethods(object sig) => new object[0];
        }

        private static (T Result, int Builds) Read<T>(LanguageModel model, Func<NetworkScope, T> ask, bool push = false) =>
            Drive(model, driver =>
            {
                const string declaration = "FUNCTION_BLOCK F\nVAR\n\tt1 : TON;\nEND_VAR\n";
                // A read (refs, fetch) writes a pulled body against the pull scope; a push reads its text against its own.
                return ask(push ? driver.NetworkScopeFor(declaration, PushedDeclarations.None) : driver.Declarations.ScopeForPull(declaration));
            });

        /// <summary>The builds the last <see cref="Drive{T}"/> ran — read after a refusal, which returns no tuple.</summary>
        private static int _lastBuilds = -1;

        private static (T Result, int Builds) Drive<T>(LanguageModel model, Func<CodesysDriver, T> ask)
        {
            var commands = new Commands();
            // An Application node, so a build would have something to build.
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Device", null, null, new TreeNode("Plc Logic", null, null, new TreeNode("Application", new Application(), null))));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            _3S.CoDeSys.Core.SystemInstances.LanguageModelMgr = model;
            _3S.CoDeSys.ScriptDriverProjects.Common.CommandManager = commands;
            try
            {
                var driver = new CodesysDriver(new Projects(root));
                driver.WalkItems();
                return (ask(driver), commands.Builds);
            }
            finally
            {
                _lastBuilds = commands.Builds;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
                _3S.CoDeSys.Core.SystemInstances.LanguageModelMgr = null;
                _3S.CoDeSys.ScriptDriverProjects.Common.CommandManager = null;
            }
        }

        [Fact]
        public void A_library_blocks_pins_are_read_from_the_precompiled_model_without_a_build()
        {
            var (outputs, builds) = Read(new LanguageModel(new Signature("TON", true, new Var("Q", "BOOL"), new Var("ET", "TIME"))),
                                         s => s.BlockOutputs("TON"));
            Assert.Equal(new[] { "Q", "ET" }, outputs);
            Assert.Equal(0, builds);
        }

        /// <summary>A push reads the precompiled model too.</summary>
        [Fact]
        public void A_push_reads_the_precompiled_model_without_a_build_when_it_holds_the_libraries()
        {
            var (outputs, builds) = Read(new LanguageModel(new Signature("TON", true, new Var("Q", "BOOL"), new Var("ET", "TIME"))),
                                         s => s.BlockOutputs("TON"), push: true);
            Assert.Equal(new[] { "Q", "ET" }, outputs);
            Assert.Equal(0, builds);
        }

        [Fact]
        public void A_model_that_has_precompiled_no_library_is_refused_by_name_never_built()
        {
            var ex = Assert.ThrowsAny<Exception>(() => Read(new LanguageModel(new Signature("REAL32__ADD", false)), s => s.BlockOutputs("TON")));
            Assert.Contains("has precompiled no library", ex.Message);
            Assert.Equal(0, _lastBuilds);
        }

        /// <summary>A push into a project CODESYS has precompiled nothing for is refused the same way: it never builds.</summary>
        [Fact]
        public void A_push_into_a_model_that_has_precompiled_no_library_is_refused_never_built()
        {
            var ex = Assert.ThrowsAny<Exception>(() => Read(new LanguageModel(new Signature("REAL32__ADD", false)), s => s.BlockOutputs("TON"), push: true));
            Assert.Contains("has precompiled no library", ex.Message);
            Assert.Equal(0, _lastBuilds);
        }

        /// <summary>A fetch's library extraction reads the precompiled model, one copy per application, and never builds
        /// (DIALECT C37d).</summary>
        [Fact]
        public void A_fetchs_library_extraction_reads_the_precompiled_model_without_a_build()
        {
            var (sigs, builds) = Drive(new LanguageModel(new Signature("TON", true, new Var("Q", "BOOL"))), d => d.ExtractLibrarySignatures());
            Assert.Equal(new[] { "TON" }, sigs.Select(s => s.Name).ToArray());
            Assert.Equal(0, builds);
        }

        /// <summary>Where CODESYS has precompiled nothing, the extraction is refused rather than answered empty — a fetch
        /// ships it as the complete per-library picture, and the client would delete every library file it holds.</summary>
        [Fact]
        public void A_fetchs_library_extraction_with_nothing_precompiled_is_refused_never_built()
        {
            var ex = Assert.ThrowsAny<Exception>(() => Drive(new LanguageModel(new Signature("REAL32__ADD", false)), d => d.ExtractLibrarySignatures()));
            Assert.Contains("has precompiled no library", ex.Message);
            Assert.Equal(0, _lastBuilds);
        }
    }
}
