using System;
using System.Collections.Generic;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE DEVICE DESCRIPTOR READS THE NAMED VENDOR MEMBER (openspec <c>bridge-one-to-one</c> §1.1 "Non-source items": "the
    /// first that answers name read deleted (the vendor member is named"; gate review of step 3, finding 10). The scripting
    /// identification is <c>IDeviceId</c> — <c>type</c>, <c>id</c>, <c>version</c> (SP21, ScriptEngine3 4.2.0.0) — and each
    /// line was asked under several names, the first that yielded anything winning, so another member answering first was
    /// read as the device's type; and one that answered none read as an empty line.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysDeviceDescriptorTests
    {
        public sealed class DeviceInfo
        {
            public string Name => "CODESYS Control Win V3";
            public string Vendor => "CODESYS GmbH";
            public string OrderNumber => "-";
            public string Description => "a soft PLC";
        }

        public sealed class Readable { public DeviceInfo DeviceInfo { get; } = new(); }

        /// <summary><c>IDeviceId</c>'s members, and a decoy a "first name that answers" read took for the type.</summary>
        public sealed class DeviceId
        {
            public int type { get; init; } = 4096;
            public string id { get; init; } = "0000 0004";
            public string version { get; init; } = "3.5.21.0";
            public string TypeId => "decoy";
        }

        /// <summary>A device id that answers no <c>version</c>.</summary>
        public sealed class PartialDeviceId
        {
            public int type => 4096;
            public string id => "0000 0004";
        }

        public sealed class ScriptDeviceObject
        {
            private readonly object _id;
            public ScriptDeviceObject(object id) => _id = id;
            public Readable GetReadable() => new();
            public object get_device_identification() => _id;
        }

        public sealed class Extender { public Extender(object facet) => Extensions = new[] { facet }; public object[] Extensions { get; } }

        public sealed class DeviceObject { public bool Disable => false; public bool Exclude => false; }

        public sealed class Node
        {
            public Node(object facet) => Extender = new Extender(facet);
            public Extender Extender { get; }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => false;
            public string get_name(bool _) => "Device";
        }

        public sealed class Meta { public object Object { get; } = new DeviceObject(); }
        public sealed class Manager { public Meta GetObjectToRead(int h, Guid g) => new(); }

        private static string Descriptor(object id)
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager();
            try { return new CodesysDriver(projects: null).ReadManifest(new ItemRef(new Node(new ScriptDeviceObject(id))), ItemKind.Kinds.Device); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void The_type_line_is_the_named_vendor_member()
        {
            var text = Descriptor(new DeviceId()).Replace("\r\n", "\n");
            Assert.Contains("4096", text);
            Assert.DoesNotContain("decoy", text);
            Assert.Contains("0000 0004", text);
            Assert.Contains("3.5.21.0", text);
        }

        /// <summary>A NODE WITHOUT THE FACET is a fact of that node, not of the IDE version: the read is refused UNSUPPORTED
        /// (Volt reads no such node), never IDE_UNSUPPORTED, whose remedy is "the IDE has to change" (gate 3c review,
        /// finding 8).</summary>
        [Fact]
        public void A_node_without_the_device_facet_is_refused_UNSUPPORTED()
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager();
            try
            {
                var ex = Assert.Throws<Volt.Engine.BridgeException>(() =>
                    new CodesysDriver(projects: null).ReadManifest(new ItemRef(new Node(new DeviceObject())), ItemKind.Kinds.Device));
                Assert.Equal(Volt.Contracts.BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("ScriptDeviceObject", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>A member the identification does not answer is refused by name — never an empty line.</summary>
        [Fact]
        public void An_identification_member_that_is_not_there_is_refused_by_name()
        {
            var ex = Assert.ThrowsAny<Exception>(() => Descriptor(new PartialDeviceId()));
            Assert.Contains("version", ex.Message);
        }
    }
}
