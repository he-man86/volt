using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;
using static Volt.Ide.Codesys.Tests.CodesysObjectManagerOverloadTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE CODESYS DRIVER'S HALF OF THE BRIDGE-ONE-TO-ONE RED TESTS (openspec <c>bridge-one-to-one</c> §2.2): what the
    /// driver folds, hides or defaults today, each pinned against a double shaped like the census measured the vendor's
    /// object (design §0.1) and marked red (<see cref="ExpectRed"/>) until the step-3 task that closes it.
    ///
    /// <list type="bullet">
    /// <item>finding 1 — the class the walk folds onto the plain kind (<c>CodesysTypeMap.cs:58/59/68</c>);</item>
    /// <item>finding 3 — the object properties nothing reads (<c>meta.Properties[BuildProperty]</c>);</item>
    /// <item>finding 4 — the task: the external event folded into <c>Event:</c> (<c>Descriptors.cs:165-166</c>), a disabled
    /// watchdog's values hidden (<c>:168-171</c>), a bare <c>Watchdog: off</c> taken on CODESYS;</item>
    /// <item>finding 8 — the fallbacks: GET/SET by NAME (<c>CodesysTypeMap.cs:161</c>), a whitespace body read as none
    /// (<c>CodesysDriver.Content.cs:118</c>), a missing text read as <c>""</c> (<c>CodesysObjectModel.cs:172</c>), identity
    /// defaults (<c>:101-102</c>), the library defaults (<c>Libraries.cs:104/105</c>) and the task defaults
    /// (<c>Descriptors.cs:191</c>).</item>
    /// </list>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysOneToOneRedTests
    {
        // ── finding 1: the class ────────────────────────────────────────────────────────────────────────────────────

        /// <summary>A text-list enumeration (<c>TextListEnumerationObject</c>, 3 in the corpora) pulls its class:
        /// <c>%CLASS TEXTLIST_ENUM</c> closing its declaration (design §1.1 classes).</summary>
        [Fact]
        public void A_text_list_enumeration_pulls_its_class()
        {
            const string decl = "TYPE SER_Mode :\n(\n\tAuto := 0,\n\tManual\n);\nEND_TYPE";
            var node = new GuidNode("SER_Mode", new TextListEnum(decl));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new VendorObjectManager(new[] { node });
            try
            {
                var driver = new CodesysDriver(new Projects(new GuidNode("<project>", null, node)));
                var text = Materializer.Materialize(Volt.Engine.Sync.HostLink.Of(driver), "SER_Mode", ItemKind.Kinds.Dut, new ItemRef(node)).Text;
                Assert.Equal(decl + "\n%CLASS TEXTLIST_ENUM\n", text.Replace("\r\n", "\n"));
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        // ── finding 4: the task ─────────────────────────────────────────────────────────────────────────────────────

        /// <summary>A task node: the scripting facet a task answers through (<c>ScriptTaskObject</c>), and — read through
        /// the object manager by the node's handle and guid — the task OBJECT, whose archive carries the members the facet
        /// does not expose (the call list with its comments, <c>Core</c>, <c>TaskGroup</c>, …; design §1.1 "Tasks"). The
        /// facet alone used to be the whole read; the census showed members only the object carries.</summary>
        public sealed class TaskNode
        {
            public TaskNode(object facet) { Extender = new Ext(facet); Task = new TaskArchive(facet); }
            public Ext Extender { get; }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public TaskArchive Task { get; }
            public sealed class Ext
            {
                public Ext(object facet) => Extensions = new[] { facet };
                public IEnumerable Extensions { get; }
            }
        }

        /// <summary>The task object's archive as SP21 answers it (census §0.1 finding 5): every member at the value
        /// measured on 13 of 13 tasks, the parameter lists empty, the call list the facet's names with empty comments.</summary>
        public sealed class TaskArchive
        {
            private readonly object _facet;
            public TaskArchive(object facet) => _facet = facet;
            public string[] SerializableValueNames => new[]
            {
                "Core", "Core2", "TaskGroup", "AllowEmpty", "Implicit", "WithinSPSTimeSlicing", "SynchTask", "PouList",
                "CustomParameters", "IntervalParameters", "EventParameters", "ExternalEventParameters", "FreewheelingParameters",
            };
            public object? GetSerializableValue(string name) => name switch
            {
                "Core" => -1,
                "Core2" => -2,
                "TaskGroup" => "IEC-Tasks",
                "AllowEmpty" => false,
                "Implicit" => false,
                "WithinSPSTimeSlicing" => true,
                "SynchTask" => "",
                "PouList" => ((IEnumerable)_facet.GetType().GetProperty("pous")!.GetValue(_facet)!)
                    .Cast<object>().Select(n => new PouEntry(n.ToString()!, "")).ToList(),
                _ => new ArrayList(),
            };
        }

        /// <summary>One call entry — <c>PouObject</c>'s whole persisted contract.</summary>
        public sealed class PouEntry
        {
            public PouEntry(string name, string comment) { Name = name; Comment = comment; }
            public string Name { get; }
            public string Comment { get; }
        }

        /// <summary>The object manager a task read checks its object out through, by the node's guid.</summary>
        public sealed class TaskObjects
        {
            private readonly TaskNode _node;
            public TaskObjects(TaskNode node) => _node = node;
            public Meta GetObjectToRead(int handle, Guid guid) =>
                guid == _node.guid ? new Meta(_node.Task) : throw new InvalidOperationException("no such task");
        }

        /// <summary>The read checkout: the vendor answers an IMetaObject, whose <c>Object</c> is the task.</summary>
        public sealed class Meta { public Meta(object o) => Object = o; public object Object { get; } }

        public sealed class Watchdog
        {
            public bool enabled { get; set; }
            public string time { get; set; } = "";
            public string time_unit { get; set; } = "ms";
            public string sensitivity { get; set; } = "1";
        }

        public static class Full
        {
            public sealed class ScriptTaskObject
            {
                public object kind_of_task { get; set; } = "Cyclic";
                public string interval { get; set; } = "10";
                public string interval_unit { get; set; } = "ms";
                public string priority { get; set; } = "1";
                public string @event { get; set; } = "";
                public string external_event { get; set; } = "";
                public Watchdog watchdog { get; set; } = new();
                public IEnumerable pous { get; set; } = new[] { "PLC_PRG" };
            }
        }

        /// <summary>A facet that lacks <c>priority</c> — an SP whose scripting surface changed.</summary>
        public static class NoPriority
        {
            public sealed class ScriptTaskObject
            {
                public object kind_of_task { get; set; } = "Cyclic";
                public string interval { get; set; } = "10";
                public string interval_unit { get; set; } = "ms";
                public string @event { get; set; } = "";
                public string external_event { get; set; } = "";
                public Watchdog watchdog { get; set; } = new();
                public IEnumerable pous { get; set; } = new[] { "PLC_PRG" };
            }
        }

        private static string Descriptor(object facet)
        {
            var node = new TaskNode(facet);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new TaskObjects(node);
            try { return new CodesysObjectModel(null, platform: null).TaskDescriptor(node); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        private static string? Line(string text, string label) =>
            text.Replace("\r", "").Split('\n').FirstOrDefault(l => l.StartsWith(label + ":", StringComparison.Ordinal));

        /// <summary>An external event is its own label; the fold into <c>Event:</c> is deleted (a push moved it).</summary>
        [Fact]
        public void An_external_event_reads_as_its_own_label()
        {
            var text = Descriptor(new Full.ScriptTaskObject { kind_of_task = "ExternalEvent", external_event = "CanRx" });
            Assert.Null(Line(text, "Event"));
            Assert.Equal("CanRx", Line(text, "External event")?.Split(':')[1].Trim());
        }

        /// <summary>A disabled watchdog's three members are read as the vendor holds them (kept behind the flag across a
        /// reload, the unit too: <c>watchdog-off-values</c>).</summary>
        [Fact]
        public void A_disabled_watchdog_reads_its_values_behind_off()
        {
            var text = Descriptor(new Full.ScriptTaskObject
                { watchdog = new Watchdog { enabled = false, time = "3200", time_unit = "µs", sensitivity = "1" } });
            Assert.Equal("off 3200 µs (sensitivity 1)", Line(text, "Watchdog")?.Substring("Watchdog:".Length).Trim());
        }

        /// <summary>The census's CTP task: disabled, time <c>''</c>, unit <c>ms</c>, sensitivity <c>1</c>.</summary>
        [Fact]
        public void A_disabled_watchdog_with_an_empty_time_reads_it_as_an_empty_string()
        {
            var text = Descriptor(new Full.ScriptTaskObject { watchdog = new Watchdog { enabled = false, time = "" } });
            Assert.Equal("off '' ms (sensitivity 1)", Line(text, "Watchdog")?.Substring("Watchdog:".Length).Trim());
        }

        /// <summary>A task member the facet does not have is refused by name — never read as <c>""</c> (<c>Str</c>,
        /// <c>Descriptors.cs:191</c>).</summary>
        [Fact]
        public void A_missing_task_member_is_refused_by_name()
        {
            var ex = Assert.ThrowsAny<Exception>(() => Descriptor(new NoPriority.ScriptTaskObject()));
            Assert.Contains("priority", ex.Message);
        }

        /// <summary>On CODESYS a bare <c>Watchdog: off</c> is refused by name: the values behind the flag are content the
        /// vendor keeps, and a text that does not state them cannot say what to write (§1.2 "One watchdog spelling" —
        /// the bare form is TwinCAT's, whose task has no watchdog member).</summary>
        [Fact]
        public void A_bare_watchdog_off_is_refused_on_codesys()
        {
            var settings = TaskDescriptorFormat.Read("Type: Cyclic\nInterval: 10 ms\nPriority: 1\nWatchdog: off\n");
            var ex = Assert.ThrowsAny<Exception>(() => new CodesysDriver(projects: null).ValidateTask(settings));
            Assert.Contains("Watchdog", ex.Message);
        }

        // ── finding 8: the fallbacks ────────────────────────────────────────────────────────────────────────────────

        /// <summary>An accessor object whose <c>IsGetAccessor</c> is true, under a name that is not <c>Get</c>.</summary>
        public sealed class GetterObject : IObject, IPropertyAccessorObject
        {
            public GetterObject(string d, object i) : base(d, i) { }
            public bool IsGetAccessor => true;
        }

        /// <summary>GET or SET is the accessor's <c>IsGetAccessor</c> (archived as <c>IsGet</c>, 340 + 112 accessors), never its NAME
        /// (<c>CodesysTypeMap.RefineAccessor</c>).</summary>
        [Fact]
        public void An_accessor_is_GET_or_SET_by_its_IsGet_member_not_its_name()
        {
            var accessor = new Node("Set", 3, new GetterObject("", new _3S.CoDeSys.STObject.STImplementationObject()));
            var property = new Node("Ready", 2, new Property("PROPERTY Ready : BOOL"), accessor);
            var pou = new Node("FB_P", 1, new Pou("FUNCTION_BLOCK FB_P", new _3S.CoDeSys.STObject.STImplementationObject()), property);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, property, accessor });
            try
            {
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                var ready = read.Members.Single(m => m.Name == "Ready");
                Assert.NotNull(ready.Getter);
                Assert.Null(ready.Setter);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>A whitespace-only ST body is stored characters: spelled under <c>IMPLEMENTATION ST</c>, never read as
        /// "no body" (<c>BodyText</c>).</summary>
        [Fact]
        public void A_whitespace_only_body_is_spelled_not_read_as_none()
        {
            var body = new _3S.CoDeSys.STObject.STImplementationObject();
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try { Nwl.TextDocument.ThrowsAfterInsert = false; body.TextDocument.Insert(0, "\t\n"); }
            finally { Nwl.TextDocument.ThrowsAfterInsert = throws; }
            var pou = new Node("FB_Blank", 1, new Pou("FUNCTION_BLOCK FB_Blank", body));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou });
            try
            {
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                Assert.NotNull(read.Body);
                Assert.Contains("\t", read.Body);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        public sealed class NullDocument { public string? Text => null; }
        public sealed class NullTextAspect { public NullDocument TextDocument { get; } = new(); }
        public sealed class ObjectWithNullText { public NullTextAspect Interface { get; } = new(); }

        /// <summary>A text document whose <c>Text</c> is not there is refused by name — never read as <c>""</c>
        /// (<c>TryReadAspectText</c>), which would write an emptied declaration into the workspace.</summary>
        [Fact]
        public void A_text_document_with_no_text_is_refused_by_name()
        {
            var ex = Assert.ThrowsAny<Exception>(() => CodesysObjectModel.TryReadAspectText(new ObjectWithNullText(), "Interface"));
            Assert.Contains("Interface", ex.Message);
        }

        /// <summary>A node with no <c>guid</c> / <c>handle</c> is refused by name — never <c>Guid.Empty</c> / <c>0</c>,
        /// which address ANOTHER object (every node of a project shares handle 0).</summary>
        [Fact]
        public void A_node_with_no_identity_is_refused_by_name()
        {
            var model = new CodesysObjectModel(null, platform: null);
            Assert.Contains("guid", Assert.ThrowsAny<Exception>(() => model.GuidOf(new object())).Message);
            Assert.Contains("handle", Assert.ThrowsAny<Exception>(() => model.HandleOf(new object())).Message);
        }

        /// <summary>A library item that does not answer <c>Namespace</c> / <c>SystemLibrary</c>.</summary>
        public sealed class BareLibItem
        {
            public string Name => "Standard, 3.5.17.0 (System)";
            public IEnumerable GetDependencies() => new object[0];
        }

        /// <summary>A library reference's members are read, not defaulted: a missing <c>Namespace</c> or
        /// <c>SystemLibrary</c> refuses the reference by name (<c>Libraries.cs:104/105</c>).</summary>
        [Fact]
        public void A_library_reference_missing_a_member_is_refused_by_name()
        {
            // Looked up OUTSIDE the red body: a renamed helper fails this test loudly instead of keeping it red.
            var m = typeof(CodesysObjectModel).GetMethod("ToLibRef", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(m);
            var ex = Assert.ThrowsAny<Exception>(() =>
            {
                try { m!.Invoke(null, new object[] { new BareLibItem(), new System.Collections.Generic.Dictionary<string, string>() }); }
                catch (TargetInvocationException tie) { throw tie.InnerException!; }
            });
            Assert.True(ex.Message.Contains("Namespace") || ex.Message.Contains("SystemLibrary"), ex.Message);
        }
    }
}
