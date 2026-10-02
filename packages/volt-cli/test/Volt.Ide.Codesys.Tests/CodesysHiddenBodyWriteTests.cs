using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;

// The object manager is reached as `_3S.CoDeSys.Core.SystemInstances.ObjectMgr` (`CodesysObjectModel`'s constructor
// finds the type by its FULL name in the AppDomain), so the double carries the vendor's namespace — the same rule
// `StObjectDoubles` follows: the names are the contract.
namespace _3S.CoDeSys.Core
{
    internal static partial class SystemInstances
    {
        public static object? ObjectMgr { get; set; }
    }
}

namespace Volt.Ide.Codesys.Tests
{
    // The classification basis is the INTERFACE NAMES an IObject implements (`CodesysTypeMap.CodeForObject`), so
    // empty interfaces with the vendor's names are all a double needs to be classified as one.
    internal interface IPOUObject { }
    internal interface IPOUMethodObject { }
    internal interface IPropertyObject { }
    internal interface IPropertyAccessorObject { }

    /// <summary>
    /// THE CODESYS WRITER NEVER WRITES A BODY VOLT DOES NOT SHOW (openspec <c>implementation-keyword</c> 3b) — the
    /// CODESYS twin of <c>TcHiddenBodyWriteTests</c>.
    ///
    /// <para>A CFC, SFC or IL body, and an LD/FBD body network text cannot represent, is its
    /// <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> line in the workspace. Its DECLARATION is editable and is pushed; its
    /// body must not be: a CFC aspect has no text document at all, so writing the line into it fails after the
    /// declaration committed, and an aspect that has one would store the line over the diagram. This drives
    /// <see cref="CodesysDriver.WriteContent"/> — the POU, a method and a property accessor, each hidden — through the
    /// object manager's own checkout/commit, and asserts every declaration lands and no implementation aspect is so
    /// much as touched.</para>
    /// </summary>
    public class CodesysHiddenBodyWriteTests
    {
        /// <summary>A text document: the text an aspect holds.</summary>
        public sealed class Document { public string Text { get; set; } = ""; }

        /// <summary>An aspect with a text document — the <c>Interface</c> (declaration) aspect every object has.</summary>
        public sealed class TextAspect
        {
            public TextAspect(string text) => TextDocument = new Document { Text = text };
            public Document TextDocument { get; }
        }

        /// <summary>A diagram's implementation aspect: no text document, as a CFC/SFC/NWL aspect has none.</summary>
        public sealed class DiagramAspect
        {
            public DiagramAspect(string drawn) => Drawn = drawn;
            public string Drawn { get; }
        }

        /// <summary>An IObject: its declaration aspect, and an implementation aspect whose every READ is counted — the
        /// writer reaches an aspect only to write it, so zero reads is "never written".</summary>
        public abstract class IObject
        {
            private readonly object? _implementation;
            protected IObject(string declaration, object? implementation)
            {
                Interface = new TextAspect(declaration);
                _implementation = implementation;
            }
            public TextAspect Interface { get; }
            public int ImplementationReads { get; private set; }
            public object? Implementation { get { ImplementationReads++; return _implementation; } }
        }

        public sealed class Pou : IObject, IPOUObject { public Pou(string d, object i) : base(d, i) { } }
        public sealed class Method : IObject, IPOUMethodObject { public Method(string d, object i) : base(d, i) { } }
        public sealed class Property : IObject, IPropertyObject { public Property(string d) : base(d, null) { } }
        public sealed class AccessorObject : IObject, IPropertyAccessorObject { public AccessorObject(string d, object i) : base(d, i) { } }

        /// <summary>A project-tree node, as the scripting API hands one out.</summary>
        public sealed class Node
        {
            private readonly string _name;
            private readonly List<Node> _children;
            public Node(string name, int h, IObject obj, params Node[] children)
            {
                _name = name;
                handle = h;
                Object = obj;
                _children = children.ToList();
            }
            public int handle { get; }
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => false;
            public IObject Object { get; }
            public string get_name(bool _) => _name;
            public IEnumerable<Node> get_children(bool _) => _children;
        }

        public sealed class Meta
        {
            public Meta(IObject o) => Object = o;
            public IObject Object { get; }
        }

        /// <summary>The object manager: a read or modify checkout by handle, and the commit that ends one.</summary>
        public sealed class ObjectManager
        {
            private readonly Dictionary<int, IObject> _byHandle = new();
            public int Commits { get; private set; }
            public ObjectManager(IEnumerable<Node> nodes) { foreach (var n in nodes) _byHandle[n.handle] = n.Object; }
            public Meta GetObjectToRead(int handle, Guid _) => new(_byHandle[handle]);
            public Meta GetObjectToModify(int handle, Guid _) => new(_byHandle[handle]);
            public void SetObject(Meta _, bool success, object? __) { if (success) Commits++; }
        }

        [Theory]
        [InlineData("CFC")]
        [InlineData("SFC")]
        [InlineData("IL")]
        [InlineData("LD")]
        [InlineData("FBD")]
        public void A_pushed_declaration_lands_and_no_hidden_body_is_written(string language)
        {
            var line = $"IMPLEMENTATION {language} UNSUPPORTED";
            var getter = new Node("Get", 4, new AccessorObject("VAR\nEND_VAR", new DiagramAspect("the getter's chart")));
            var property = new Node("Ready", 3, new Property("PROPERTY Ready : BOOL"), getter);
            var method = new Node("Step", 2, new Method("METHOD Step : BOOL", new DiagramAspect("the method's ladder")));
            var pou = new Node("FB_Chart", 1, new Pou("FUNCTION_BLOCK FB_Chart\nVAR\nEND_VAR", new DiagramAspect("the POU's chart")),
                               method, property);
            var manager = new ObjectManager(new[] { pou, method, property, getter });
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                var content = new ItemContent(ItemKind.Kinds.Pou,
                    "FUNCTION_BLOCK FB_Chart\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\nVAR\nEND_VAR", line,
                    new List<Member>
                    {
                        new(ItemKind.Kinds.Method, "Step", "METHOD Step : BOOL\nVAR_INPUT\n\tn : INT;\nEND_VAR", line),
                        new(ItemKind.Kinds.Property, "Ready", "PROPERTY Ready : BOOL", null,
                            Getter: new Accessor("VAR\n\tb : BOOL;\nEND_VAR", line), Setter: null),
                    });

                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou), content, Volt.Engine.Ide.PushedDeclarations.None);

                Assert.Contains("bStart : BOOL;", pou.Object.Interface.TextDocument.Text);
                Assert.Contains("n : INT;", method.Object.Interface.TextDocument.Text);
                Assert.Contains("b : BOOL;", getter.Object.Interface.TextDocument.Text);
                Assert.True(manager.Commits >= 4, $"{manager.Commits} commit(s): every declaration is its own transaction");
                foreach (var node in new[] { pou, method, getter })
                    Assert.True(node.Object.ImplementationReads == 0,
                        $"'{node.get_name(false)}': its implementation aspect was reached {node.Object.ImplementationReads} time(s)");
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
