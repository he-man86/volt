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

        public int NetworkItemCount => _trees.Count;

        /// <summary>The vendor hands trees out one at a time by index — not as a list.</summary>
        public object GetTree(int i) => _trees[i];

        /// <summary>Answers null, i.e. no split point. The reader REFUSES a body that has one.</summary>
        public object? GetSplitPoint(int i) => null;

        public Network With(params object[] trees) { _trees.AddRange(trees); return this; }
    }

    internal sealed class Operand
    {
        public string OperandExpr { get; set; } = "";
        public string Type { get; set; } = "";
        public string SymbolComment { get; set; } = "";
        public string Address { get; set; } = "";
        public bool IsLValue { get; set; }
        public bool IsInstance { get; set; }
        public object? Flags { get; set; }
    }

    /// <summary>A bare operand in tree position.</summary>
    internal sealed class BoxTreeOperand
    {
        public Operand Operand { get; set; } = new Operand();
        public object? Flags { get; set; }
    }

    internal sealed class OutputItemList
    {
        public List<object> List { get; } = new List<object>();
    }

    internal sealed class BoxTreeAssign
    {
        public object? RValue { get; set; }
        public OutputItemList Outputs { get; } = new OutputItemList();
        public object? Flags { get; set; }
    }

    /// <summary>A call or operator.
    /// <para><see cref="En"/> is <c>object?</c> ON PURPOSE — see the class summary. The vendor puts a BOOLEAN
    /// there when nothing is wired to the EN pin.</para></summary>
    internal sealed class BoxTreeBox
    {
        public string BoxType { get; set; } = "";
        public object? Instance { get; set; }
        public object? CallType { get; set; }
        public object[] InputItemList { get; set; } = new object[0];
        public object? InputParams { get; set; }
        public OutputItemList Outputs { get; } = new OutputItemList();
        public object? En { get; set; }
        public bool ProvidesSTSnippet { get; set; }
        public object? Flags { get; set; }
    }

    /// <summary>The vendor's parameter list: two STRING ARRAYS, not a list of named objects.</summary>
    internal sealed class ParamList
    {
        public string[] Names { get; set; } = new string[0];
        public string[] Types { get; set; } = new string[0];
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
}
