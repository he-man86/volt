using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

// The property classes are told apart by their CLASS NAME (`CodesysObjectModel.ReadProperties`) and a fresh one is built
// by its FULL name (`AddProperty`), so the doubles carry the vendor's names — the names are the contract.
namespace _3S.CoDeSys.LanguageModelManager
{
    /// <summary><c>IMetaObject.Properties[BuildProperty]</c> — its seven archived members (census §0.1 finding 2).</summary>
    public sealed class BuildProperty
    {
        public bool ExcludeFromBuild { get; set; }
        public bool LinkAlways { get; set; }
        public bool External { get; set; }
        public bool EnableSystemCall { get; set; }
        public int MemoryReserveForOnlineChange { get; set; }
        public string CompilerDefines { get; set; } = "";
        public IList<string> Undefines { get; set; } = new List<string>();
    }
}

namespace _3S.CoDeSys.ObjectCommands
{
    /// <summary>The object comment (0 in the corpora).</summary>
    public sealed class DocumentationProperty { public string Documentation { get; set; } = ""; }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>A property class Volt has no text form for (0 in the corpora).</summary>
    public sealed class ObjectAccessProperty { }

    /// <summary>A check function: the class CODESYS keeps beside a plain POU (census: 15), its check in
    /// <c>KindOfCheckFunction</c>.</summary>
    public sealed class POUObjectCheckFunction : IObject, IPOUObject
    {
        public POUObjectCheckFunction(string d, object i, string check) : base(d, i) => KindOfCheckFunction = check;
        public string KindOfCheckFunction { get; }
        /// <summary>Its archive: the one member the census measured on a check function (<c>POULevel</c>, 15 of 15).</summary>
        public string POULevel { get; init; } = "Standard";
        public string[] SerializableValueNames => new[] { "POULevel" };
        public object? GetSerializableValue(string name) =>
            name == "POULevel" ? POULevel : throw new System.ArgumentException(name);
    }

    /// <summary>A plain POU with its ARCHIVE — the vendor class name, and the three members the census measured at one
    /// value on all 436 (design §1.1: <c>POULevel</c> Standard, <c>AddAttributeSubsequent</c> false, <c>ChildObjectGuids</c>
    /// empty).</summary>
    public sealed class POUObject : IObject, IPOUObject
    {
        public POUObject(string d, object i) : base(d, i) { }
        public string POULevel { get; init; } = "Standard";
        public bool AddAttributeSubsequent { get; init; }
        public System.Collections.ArrayList ChildObjectGuids { get; init; } = new();
        public string[] SerializableValueNames => new[] { "POULevel", "ChildObjectGuids", "AddAttributeSubsequent" };
        public object? GetSerializableValue(string name) => name switch
        {
            "POULevel" => POULevel,
            "AddAttributeSubsequent" => AddAttributeSubsequent,
            "ChildObjectGuids" => ChildObjectGuids,
            _ => throw new System.ArgumentException(name),
        };
    }

    /// <summary>
    /// THE CODESYS DRIVER READS AND WRITES AN OBJECT'S PROPERTIES (openspec <c>bridge-one-to-one</c> §1.1, §3, tasks 3.1 /
    /// 3.2): its <c>IMetaObject.Properties</c> — the build properties, the comment — and its class, spelled as the
    /// <c>%</c>-lines; a property class with no text form refuses the item by name; a write changes what differs and adds
    /// the vendor's property where the object has none.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysObjectPropertiesTests
    {
        /// <summary>A meta object that KEEPS its property list across checkouts, as the vendor's does.</summary>
        public sealed class PropMeta
        {
            public PropMeta(IObject o) => Object = o;
            public IObject Object { get; }
            public List<object> Props { get; } = new();
            public object[] Properties => Props.ToArray();
            public void AddProperty(object p) => Props.Add(p);
        }

        /// <summary>The object manager over <see cref="PropMeta"/>s, by handle.</summary>
        public sealed class PropManager
        {
            private readonly Dictionary<int, PropMeta> _byHandle = new();
            public int Commits { get; private set; }
            public PropManager(params (Node Node, object[] Props)[] nodes)
            {
                foreach (var (n, props) in nodes)
                {
                    var m = new PropMeta(n.Object);
                    m.Props.AddRange(props);
                    _byHandle[n.handle] = m;
                }
            }
            public PropMeta Meta(Node n) => _byHandle[n.handle];
            public PropMeta GetObjectToRead(int handle, Guid _) => _byHandle[handle];
            public PropMeta GetObjectToModify(int handle, Guid _) => _byHandle[handle];
            public void SetObject(PropMeta _, bool success, object? __) { if (success) Commits++; }
        }

        private static readonly Func<object> St = () => new _3S.CoDeSys.STObject.STImplementationObject();

        private static string Pulled(Node pou, params Node[] nodes)
        {
            var read = new CodesysDriver(projects: null);
            return Materializer.Materialize(read, pou.get_name(false), ItemKind.Kinds.Pou, new ItemRef(pou)).Text.Replace("\r\n", "\n");
        }

        private static T With<T>(PropManager mgr, Func<T> body)
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try { return body(); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_build_property_is_spelled_under_the_implementation_line()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var build = new _3S.CoDeSys.LanguageModelManager.BuildProperty
                { ExcludeFromBuild = true, MemoryReserveForOnlineChange = 200, Undefines = new List<string> { "SIM" } };
            var text = With(new PropManager((pou, new object[] { build })), () => Pulled(pou));

            Assert.Contains("IMPLEMENTATION ST\n%EXCLUDE_FROM_BUILD\n%ONLINE_CHANGE_RESERVE 200\n%UNDEFINE 'SIM'\n", text);
        }

        /// <summary>A build property whose seven members are all at their measured default spells nothing (31 of the 56).</summary>
        [Fact]
        public void A_defaulted_build_property_spells_nothing()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var text = With(new PropManager((pou, new object[] { new _3S.CoDeSys.LanguageModelManager.BuildProperty() })), () => Pulled(pou));
            Assert.DoesNotContain("%", text);
        }

        [Fact]
        public void A_check_function_pulls_its_class()
        {
            var pou = new Node("CheckBounds", 1, new POUObjectCheckFunction("FUNCTION CheckBounds : DINT", St(), "CheckBounds"));
            var text = With(new PropManager((pou, Array.Empty<object>())), () => Pulled(pou));
            Assert.Contains("IMPLEMENTATION ST\n%CLASS CHECK CheckBounds\n", text);
        }

        /// <summary>A plain POU at every measured constant pulls with no property line.</summary>
        [Fact]
        public void A_pou_at_its_measured_constants_pulls_plain()
        {
            var pou = new Node("FB_X", 1, new POUObject("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var text = With(new PropManager((pou, Array.Empty<object>())), () => Pulled(pou));
            Assert.DoesNotContain("%", text);
        }

        /// <summary>A member measured at ONE value on every corpus object, held at another, refuses the item BY NAME (design
        /// §1.1 "Members of the source classes"; gate review of step 3, finding 2) — it was read by nothing, so the POU pulled
        /// as a plain one and a create from that text made the measured default.</summary>
        [Theory]
        [InlineData("POULevel")]
        [InlineData("AddAttributeSubsequent")]
        [InlineData("ChildObjectGuids")]
        public void A_pou_off_a_measured_constant_is_refused_by_name(string member)
        {
            var obj = member switch
            {
                "POULevel" => new POUObject("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()) { POULevel = "Extended" },
                "AddAttributeSubsequent" => new POUObject("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()) { AddAttributeSubsequent = true },
                _ => new POUObject("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St())
                    { ChildObjectGuids = new System.Collections.ArrayList { Guid.NewGuid() } },
            };
            var pou = new Node("FB_X", 1, obj);
            var ex = Assert.Throws<BridgeException>(() => With(new PropManager((pou, Array.Empty<object>())), () => Pulled(pou)));
            Assert.Contains("'FB_X'", ex.Message);
            Assert.Contains($"'{member}'", ex.Message);
        }

        /// <summary>A body aspect's <c>ParameterInitializationMethodGenerator</c> (null on all 3 that archive it), held
        /// non-null, refuses the item by name.</summary>
        [Fact]
        public void A_body_aspect_off_its_measured_constant_is_refused_by_name()
        {
            var impl = new Archived.STImplementationObject { Generator = new object() };
            var pou = new Node("FB_X", 1, new POUObject("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", impl));
            var ex = Assert.Throws<BridgeException>(() => With(new PropManager((pou, Array.Empty<object>())), () => Pulled(pou)));
            Assert.Contains("ParameterInitializationMethodGenerator", ex.Message);
        }

        /// <summary>A property class Volt has no text form for refuses the item BY NAME — never pulled without it.</summary>
        [Fact]
        public void A_property_with_no_text_form_refuses_the_item_by_name()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var ex = Assert.Throws<BridgeException>(() =>
                With(new PropManager((pou, new object[] { new ObjectAccessProperty() })), () => Pulled(pou)));
            Assert.Contains("ObjectAccessProperty", ex.Message);
            Assert.Contains("'FB_X'", ex.Message);
        }

        /// <summary>A push that excludes an object with no build property ADDS the vendor's property, in the write's own
        /// transaction; one that clears it sets the members back.</summary>
        [Fact]
        public void A_write_adds_the_build_property_and_clears_it_again()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var mgr = new PropManager((pou, Array.Empty<object>()));
            var excluded = ObjectProperties.None with { ExcludeFromBuild = true, Comment = "doc" };

            With(mgr, () =>
            {
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", "x := 1;", new List<Member>(), excluded, Stated: StatedLanguage.St),
                    Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());
                return 0;
            });
            var build = Assert.Single(mgr.Meta(pou).Props.OfType<_3S.CoDeSys.LanguageModelManager.BuildProperty>());
            Assert.True(build.ExcludeFromBuild);
            Assert.Equal("doc", Assert.Single(mgr.Meta(pou).Props.OfType<_3S.CoDeSys.ObjectCommands.DocumentationProperty>()).Documentation);

            With(mgr, () =>
            {
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", "x := 1;", new List<Member>(),
                                    ObjectProperties.None, Stated: StatedLanguage.St),
                    Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());
                return 0;
            });
            Assert.False(build.ExcludeFromBuild);
        }

        /// <summary>An unchanged property set is not checked out at all.</summary>
        [Fact]
        public void An_unchanged_property_set_is_not_written()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var mgr = new PropManager((pou, Array.Empty<object>()));
            With(mgr, () =>
            {
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", "x := 1;", new List<Member>(),
                                    ObjectProperties.None, Stated: StatedLanguage.St),
                    Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());
                return 0;
            });
            Assert.Equal(1, mgr.Commits);   // the text write's own transaction, and no property checkout
        }

        /// <summary>A CREATE of a list that sends network variables (<c>%NETVAR</c> without <c>%CLASS NVL</c>) or of a parameter
        /// list (<c>%PARAMETER_LIST</c>) is refused by name in the push PRE-FLIGHT, as a create — it used to make a plain GVL,
        /// refuse the write as "a %NETVAR change" and roll back (gate review of step 3, finding 7c).</summary>
        [Theory]
        [InlineData("%NETVAR")]
        [InlineData("%PARAMETER_LIST")]
        public void A_create_carrying_netvar_or_a_parameter_list_is_refused_by_name_as_a_create(string key)
        {
            var props = key == "%NETVAR"
                ? ObjectProperties.None with { NetVar = new[] { new NetVarSetting("TaskName", "T") } }
                : ObjectProperties.None with { ParameterList = true };
            var ex = Assert.Throws<BridgeException>(() =>
                new CodesysDriver(projects: null).ValidateProperties("'G'", props, create: true));
            Assert.Contains("'G'", ex.Message);
            Assert.Contains(key, ex.Message);
            Assert.Contains("create", ex.Message);
            Assert.DoesNotContain("change", ex.Message);

            // An update of a list that already holds them is no create: the pre-flight passes it (an unchanged one writes
            // nothing; a change is refused by the write, by name).
            new CodesysDriver(projects: null).ValidateProperties("'G'", props, create: false);
        }

        /// <summary>A CREATE of a persistent list (<c>%CLASS PERSISTENT</c>) or a network variable list (<c>%CLASS NVL</c>) is
        /// refused in the push PRE-FLIGHT too (second review of step 3, finding 5): both refusals are decidable from the
        /// text, and from <c>CreateClass</c> alone they came in the apply loop — after the batch's earlier ops had landed
        /// (accepted with a conflict instead of all-or-nothing). An update keeps the class and passes.</summary>
        [Theory]
        [InlineData(ObjectClass.Persistent)]
        [InlineData(ObjectClass.Nvl)]
        public void A_create_of_a_persistent_or_network_variable_list_is_refused_in_the_preflight(string word)
        {
            var props = ObjectProperties.None with { Class = new ObjectClass(word, null) };
            var ex = Assert.Throws<BridgeException>(() =>
                new CodesysDriver(projects: null).ValidateProperties("'PV2'", props, create: true));
            Assert.Contains("'PV2'", ex.Message);
            Assert.Contains($"%CLASS {word}", ex.Message);

            new CodesysDriver(projects: null).ValidateProperties("'PV2'", props, create: false);
        }

        /// <summary>A network-variable change has no measured write (1 occurrence, no fixture): refused by name.</summary>
        [Fact]
        public void A_netvar_change_is_refused_by_name()
        {
            var pou = new Node("FB_X", 1, new Pou("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", St()));
            var ex = Assert.Throws<BridgeException>(() => With(new PropManager((pou, Array.Empty<object>())), () =>
            {
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", "x := 1;", new List<Member>(),
                                    ObjectProperties.None with { NetVar = new[] { new NetVarSetting("TaskName", "T") } }, Stated: StatedLanguage.St),
                    Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());
                return 0;
            }));
            Assert.Contains("%NETVAR", ex.Message);
        }
    }
}

namespace Volt.Ide.Codesys.Tests.Archived
{
    /// <summary>An ST body aspect WITH its archive, holding <c>ParameterInitializationMethodGenerator</c> (design §1.1:
    /// null on the 3 aspects that archive it).</summary>
    internal sealed class STImplementationObject
    {
        public Volt.Ide.Codesys.Tests.Nwl.TextDocument TextDocument { get; } = new Volt.Ide.Codesys.Tests.Nwl.TextDocument();
        public object? Generator { get; init; }
        public string[] SerializableValueNames => new[] { "ParameterInitializationMethodGenerator", "TextDocument" };
        public object? GetSerializableValue(string name) =>
            name == "ParameterInitializationMethodGenerator" ? Generator : throw new System.ArgumentException(name);
    }
}
