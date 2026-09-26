using System.Collections.Generic;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// Plain C# stand-ins for the 3S NWL objects.
///
/// <para><b>THE CLASS NAMES ARE THE CONTRACT.</b> <c>CodesysNetworkReader</c> dispatches on
/// <c>NwlInterop.TypeName(n)</c>, which is <c>GetType().Name</c>, and reaches every member through
/// <c>Type.GetProperty</c> / <c>InvokeMember</c>. So a class called <see cref="BoxTreeBox"/> with a
/// <c>BoxType</c> property IS a box as far as the reader can tell — no vendor assembly, no running IDE, no COM.
/// Renaming one of these classes is not a refactor; it silently stops the reader recognising it.</para>
///
/// <para>Members are deliberately typed <c>object?</c> where the VENDOR is loose about the type. That is not
/// convenience: the whole reason these doubles exist is that CODESYS answers <c>System.Boolean false</c> for an
/// unwired <c>En</c> pin rather than null, and a double that could only hold a node could not express the bug.</para>
/// </summary>
internal static class Nwl
{
    /// <summary>An implementation aspect: the thing <c>CodesysNetworkReader.Read</c> is handed.</summary>
    internal sealed class NWLImplementationObject
    {
        // Read via `Items(..., listMember: "")`, which falls through to enumerating the collection itself.
        public List<object> NetworkList { get; } = new List<object>();
    }

    internal sealed class Network
    {
        private readonly List<object> _trees = new List<object>();

        public string Title { get; set; } = "";
        public string Label { get; set; } = "";
        public string Comment { get; set; } = "";
        public bool OutCommented { get; set; }

        /// <summary>Report MORE items than there are trees — the measured vendor quirk the reader guards
        /// against: "a network reported 2 with one tree, the second slot being an item the IDE had dropped".
        ///
        /// <para>This double defined <c>NetworkItemCount =&gt; _trees.Count</c>, which is definitionally
        /// consistent and therefore could never diverge — so the whole `TryCall`/null-skip path built to stop a
        /// network materializing "with a header and no logic" was unreachable from any of the 20 reader tests.
        /// A fake that cannot express the bug cannot catch it.</para></summary>
        public int? PhantomItemCount { get; set; }

        public int NetworkItemCount => PhantomItemCount ?? _trees.Count;

        /// <summary>The vendor hands trees out one at a time by index — not as a list. An index past the real
        /// trees answers null (the dropped-item slot), which is what the reader must skip.</summary>
        public object? GetTree(int i) => i >= 0 && i < _trees.Count ? _trees[i] : null;

        /// <summary>The vendor's per-network split point. Null — none — on all 356 networks of the one real
        /// project surveyed, so that is the default; set it to make the reader REFUSE the body, which is the
        /// behaviour that had no test.</summary>
        public object? SplitPoint { get; set; }

        public object? GetSplitPoint(int i) => i == 0 ? SplitPoint : null;

        public Network With(params object[] trees) { _trees.AddRange(trees); return this; }

        // ── the WRITE side, recorded ────────────────────────────────────────────────────────────────
        // The writer's change gate is only worth having if it is actually WIRED IN, and a test of the gate's
        // DECISION cannot see that. These record what the writer did to the live network, so a test can assert
        // that an unchanged push touched nothing at all.
        public List<string> Calls { get; } = new List<string>();

        public void RemoveNetworkItem(int i) { Calls.Add("RemoveNetworkItem"); _trees.RemoveAt(i); }
        public void AppendTree(object tree) { Calls.Add("AppendTree"); _trees.Add(tree); }
    }

    /// <summary>The vendor's flag bit-field, as NAMED BOOLEANS — which is how it really presents itself
    /// (measured on IFlags: Negation, Set, Jump, Return, Rtrig, Ftrig, and no Reset). Every one of them is
    /// settable on the real interface, which is what lets the writer put coil storage back by MUTATING the
    /// operand's existing flags rather than assigning a new object: `IOperand.Flags` has no setter.</summary>
    internal sealed class Flags
    {
        public bool Negation { get; set; }
        public bool Set { get; set; }
        public bool Jump { get; set; }
        public bool Return { get; set; }
        public bool Rtrig { get; set; }
        public bool Ftrig { get; set; }
    }

    internal sealed class Operand
    {
        /// <summary>The writer builds one as <c>New(net, "Operand", text)</c>, so the double needs the same
        /// constructor or a rebuild cannot run at all — which is why there was no writer test until now.</summary>
        public Operand() { }
        public Operand(string operandExpr) { OperandExpr = operandExpr; }

        public string OperandExpr { get; set; } = "";
        public string Type { get; set; } = "";
        public string SymbolComment { get; set; } = "";
        public string Address { get; set; } = "";
        public bool IsLValue { get; set; }
        public bool IsInstance { get; set; }

        /// <summary>PRESENT, not null. <c>ApplyFlags</c> reads this member and throws when it is missing —
        /// `IOperand.Flags` has no setter on the vendor, so modifiers are written by MUTATING the object the
        /// operand already carries. A double whose Flags started null could not receive a modifier at all,
        /// which would make every writer test pass for the wrong reason.</summary>
        public object? Flags { get; set; } = new Flags();
    }

    /// <summary>A bare operand in tree position.</summary>
    /// <summary>A bare operand in tree position. <b>It has NO Flags member, and that is the point.</b>
    /// DIALECT N4 records the measured shape: `a BoxTreeOperand carries Operand, Id and NO Flags` — a
    /// contact's modifiers live on the OPERAND it holds. This double used to declare a `Flags` property
    /// the vendor type does not have, which let `CodesysNetworkReader` read a leaf's flags off the ITEM and
    /// still pass: the whole offline suite was blind to a negated contact pulling as a plain one.
    /// A double that can express a shape the vendor cannot is not a stand-in, it is an alibi.</summary>
    internal sealed class BoxTreeOperand
    {
        public BoxTreeOperand() { }
        /// <summary>`New(net, "BoxTreeOperand", operand)` — the writer's leaf construction.</summary>
        public BoxTreeOperand(Operand operand) { Operand = operand; }

        public Operand Operand { get; set; } = new Operand();
    }

    internal sealed class OutputItemList
    {
        public List<object> List { get; } = new List<object>();

        /// <summary>The vendor's own append. These collections are NOT <c>IList</c> — no <c>Add</c>, no
        /// <c>Count</c>, no indexer — so the writer calls this, and a double without it cannot complete a
        /// rebuild.</summary>
        public void AppendOutputItem(object item) => List.Add(item);
    }

    internal sealed class BoxTreeAssign
    {
        public object? RValue { get; set; }
        public OutputItemList Outputs { get; } = new OutputItemList();

        /// <summary>PRESENT, like the operand's. The vendor's own serialization carries it — a jump built by
        /// TwinCAT's importer holds `&lt;o n="Flags" t="Flags"&gt;` on the `BoxTreeAssign` as well as on the
        /// output operand (DIALECT C13) — and `ApplyFlags` throws when the member is missing, so a null here
        /// would make a jump untestable for a reason the vendor does not have.</summary>
        public object? Flags { get; set; } = new Flags();
    }

    /// <summary>A call or operator.
    /// <para><see cref="En"/> is <c>object?</c> ON PURPOSE — see the class summary. The vendor puts a BOOLEAN
    /// there when nothing is wired to the EN pin.</para></summary>
    internal sealed class BoxTreeBox
    {
        private readonly List<object> _inputs = new List<object>();

        public string BoxType { get; set; } = "";

        /// <summary>PRESENT, not null — the vendor's <c>Instance</c> member is on every box, and
        /// <c>WriteInstance</c> <c>Require</c>s it. Empty by default, which is a box READ from a project
        /// (measured: an engineer-drawn box with no instance answers <c>OperandExpr = None</c>).
        ///
        /// <para>A box the vendor has just CONSTRUCTED is different: it arrives holding <c>???</c>, its own
        /// unresolved-instance marker. That default is not the read default, so it is set explicitly by the
        /// test that cares (<c>A_box_with_no_instance_clears_the_vendors_marker</c>) rather than imposed on
        /// every read test here.</para></summary>
        public object? Instance { get; set; } = new Operand();
        public object? CallType { get; set; }

        /// <summary>Settable for a test that DESCRIBES a live box, and appended to by the writer.</summary>
        public object[] InputItemList
        {
            get { return _inputs.ToArray(); }
            set { _inputs.Clear(); _inputs.AddRange(value); }
        }

        /// <summary>The vendor's own append, and the reason it is here is the reason
        /// <see cref="OutputItemList.AppendOutputItem"/> is: the writer BUILDS through these, so a double
        /// without them cannot complete a rebuild and the whole box-construction path stays untested offline.
        /// It was missing, and the enable write is the first thing that needed it — input SLOT 0 is where an
        /// enable lives, so nothing about it can be gated without being able to append.</summary>
        public void AppendInputItem(object item) { _inputs.Add(item); }

        /// <summary>PRESENT by default, like the vendor's. Every box in a real project has an
        /// <c>IParamList</c> — an AND box's is simply EMPTY (<c>Names=[]</c>, measured) — and the writer
        /// `Require`s it, so a null default made the box build path unreachable for a reason the vendor
        /// does not have.</summary>
        public object? InputParams { get; set; } = new ParamList();

        /// <summary>Per-pin modifiers, index-aligned with <see cref="InputItemList"/> (the EN slot included) — a
        /// real member on CODESYS, where a negated FBD input can live HERE and nowhere else (measured 2026-09-26,
        /// `scripts/probe-nwl-census-v2.py`: 6 such pins across Lenze and pro2193, the operand unflagged).
        /// Null by default, the shape of a box with no pin modifiers.</summary>
        public object[]? InputFlags { get; set; }

        /// <summary>The output side's name list, index-aligned with <see cref="Outputs"/> — present by
        /// default like the vendor's, where an operator box simply has an empty one.</summary>
        public object? OutputParams { get; set; } = new ParamList();

        public OutputItemList Outputs { get; } = new OutputItemList();
        public object? En { get; set; }

        /// <summary>The other half of the EN/ENO pair, and settable for the same reason: the vendor sets both
        /// on a box that shows them (measured: a real Execute box answers <c>En = True, Eno = True</c>).</summary>
        public object? Eno { get; set; }

        /// <summary>Derived, not settable — the vendor has no setter for it (measured:
        /// `BoxTreeBox.ProvidesSTSnippet settable: False`); hanging a snippet on the box turns it on.</summary>
        public bool ProvidesSTSnippet => STSnippet != null;

        /// <summary>An Execute box's ST, hung on the box. Settable, as on the vendor.</summary>
        public object? STSnippet { get; set; }

        public object? Flags { get; set; }
    }

    /// <summary>The vendor's parameter list: two STRING ARRAYS, not a list of named objects.</summary>
    internal sealed class ParamList
    {
        private readonly List<string> _names = new List<string>();
        private readonly List<string> _types = new List<string>();

        public string[] Names
        {
            get { return _names.ToArray(); }
            set { _names.Clear(); _names.AddRange(value); }
        }

        public string[] Types
        {
            get { return _types.ToArray(); }
            set { _types.Clear(); _types.AddRange(value); }
        }

        /// <summary>The vendor's append — two parallel arrays grow together, which is what makes the name at
        /// index i the name OF pin i.</summary>
        public void AppendParam(string name, string type) { _names.Add(name); _types.Add(type); }
    }

    // ── builders, so a test reads as the body it describes ────────────────────────────────────────

    public static BoxTreeOperand Leaf(string name) =>
        new BoxTreeOperand { Operand = new Operand { OperandExpr = name } };

    public static NWLImplementationObject Body(params object[] trees)
    {
        var impl = new NWLImplementationObject();
        impl.NetworkList.Add(new Network().With(trees));
        return impl;
    }

    /// <summary>An Execute box's snippet. <b>The NAME is the contract</b> - the writer builds one with
    /// <c>New(box, "STSnippet")</c>, resolved by type name out of the sample's assembly, so a double called
    /// anything else is simply not found.</summary>
    internal sealed class STSnippet
    {
        /// <summary>Settable through the vendor's <c>ISTSnippet</c>; null on a fresh one, which is why the
        /// writer has to supply an implementation object rather than expecting one.</summary>
        public object? Snippet { get; set; }
    }

    /// <summary>A text document. The writer puts the ST in with <c>Insert(0, st)</c> - NOT by assigning
    /// <c>Text</c>, which on the vendor clears the document first and underflows.</summary>
    internal sealed class TextDocument
    {
        /// <summary><b>`Insert` THROWS, and it throws AFTER landing the text.</b> That is the measured vendor
        /// behaviour the writer is built around: `Insert(0, ...)` stores the text and then raises
        /// `InvalidOperationException: Unique ID generator not available` - editor bookkeeping this document has
        /// no host for - so the writer catches it and VERIFIES the postcondition by reading the text back.
        ///
        /// <para>This double used to store the text and return quietly, which made both halves of that dance
        /// dead code: delete the writer's `catch` and every test still passed, and the postcondition check could
        /// never fire. A double behaving the way the author WISHED the vendor behaved is how a fake asserts a bug
        /// away. On by default - the faithful behaviour is what a test gets without asking.</para></summary>
        public static bool ThrowsAfterInsert = true;

        /// <summary>Drop the text instead of storing it - the failure the writer's postcondition check exists to
        /// catch. Off by default; one test turns it on to prove that check is real.</summary>
        public static bool DropsText;

        public string Text { get; private set; } = "";

        public void Insert(int offset, string text)
        {
            if (!DropsText) Text = Text.Insert(offset, text);
            if (ThrowsAfterInsert)
                throw new System.InvalidOperationException("Unique ID generator not available");
        }
    }
}
