using System;
using System.Collections.Generic;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// SCHEMA → MODEL (openspec <c>nwl-schema-completeness-gate</c> 1.1): where each archived NWL member of the census lands in
/// Volt's <c>Format/Network/NetworkModel</c>, as <c>Record.Member</c> (checked by reflection to exist), or <c>null</c> where
/// the model carries no member for it — each such member is a FINDING, listed in the generated
/// <c>test/fixtures/nwl-schema/model-map.&lt;version&gt;.txt</c> with its disposition from <see cref="Volt.Tests.Shared.NwlDisposition"/>.
/// The census and this map must name the same members, both ways.
/// </summary>
public static class NwlSchemaModelMap
{
    /// <summary>Separates a model member from what of the schema member it does NOT carry — a partial mapping, a finding too.</summary>
    public const string Partial = " | partial: ";

    public static readonly IReadOnlyDictionary<string, string?> Map = new Dictionary<string, string?>(StringComparer.Ordinal)
    {
        ["NWLImplementationObject.NetworkListComment"] = null,
        ["NWLImplementationObject.DefaultViewMode"] = "NetworkBody.Language",
        ["NWLImplementationObject.NetworkList"] = "NetworkBody.Networks",
        ["NWLImplementationObject.BranchCounter"] = null,
        ["NWLImplementationObject.ValidIds"] = null,

        ["Network.Id"] = null,
        ["Network.ILActive"] = null,
        ["Network.FBDValid"] = null,
        ["Network.ILValid"] = null,
        ["Network.ILLines"] = null,
        ["Network.Comment"] = "Network.Comment",
        ["Network.Title"] = "Network.Title",
        ["Network.Label"] = "Network.Label",
        ["Network.OutCommented"] = "Network.Disabled",
        ["Network.NetworkItems"] = "Network.Trees",
        ["Network.Connectors"] = null,

        ["BoxTreeAssign.Id"] = null,
        ["BoxTreeAssign.OutputItems"] = "Assign.Targets",
        ["BoxTreeAssign.Flags"] = "Assign.Flags",
        ["BoxTreeAssign.RValue"] = "Assign.Value",

        ["BoxTreeBox.Id"] = null,
        ["BoxTreeBox.BoxType"] = "Box.Type",
        ["BoxTreeBox.Instance"] = "Box.Instance",
        ["BoxTreeBox.OutputItems"] = "Box.Outputs",
        ["BoxTreeBox.Flags"] = "Box.Flags",
        ["BoxTreeBox.InputFlags"] = "Input.Flags",            // slot 0 of a box showing EN: Box.EnableFlags
        ["BoxTreeBox.InputItems"] = "Box.Inputs",             // slot 0 of a box showing EN: Box.Enable
        ["BoxTreeBox.InputParam"] = "Input.Formal",
        ["BoxTreeBox.OutputParam"] = "Output.Formal",         // and Box.Members (OutputNames), Box.OutputTypes
        ["BoxTreeBox.CallType"] = "Box.Kind",
        ["BoxTreeBox.EN"] = "Box.Enable",
        ["BoxTreeBox.ENO"] = "Box.HasEnoOutput",
        ["BoxTreeBox.STSnippet"] = "Box.StCode",
        ["BoxTreeBox.ContainsExtensibleInputs"] = null,
        ["BoxTreeBox.ProvidesSTSnippet"] = "Box.StCode",      // set exactly when StCode is

        ["BoxTreeDemux.Id"] = null,
        ["BoxTreeDemux.VarId"] = "Demux.VarId",
        ["BoxTreeDemux.Input"] = "Demux.Input",

        ["BoxTreeMux.Id"] = null,
        ["BoxTreeMux.VarId"] = null,
        ["BoxTreeMux.InputIndex"] = null,
        ["BoxTreeMux.Merger"] = null,

        ["BoxTreeOperand.Id"] = null,
        ["BoxTreeOperand.Operand"] = "Leaf.Operand",

        ["BoxTreeParallel.Id"] = null,
        ["BoxTreeParallel.Trees"] = "Parallel.Branches",
        ["BoxTreeParallel.Input"] = "Parallel.Input",
        ["BoxTreeParallel.Mode"] = "Parallel.Mode",

        ["BoxTreeTerminator.Id"] = null,
        ["BoxTreeTerminator.Input"] = null,
        ["BoxTreeTerminator.Flags"] = "Terminator.Flags",

        ["Flags.Flags"] = "Flags.Negated",                    // the bits: Negated Set Reset Jump Return Rising Falling
        ["Flags.Fixed"] = null,
        ["Flags.Extensible"] = null,

        ["ILStatement.Id"] = null,
        ["ILStatement.Operator"] = null,
        ["ILStatement.Prefix"] = null,
        ["ILStatement.Operand"] = null,
        ["ILStatement.Postfix"] = null,

        ["Operand.Id"] = null,
        ["Operand.Operand"] = "Operand.Text",
        ["Operand.Type"] = "Operand.Type",
        ["Operand.Comment"] = null,                           // the reader's Operand.Comment is the SymbolComment
        ["Operand.SymbolComment"] = "Operand.Comment",
        ["Operand.Address"] = null,
        ["Operand.Flags"] = "Operand.Flags",
        ["Operand.LValue"] = "Operand.IsLValue",
        ["Operand.Boolean"] = null,
        ["Operand.IsInstance"] = "Operand.IsInstance",

        ["OutputItemList.OutputItems"] = "Box.Outputs",       // through its owner: Assign.Targets or Box.Outputs

        ["ParamList.Names"] = "Input.Formal",                 // and Output.Formal
        ["ParamList.Types"] = "Box.OutputTypes" + Partial + "InputParam's Types are not carried",

        ["STSnippet.Id"] = null,
        ["STSnippet.STSnippet"] = "Box.StCode",
    };
}
