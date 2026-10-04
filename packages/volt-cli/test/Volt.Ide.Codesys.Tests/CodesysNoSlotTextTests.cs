using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A TEXT SENT AT A SLOT THE OBJECT LACKS IS REFUSED BY NAME, NEVER DROPPED (openspec <c>bridge-refusal-review</c>
    /// D26, task 4.26).
    ///
    /// <para><c>SetAspectText</c> returned on a missing aspect: a body pushed at an object with no <c>Implementation</c>
    /// landed nothing while the transaction committed and the push reported "updated". The write asks the OBJECT now — a
    /// non-null text at a missing <c>Interface</c> / <c>Implementation</c> is <c>UNSUPPORTED</c> naming the item and the
    /// slot, raised before any aspect is written, and the checkout is rolled back. A slot the caller sends nothing for
    /// (null) is never asked: a property's or a GVL's body is null from the reader (<c>StReader</c>), not "".</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysNoSlotTextTests
    {
        /// <summary>A POU-classified object with an <c>Interface</c> and NO <c>Implementation</c> member at all.</summary>
        public sealed class PouWithoutBody : IPOUObject
        {
            public PouWithoutBody(string declaration) => Interface = new TextAspect(declaration);
            public TextAspect Interface { get; }
        }

        /// <summary>A POU-classified object with an <c>Implementation</c> and NO <c>Interface</c> member at all.</summary>
        public sealed class PouWithoutDeclaration : IPOUObject
        {
            public PouWithoutDeclaration(string body) => Implementation = new TextAspect(body);
            public TextAspect Implementation { get; }
        }

        public sealed class Tracked
        {
            public Tracked(object o) => Object = o;
            public object Object { get; }
        }

        /// <summary>The object manager over any objects by handle, counting commits AND rollbacks.</summary>
        public sealed class CountingManager
        {
            private readonly Dictionary<int, object> _byHandle = new();
            public int Commits { get; private set; }
            public int Rollbacks { get; private set; }
            public CountingManager(params CodesysLanguageChangeTests.AnyNode[] nodes) { foreach (var n in nodes) _byHandle[n.handle] = n.Object; }
            public Tracked GetObjectToRead(int handle, Guid _) => new(_byHandle[handle]);
            public Tracked GetObjectToModify(int handle, Guid _) => new(_byHandle[handle]);
            public void SetObject(Tracked _, bool success, object? __) { if (success) Commits++; else Rollbacks++; }
        }

        const string Decl = "FUNCTION_BLOCK FB_A\nVAR\n\tx : INT;\nEND_VAR";

        static CountingManager Install(CodesysLanguageChangeTests.AnyNode node)
        {
            var manager = new CountingManager(node);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            return manager;
        }

        [Fact]
        public void A_body_at_an_object_with_no_Implementation_is_refused_by_name_and_rolled_back()
        {
            var obj = new PouWithoutBody("FUNCTION_BLOCK FB_A");
            var node = new CodesysLanguageChangeTests.AnyNode("FB_A", 1, obj);
            var manager = Install(node);
            try
            {
                var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(projects: null).WriteContent(new ItemRef(node),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, "x := x + 1;", new List<Member>(), Stated: StatedLanguage.St),
                    Array.Empty<Volt.Engine.Ide.PushedNetworkBody>()));

                Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("'FB_A'", ex.Message);
                Assert.Contains("Implementation", ex.Message);
                Assert.Equal(0, manager.Commits);
                Assert.Equal(1, manager.Rollbacks);
                Assert.Equal("FUNCTION_BLOCK FB_A", obj.Interface.TextDocument.Text);   // refused before any aspect was written
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_declaration_at_an_object_with_no_Interface_is_refused_by_name_and_rolled_back()
        {
            var obj = new PouWithoutDeclaration("x := 0;");
            var node = new CodesysLanguageChangeTests.AnyNode("FB_A", 1, obj);
            var manager = Install(node);
            try
            {
                var ex = Assert.Throws<BridgeException>(() =>
                    new CodesysObjectModel(projects: null).WriteSourceText(node, Decl, "x := 1;"));

                Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("'FB_A'", ex.Message);
                Assert.Contains("Interface", ex.Message);
                Assert.Equal(0, manager.Commits);
                Assert.Equal(1, manager.Rollbacks);
                Assert.Equal("x := 0;", obj.Implementation.TextDocument.Text);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>No text for the missing slot: nothing is asked and the declaration lands — a property or a GVL.</summary>
        [Fact]
        public void A_declaration_alone_at_an_object_with_no_Implementation_lands()
        {
            var obj = new PouWithoutBody("FUNCTION_BLOCK FB_A");
            var node = new CodesysLanguageChangeTests.AnyNode("FB_A", 1, obj);
            var manager = Install(node);
            try
            {
                new CodesysObjectModel(projects: null).WriteSourceText(node, Decl, null);

                Assert.Equal(Decl, obj.Interface.TextDocument.Text);
                Assert.Equal(1, manager.Commits);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
