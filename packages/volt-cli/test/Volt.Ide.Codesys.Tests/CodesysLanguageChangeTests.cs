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
    /// CODESYS's half of the one language-change comparison (openspec <c>bridge-refusal-review</c> D7; DIALECT N24):
    /// a POU's own body takes an aspect of the other language IN PLACE — a freshly constructed
    /// <c>STImplementationObject</c> / <c>NWLImplementationObject</c> on the same object, which took the driver's own text
    /// and network writes, built and ran — and every other site, a separate object no measurement covered, is refused by
    /// name. The write asks the same predicate as the push's guard, so the two cannot disagree. And the read hands the
    /// body's language up as the fact it took it from (D6).
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysLanguageChangeTests
    {
        /// <summary>A POU whose body aspect can be REPLACED — <c>IPOUObject.Implementation</c> is writable (N24).</summary>
        public sealed class SwappablePou : IPOUObject
        {
            public SwappablePou(string declaration, object implementation)
            {
                Interface = new TextAspect(declaration);
                Implementation = implementation;
            }
            public TextAspect Interface { get; }
            public object? Implementation { get; set; }
        }

        /// <summary>A tree node over any object (the shared <see cref="Node"/> takes the shared IObject double).</summary>
        public sealed class AnyNode
        {
            private readonly List<object> _children;
            public AnyNode(string name, int h, object obj, params object[] children)
            {
                Name = name;
                handle = h;
                Object = obj;
                _children = new List<object>(children);
            }
            private string Name { get; }
            public int handle { get; }
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => false;
            public object Object { get; }
            public string get_name(bool _) => Name;
            public IEnumerable<object> get_children(bool _) => _children;
        }

        /// <summary>The object manager over any objects, by handle.</summary>
        public sealed class AnyManager
        {
            private readonly Dictionary<int, object> _byHandle = new Dictionary<int, object>();
            public AnyManager(params AnyNode[] nodes) { foreach (var n in nodes) _byHandle[n.handle] = n.Object; }
            public AnyMeta GetObjectToRead(int handle, Guid _) => new AnyMeta(_byHandle[handle]);
            public AnyMeta GetObjectToModify(int handle, Guid _) => new AnyMeta(_byHandle[handle]);
            public void SetObject(AnyMeta _, bool success, object? __) { }
        }

        public sealed class AnyMeta
        {
            public AnyMeta(object o) => Object = o;
            public object Object { get; }
        }

        const string Decl = "PROGRAM P\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR";

        /// <summary>A POU's, a METHOD's, an ACTION's and a property accessor's body each change language in place —
        /// measured live, each in both directions, built and run (N24, <c>scripts/member-language-change.log</c>).</summary>
        [Theory]
        [InlineData("pou")]
        [InlineData("method")]
        [InlineData("action")]
        [InlineData("property_get")]
        [InlineData("property_set")]
        public void Every_measured_site_is_written_by_CODESYS(string site)
        {
            var driver = new CodesysDriver(projects: null);
            Assert.Null(driver.RefusedLanguageChange(site, "FBD", "ST"));
            Assert.Null(driver.RefusedLanguageChange(site, "ST", "LD"));
        }

        /// <summary>A site no measurement covered is refused by name, never guessed writable.</summary>
        [Fact]
        public void An_unmeasured_site_is_refused_by_name()
        {
            var why = new CodesysDriver(projects: null).RefusedLanguageChange("transition", "ST", "LD");
            Assert.NotNull(why);
            Assert.Contains("not measured on CODESYS", why);
        }

        /// <summary>ST pushed over the POU's LD body: the write puts a fresh ST aspect on the SAME object and writes the
        /// text into it, in one transaction.</summary>
        [Fact]
        public void ST_over_a_network_body_swaps_the_aspect_and_writes_the_text()
        {
            var obj = new SwappablePou(Decl, new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" });
            var pou = new AnyNode("P", 1, obj);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, "q := NOT a;", new List<Member>(), Stated: StatedLanguage.St),
                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                var st = Assert.IsType<_3S.CoDeSys.STObject.STImplementationObject>(obj.Implementation);
                Assert.Equal("q := NOT a;", st.TextDocument.Text);
                Assert.Same(obj, pou.Object);   // the same object: the guid is kept
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>The same body language as the IDE's swaps nothing (an ordinary ST write).</summary>
        [Fact]
        public void The_same_language_swaps_nothing()
        {
            var held = new _3S.CoDeSys.STObject.STImplementationObject();
            var obj = new SwappablePou(Decl, held);
            var pou = new AnyNode("P", 1, obj);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, "q := a;", new List<Member>(), Stated: StatedLanguage.St),
                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Same(held, obj.Implementation);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>A write that carries NO body swaps nothing, whatever language it states (review of 4a, medium). The
        /// push writes the declaration first and alone (<c>split with { Body = null }</c>) when it creates a member and
        /// the declaration changes; that copy keeps <c>Stated</c>. Swapping on it put an EMPTY aspect of the new language
        /// on the object and committed it — the body the IDE held was gone before the real body was written, and lost
        /// for good when anything between the two writes threw.</summary>
        [Fact]
        public void A_write_without_a_body_swaps_nothing_whatever_it_states()
        {
            var held = new _3S.CoDeSys.STObject.STImplementationObject();
            var obj = new SwappablePou(Decl, held);
            var pou = new AnyNode("P", 1, obj);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, null, new List<Member>(), Stated: StatedLanguage.Shown("LD")),
                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Same(held, obj.Implementation);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>An EMPTY pushed body that states no language — the ST reader's bare accessor keyword — is ST to the
        /// write exactly as it is to the guard (review of 4a): over an LD body it swaps in an ST aspect and writes the
        /// empty text there. It used to swap nothing and set "" on the network aspect, a raw vendor throw mid-apply after
        /// the guard had allowed it.</summary>
        [Fact]
        public void An_empty_body_stating_no_language_is_ST_to_the_write_as_to_the_guard()
        {
            var obj = new SwappablePou(Decl, new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" });
            var pou = new AnyNode("P", 1, obj);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, "", new List<Member>()),
                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                var st = Assert.IsType<_3S.CoDeSys.STObject.STImplementationObject>(obj.Implementation);
                Assert.Equal("", st.TextDocument.Text);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>A METHOD whose body can be replaced — its own object, as N24 measured it.</summary>
        public sealed class SwappableMethod : IPOUMethodObject
        {
            public SwappableMethod(string declaration, object implementation)
            {
                Interface = new TextAspect(declaration);
                Implementation = implementation;
            }
            public TextAspect Interface { get; }
            public object? Implementation { get; set; }
        }

        /// <summary>A METHOD's body changes language through the same write: ST over its FBD body puts a fresh ST aspect
        /// on the method's own object and writes the text into it.</summary>
        [Fact]
        public void A_method_body_changes_language_through_the_same_write()
        {
            var obj = new SwappableMethod("METHOD Step : BOOL", new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" });
            var method = new AnyNode("Step", 2, obj);
            var pou = new AnyNode("P", 1, new SwappablePou(Decl, new _3S.CoDeSys.STObject.STImplementationObject()), method);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou, method);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, Decl, null, new List<Member>
                    {
                        new(ItemKind.Kinds.Method, "Step", "METHOD Step : BOOL", "Step := TRUE;", Stated: StatedLanguage.St),
                    }), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                var st = Assert.IsType<_3S.CoDeSys.STObject.STImplementationObject>(obj.Implementation);
                Assert.Equal("Step := TRUE;", st.TextDocument.Text);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>D6: the read states each body's language as the aspect says it — ST, the network view, a hidden
        /// language — beside the text that spells it.</summary>
        [Theory]
        [InlineData("Ld", "LD", false)]
        [InlineData("Fbd", "FBD", false)]
        [InlineData("Il", "IL", true)]
        public void The_read_states_the_language_of_a_network_aspect(string view, string language, bool hidden)
        {
            var pou = new Node("P", 1, new Pou(Decl, new Nwl.NWLImplementationObject { DefaultViewMode = view }));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou });
            var was = Volt.Engine.Format.Network.NetworkTextSwitch.Enabled;
            try
            {
                Volt.Engine.Format.Network.NetworkTextSwitch.Enabled = true;
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                Assert.Equal(new StatedLanguage(language, hidden), read.Stated);
            }
            finally
            {
                Volt.Engine.Format.Network.NetworkTextSwitch.Enabled = was;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }
    }
}
