using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// AN ABSTRACT MEMBER PULLED FROM CODESYS CAN BE PUSHED BACK (openspec <c>abstract-member-push</c>; DIALECT C2n,
    /// found by the <c>vendor-facts</c> probe 2026-10-11).
    ///
    /// <para>CODESYS holds an abstract method as an <c>AbstractPOUMethodObject</c> with NO <c>Implementation</c> aspect.
    /// The pull reads its body as null, <c>StWriter</c> writes the boundary line <c>IMPLEMENTATION ST</c> for it anyway
    /// (an empty body gets the line), <c>StReader</c> reads that back as <c>""</c>, and the push sends <c>""</c> at a
    /// slot the object does not have — which <c>RequireSlot</c> (openspec <c>bridge-refusal-review</c> D26) refuses:
    /// <c>UNSUPPORTED: CODESYS: 'TakePicture' has no Implementation</c>. So no edit of an owner holding an abstract
    /// member can be pushed: 12 <c>ABSTRACT</c> member texts in the six corpora, all pro2193 (11 METHOD, 1 PROPERTY,
    /// 7 owner files). D26 names the fix: the PRODUCER, not a driver table. The driver cannot tell today: an empty ST
    /// body and a missing slot both read null.</para>
    ///
    /// <para><b>The fix</b> (3.2): the pull states <c>IMPLEMENTATION NONE</c> for a member whose object declares
    /// <c>Implementation</c> and holds null there — measured on every such pro2193 object (<c>vendor-facts</c>
    /// <c>merged-classes</c>: 10 <c>AbstractPOUMethodObject</c>s and the <c>Busy</c> GET, <c>implementation-declared.*</c>
    /// and <c>implementation.*</c>), which is exactly what the <c>Method(decl, null!)</c> double models — and the push
    /// writes no body for it (<c>ImplementationMarker.Written</c>). The assertion is the one committed red.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysAbstractMemberPushTests
    {
        [Fact]
        public void A_pulled_owner_with_an_abstract_method_takes_a_declaration_edit()
        {
            var body = new _3S.CoDeSys.STObject.STImplementationObject();
            try { body.TextDocument.Insert(0, "x := x + 1;"); } catch (System.InvalidOperationException) { }   // lands, then throws (NwlDoubles)
            var method = new Node("TakePicture", 2, new Method("METHOD ABSTRACT TakePicture : INT", null!));
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\n\tx : INT;\nEND_VAR", body), method);
            var manager = new ObjectManager(new[] { pou, method });
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                var driver = new CodesysDriver(projects: null);
                var pulled = StWriter.Write(driver.ReadContent(new ItemRef(pou)));
                var edited = pulled.Replace("METHOD ABSTRACT TakePicture : INT",
                                            "METHOD ABSTRACT TakePicture : INT\n// edited in the workspace");
                Assert.NotEqual(pulled, edited);

                // What the push hands the driver (abstract-member-parity): the member's UNCHANGED body dropped — null,
                // "leave it alone" (`PushService.OnlyChanged` drops an unchanged body at every member site). A NONE body
                // is now written as "" (`ImplementationMarker.Written`), so the engine, not the driver, keeps it off a
                // slotless object; reaching one anyway is the driver's backstop refusal (`RequireSlot`, D26), below.
                var pushed = StReader.Read(edited, ItemKind.Kinds.Pou);
                var sent = pushed with { Members = pushed.Members.Select(m => m with { Body = null }).ToList() };
                driver.WriteContent(new ItemRef(pou), sent, System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Contains("// edited in the workspace", method.Object.Interface.TextDocument.Text);

                var ex = Assert.Throws<BridgeException>(() => driver.WriteContent(new ItemRef(pou), pushed,
                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>()));
                Assert.Contains("TakePicture", ex.Message);
                Assert.Contains("Implementation", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>The pull states the missing slot — under the abstract method and under the abstract property's GET
        /// (measured: an <c>InterfacePropertyAccessorObject</c> holding no aspect) — and only there: a method whose ST body
        /// is EMPTY has a slot and keeps <c>IMPLEMENTATION ST</c> (<c>BodyText</c> is untouched).</summary>
        [Fact]
        public void The_pull_states_IMPLEMENTATION_NONE_only_where_the_object_holds_no_Implementation()
        {
            var abstractMethod = new Node("TakePicture", 2, new Method("METHOD ABSTRACT TakePicture : INT", null!));
            var getter = new Node("Get", 4, new AccessorObject("VAR\nEND_VAR", null!));
            var property = new Node("Busy", 3, new Property("PROPERTY PUBLIC ABSTRACT Busy : BOOL"), getter);
            var empty = new Node("Run", 5, new Method("METHOD Run : BOOL", new _3S.CoDeSys.STObject.STImplementationObject()));
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK ABSTRACT FB_Base", new _3S.CoDeSys.STObject.STImplementationObject()),
                               abstractMethod, property, empty);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, abstractMethod, property, getter, empty });
            try
            {
                var content = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                var text = StWriter.Write(content);

                Assert.Contains("METHOD ABSTRACT TakePicture : INT\nIMPLEMENTATION NONE\nEND_METHOD", text);
                Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE\nEND_GET", text);
                Assert.Contains("METHOD Run : BOOL\nIMPLEMENTATION ST\n", text);
                Assert.Equal(StatedLanguage.None, content.Members.Single(m => m.Name == "TakePicture").Stated);
                Assert.Null(content.Members.Single(m => m.Name == "Busy").Body);              // a property's own object: no body site
                Assert.Null(content.Members.Single(m => m.Name == "Run").Stated);            // an empty body, as before
                Assert.Null(content.Stated);                                                  // the POU's empty ST body too
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        // ── openspec abstract-member-parity: one text for one declaration, whatever the object's class ──────────────

        private static _3S.CoDeSys.STObject.STImplementationObject StBody(string text)
        {
            var body = new _3S.CoDeSys.STObject.STImplementationObject();
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try { Nwl.TextDocument.ThrowsAfterInsert = false; body.TextDocument.Insert(0, text); }
            finally { Nwl.TextDocument.ThrowsAfterInsert = throws; }
            return body;
        }

        /// <summary>The read rule (step 3): the driver keeps its storage fact and the engine folds the rest. A SLOTTED
        /// abstract method (<c>POUMethodObject</c> with an empty <c>STImplementationObject</c> — script-made, or IDE-made
        /// like pro2193's <c>Cyclic</c>) and a slotted abstract property's GET (<c>PropertyAccessorObject</c>) read as an
        /// empty ST body from the driver, and the engine's fold states them <c>IMPLEMENTATION NONE</c> — the text the
        /// slotless objects pull, and TwinCAT's. It used to pull <c>IMPLEMENTATION ST</c>.</summary>
        [Fact]
        public void A_slotted_abstract_method_and_GET_pull_IMPLEMENTATION_NONE_through_the_engine_fold()
        {
            var slotted = new Node("Cyclic", 2, new Method("METHOD PROTECTED ABSTRACT Cyclic", new _3S.CoDeSys.STObject.STImplementationObject()));
            var getter = new Node("Get", 4, new AccessorObject("VAR\nEND_VAR", new _3S.CoDeSys.STObject.STImplementationObject()));
            var property = new Node("Busy", 3, new Property("PROPERTY PUBLIC ABSTRACT Busy : BOOL"), getter);
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK ABSTRACT FB_Base", new _3S.CoDeSys.STObject.STImplementationObject()),
                               slotted, property);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, slotted, property, getter });
            try
            {
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                Assert.Null(read.Members.Single(m => m.Name == "Cyclic").Stated);              // the driver's storage fact

                var text = StWriter.Write(AbstractMemberFold.Apply(read));

                Assert.Contains("METHOD PROTECTED ABSTRACT Cyclic\nIMPLEMENTATION NONE\nEND_METHOD", text);
                Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION NONE\nEND_GET", text);
                Assert.Contains("FUNCTION_BLOCK ABSTRACT FB_Base\nIMPLEMENTATION ST\n", text);      // the FB's own body is no member site
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>NONE over a slotted abstract method holding code: <c>""</c> is written at its slot (measured to persist
        /// and pull back as NONE, <c>vendor-facts</c> <c>abstract-member-code</c>).</summary>
        [Fact]
        public void NONE_over_a_slotted_method_holding_code_writes_an_empty_body()
        {
            var body = StBody("Pick := 1;");
            var method = new Node("Pick", 2, new Method("METHOD ABSTRACT Pick : INT", body));
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK ABSTRACT FB_Base", new _3S.CoDeSys.STObject.STImplementationObject()), method);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, method });
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK ABSTRACT FB_Base", null, new List<Member>
                    {
                        new(ItemKind.Kinds.Method, "Pick", "METHOD ABSTRACT Pick : INT", ImplementationMarker.NoneLine,
                            Stated: StatedLanguage.None),
                    }), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Equal("", body.TextDocument.Text);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>NONE over a member whose body is LD: NONE is an empty ST body to the guard (N24 answers, and CODESYS
        /// writes it), so the write swaps the aspect to ST and writes <c>""</c> there (<c>BodyFormatGuard.PushedLanguage</c>
        /// answers ST for NONE) — it used to swap nothing and write <c>""</c> into the network implementation.</summary>
        [Fact]
        public void NONE_over_an_LD_member_swaps_the_aspect_to_ST_and_writes_an_empty_body()
        {
            var obj = new CodesysLanguageChangeTests.SwappableMethod("METHOD Step : BOOL", new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" });
            var method = new CodesysLanguageChangeTests.AnyNode("Step", 2, obj);
            var pou = new CodesysLanguageChangeTests.AnyNode("P", 1,
                new CodesysLanguageChangeTests.SwappablePou("FUNCTION_BLOCK ABSTRACT P", new _3S.CoDeSys.STObject.STImplementationObject()), method);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new CodesysLanguageChangeTests.AnyManager(pou, method);
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                Assert.Equal(StatedLanguage.St,
                    Volt.Engine.Format.Body.BodyFormatGuard.PushedLanguage("'Step'", ImplementationMarker.NoneLine, StatedLanguage.None));

                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK ABSTRACT P", null, new List<Member>
                    {
                        new(ItemKind.Kinds.Method, "Step", "METHOD ABSTRACT Step : BOOL", ImplementationMarker.NoneLine,
                            Stated: StatedLanguage.None),
                    }), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                var st = Assert.IsType<_3S.CoDeSys.STObject.STImplementationObject>(obj.Implementation);
                Assert.Equal("", st.TextDocument.Text);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>A null accessor body is "leave it alone", as a member's is and as on TwinCAT: the push drops an
        /// unchanged accessor body (<c>PushService.OnlyChanged</c>) and writes the declaration alone. Writing
        /// <c>Accessor.Code</c> (<c>""</c> for null) cleared the GET's code.</summary>
        [Fact]
        public void A_null_accessor_body_leaves_the_GETs_code_and_writes_its_declaration()
        {
            var body = StBody("Busy := TRUE;");
            var getterObj = new AccessorObject("VAR\nEND_VAR", body);
            var getter = new Node("Get", 4, getterObj);
            var property = new Node("Busy", 3, new Property("PROPERTY PUBLIC Busy : BOOL"), getter);
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK FB_Base", new _3S.CoDeSys.STObject.STImplementationObject()), property);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, property, getter });
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            try
            {
                Nwl.TextDocument.ThrowsAfterInsert = false;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou),
                    new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_Base", null, new List<Member>
                    {
                        new(ItemKind.Kinds.Property, "Busy", "PROPERTY PUBLIC Busy : BOOL", null,
                            Getter: new Accessor("VAR\n\tn : INT;\nEND_VAR", null)),
                    }), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Equal("Busy := TRUE;", body.TextDocument.Text);
                Assert.Contains("n : INT;", getterObj.Interface.TextDocument.Text);
            }
            finally
            {
                Nwl.TextDocument.ThrowsAfterInsert = throws;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>No object read at all is a READ failure, not a vendor fact — refused, never stated as NONE (which the
        /// guard would then refuse on every push of the POU as "NONE over a member with a slot"). The declaration read
        /// refuses it first (<c>ReadAspectText</c>), and the site's kind is classified from the same object, so <c>ReadBody</c>
        /// never sees a null object from the IDE: its check is a driver invariant (<c>InvalidOperationException</c>), not a wire
        /// refusal (gate 3 review).</summary>
        [Fact]
        public void A_body_site_whose_object_cannot_be_read_is_refused_not_stated_NONE()
        {
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK FB_Base", new _3S.CoDeSys.STObject.STImplementationObject()));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;   // ReadObject answers null without an object manager

            var ex = Assert.Throws<System.InvalidOperationException>(() => new CodesysDriver(projects: null).ReadContent(new ItemRef(pou)));

            Assert.Contains("the object itself could not be obtained", ex.Message);
        }

        /// <summary>A type that does not declare <c>Implementation</c> at all was measured on no object (every pro2193
        /// slotless object declares it and holds null) — refused by name, not stated NONE.</summary>
        [Fact]
        public void A_body_site_whose_type_declares_no_Implementation_is_refused_by_name_not_stated_NONE()
        {
            var node = new CodesysLanguageChangeTests.AnyNode("FB_A", 1, new CodesysNoSlotTextTests.PouWithoutBody("FUNCTION_BLOCK FB_A"));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new CodesysNoSlotTextTests.CountingManager(node);
            try
            {
                var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(projects: null).ReadContent(new ItemRef(node)));

                Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("'FB_A'", ex.Message);
                Assert.Contains("declares no Implementation", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
