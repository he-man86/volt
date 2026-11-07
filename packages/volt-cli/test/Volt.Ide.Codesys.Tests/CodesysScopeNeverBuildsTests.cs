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

        private static (T Result, int Builds) Read<T>(LanguageModel model, Func<NetworkScope, T> ask, bool push = false)
        {
            var commands = new Commands();
            // An Application node, so the extraction's build would have something to build.
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Device", null, null, new TreeNode("Plc Logic", null, null, new TreeNode("Application", null, null))));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            _3S.CoDeSys.Core.SystemInstances.LanguageModelMgr = model;
            _3S.CoDeSys.ScriptDriverProjects.Common.CommandManager = commands;
            try
            {
                var driver = new CodesysDriver(new Projects(root));
                driver.WalkItems();
                const string declaration = "FUNCTION_BLOCK F\nVAR\n\tt1 : TON;\nEND_VAR\n";
                // A read (refs, fetch) writes a pulled body against the pull scope; a push reads its text against its own.
                var scope = push ? driver.NetworkScopeFor(declaration, PushedDeclarations.None) : driver.Declarations.ScopeForPull(declaration);
                return (ask(scope), commands.Builds);
            }
            finally
            {
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

        /// <summary>A push that finds the libraries precompiled does not build either: it may only where nothing is.</summary>
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
            var commands = 0;
            var ex = Assert.ThrowsAny<Exception>(() =>
            {
                var (_, builds) = Read(new LanguageModel(new Signature("REAL32__ADD", false)), s => s.BlockOutputs("TON"));
                commands = builds;
            });
            Assert.Contains("has precompiled no library", ex.Message);
            Assert.Equal(0, commands);
        }
    }
}
