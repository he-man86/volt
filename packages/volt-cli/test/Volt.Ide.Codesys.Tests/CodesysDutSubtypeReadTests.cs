using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;
using static Volt.Ide.Codesys.Tests.CodesysObjectManagerOverloadTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE CODESYS DRIVER STATES A DUT'S SUBTYPE ON ITS CONTENT (openspec <c>push-without-header-check</c> 5.B.1): for a
    /// DUT — an <c>IDUTObject</c> or a text-list enumeration — <see cref="CodesysDriver.ReadContent"/> sets
    /// <see cref="ItemContent.DutSubtype"/>, null where it has no answer (the engine then publishes <c>name.dut</c>), and
    /// null for every other kind. INTERIM source (design 5.B choice 7): the engine's <c>CodeHelper.TryDutSubtype</c>
    /// until 5.D answers from the precompile signature — so these rows pin the contract (which kinds carry an answer,
    /// and null for no answer), not the source.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysDutSubtypeReadTests
    {
        private static ItemContent Read(GuidNode node)
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new VendorObjectManager(new[] { node });
            try
            {
                var root = new GuidNode("<project>", null, node);
                return new CodesysDriver(new Projects(root)).ReadContent(new ItemRef(node));
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Theory]
        [InlineData("TYPE X :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE", DutSubtype.Struct)]
        [InlineData("TYPE X :\n(\n\tA,\n\tB\n);\nEND_TYPE", DutSubtype.Enum)]
        [InlineData("TYPE X :\nUNION\n\tb : BYTE;\nEND_UNION\nEND_TYPE", DutSubtype.Union)]
        [InlineData("TYPE X : STRING(80);\nEND_TYPE", DutSubtype.Alias)]
        public void A_dut_carries_its_subtype(string declaration, DutSubtype subtype)
        {
            var content = Read(new GuidNode("X", new Dut(declaration)));

            Assert.Equal(ItemKind.Kinds.Dut, content.Kind);
            Assert.Equal(subtype, content.DutSubtype);
        }

        /// <summary>A text-list enumeration (its own object class, C2g) is a DUT, and answers <c>Enum</c>.</summary>
        [Fact]
        public void A_text_list_enumeration_answers_enum()
        {
            var content = Read(new GuidNode("SER_Mode", new TextListEnum("TYPE SER_Mode :\n(\n\tAuto := 0,\n\tManual\n);\nEND_TYPE")));

            Assert.Equal(ItemKind.Kinds.Dut, content.Kind);
            Assert.Equal(DutSubtype.Enum, content.DutSubtype);
        }

        /// <summary>NO ANSWER IS NULL — never a guessed subtype, never a throw: the read succeeds and the engine names
        /// the item <c>name.dut</c>.</summary>
        [Theory]
        [InlineData("TYPE X :\n(* never closed\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE")]
        [InlineData("TYPE X :\nEND_TYPE")]
        [InlineData("")]
        public void A_dut_the_vendor_gives_no_subtype_reads_with_a_null_answer(string declaration)
        {
            var content = Read(new GuidNode("X", new Dut(declaration)));

            Assert.Equal(ItemKind.Kinds.Dut, content.Kind);
            Assert.Null(content.DutSubtype);
        }

        /// <summary>…and every other kind carries no subtype, whatever its text says.</summary>
        [Fact]
        public void A_pou_carries_no_subtype()
        {
            var content = Read(new GuidNode("P", new Pou("TYPE P :\nSTRUCT\nEND_STRUCT\nEND_TYPE", null!)));

            Assert.NotEqual(ItemKind.Kinds.Dut, content.Kind);
            Assert.Null(content.DutSubtype);
        }
    }
}
