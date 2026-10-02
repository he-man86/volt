using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// CODESYS-specific classification: maps an object-model <c>IObject</c> to a
    /// shared <see cref="ItemKind"/> code by its implemented interfaces
    /// (<c>IPOUObject</c>, <c>IGVLObject</c>, <c>IDUTObject</c>, …) — the same basis
    /// CODESYS uses internally, NOT type GUIDs. The CLASS decides, and nothing else:
    /// no kind is refined from the object's text (openspec <c>push-without-header-check</c>
    /// 5.Q — a wire extension carries only what the IDE stores per object). Code values
    /// and kind strings themselves live in <see cref="ItemKind"/> (shared with Beckhoff).
    /// </summary>
    internal static class CodesysTypeMap
    {
        /// <summary>Classify from the IObject's interface-name set (+ folder flag, + the name an accessor is
        /// told apart by). Never from the object's text.</summary>
        public static int CodeForObject(HashSet<string> ifaces, bool isFolder, string? name)
        {
            if (isFolder) return ItemKind.PlcFolder;

            // Transient / hidden: task POU-call refs, runtime copies, hidden visu
            // styles — same name as a real object → never emit.
            if (Has(ifaces, "ITransientObject") || Has(ifaces, "IHiddenObject")) return ItemKind.Skip;

            // Containers: descended into, never emitted. Task Configuration is a
            // grouping node whose ITaskObject children surface as individual `task`s.
            if (Has(ifaces, "IApplicationObject")) return ItemKind.Application;
            if (Has(ifaces, "IPlcLogicObject")) return ItemKind.PlcLogic;
            // A device is BOTH: the walk emits a read-only `.device` descriptor for it AND recurses its
            // subtree (Driver/CodesysDriver.Tree.cs) — it is the one code here that does not mean "never emit".
            if (Has(ifaces, "IDeviceObject")) return ItemKind.Device;
            if (Has(ifaces, "ITaskConfigObject")) return ItemKind.TaskConfig;

            // Inlined in a POU/interface source: ItemKind.IsInlinedInPou reads these codes to make the tree
            // walk skip them, and the child text is assembled by Text/StWriter (fed on CODESYS by the
            // PlcOpen export, ExportXmlWithChildren). Each gets its own distinct code
            // (interface_method/transition/interface_property), matching TwinCAT.
            if (Has(ifaces, "IInterfaceMethodObject")) return ItemKind.PlcItfMeth;
            if (Has(ifaces, "IPOUMethodObject")) return ItemKind.PlcMethod;
            if (Has(ifaces, "IPropertyAccessorObject") || Has(ifaces, "IInterfacePropertyAccessorObject")) return RefineAccessor(name);
            if (Has(ifaces, "IInterfacePropertyObject")) return ItemKind.PlcItfProp;
            if (Has(ifaces, "IPropertyObject")) return ItemKind.PlcProp;
            if (Has(ifaces, "ITransitionObject")) return ItemKind.PlcTrans;
            if (Has(ifaces, "IActionObject")) return ItemKind.PlcAction;

            // Top-level source. A POU is ONE kind, `X.pou`, by its class (`POUObject`, `POUObjectCheckFunction` — both
            // `IPOUObject`): CODESYS takes whether it is a program, a function block or a function from its TEXT (DIALECT
            // C2f/C2g), and nothing in Volt reads that. This used to read the Interface aspect of every POU on every walk
            // (272 reads on Pro2193) to refine the kind from the declaration's first keyword, falling back to
            // FUNCTION_BLOCK when it found none — and turned a POUObject holding INTERFACE text into an interface, a kind
            // its class does not have. An `InterfaceObject` implements `IInterfaceObject` alone, below.
            if (Has(ifaces, "IPOUObject")) return ItemKind.PlcPou;
            if (Has(ifaces, "IGVLObject") || Has(ifaces, "INVLObject")) return ItemKind.PlcGvl;
            // IDUTObject is the usual struct/enum/union/alias. ITextListEnumerationObject is a text-list-backed
            // enumeration — a normal `TYPE X : (…)` enum whose members map to a text list, surfaced by CODESYS
            // as its OWN object kind (not IDUTObject); without it, a text-list enum drops to Unknown and every
            // reference is unresolved (real cases: SER_OperationModeType, IQSlices, enumRecipeCommandResult).
            // A DUT is ONE internal kind, published `X.dut` whatever its shape (openspec `push-without-header-check`
            // 5.P) — the text-list enum included: read and written through its declaration like any other DUT. Its
            // struct/enum/union/alias subtype is read by nothing in Volt, and CODESYS creates every DUT with one
            // `create_dut` call, so the walk needs no declaration read.
            if (Has(ifaces, "IDUTObject") || Has(ifaces, "ITextListEnumerationObject")) return ItemKind.PlcDut;
            if (Has(ifaces, "IInterfaceObject")) return ItemKind.PlcItf;

            // Recognized non-source kinds — distinct wire kinds matching TwinCAT
            // (interface names verified against the Hauzer project's object model).
            if (Has(ifaces, "ILibManObject")) return ItemKind.PlcLibMan;
            if (Has(ifaces, "IVisualManagerObject")) return ItemKind.PlcVisMan;
            if (Has(ifaces, "IVisualObject")) return ItemKind.PlcVisObj;
            if (Has(ifaces, "IRecipeManObject")) return ItemKind.PlcRecipeMan;
            if (Has(ifaces, "IImagePoolObject")) return ItemKind.PlcImagePool;
            if (Has(ifaces, "IGlobalTextListObject") || Has(ifaces, "ITextListObject")) return ItemKind.PlcTextList;

            // The project's "Project Information" metadata (title/author/version/company) — a standard
            // IProjectInfoObject with a readable ScriptProjectInfo facet. Emitted as a read-only `.projectinfo`
            // descriptor. (Project SETTINGS — IWorkspaceObject below — is a separate node with its own
            // `.projectsettings` descriptor, read from the object model rather than a scripting facet.)
            if (Has(ifaces, "IProjectInfoObject")) return ItemKind.PlcProjectInfo;

            // Read-only descriptors for non-source project objects with clean scripting facets:
            //   Trace  = a recording config (task/trigger/resolution) — ScriptTraceObject
            //   Recipe = a recipe definition's variable list — ScriptRecipeDefinitionObject (child of the mgr)
            //   Symbols = the symbol-configuration flags (OPC UA / direct I/O) — ScriptSymbolConfigObject
            if (Has(ifaces, "ITraceObject")) return ItemKind.PlcTrace;
            if (Has(ifaces, "IRecipeDefinitionObject")) return ItemKind.PlcRecipe;
            if (Has(ifaces, "ISymbolConfigObject")) return ItemKind.PlcSymbolConfig;

            // Individual cyclic task → `task` (621), matching TwinCAT's flat task items.
            if (Has(ifaces, "ITaskObject")) return ItemKind.PlcTask;

            // CODESYS's OWN "no loaded handler" marker: an object whose providing plugin isn't present in
            // this install reports ONLY IUnknownObject (verified live on Hauzer — 20 such nodes: the German
            // "Bibliotheksverwalter", SoftMotion MotionObjects / Carrier_* / CamRef_* / CamTracks, …). We
            // cannot type what CODESYS itself can't, so emit nothing. This is NOT a classification gap — it
            // is CODESYS declaring the type opaque. Listed explicitly so it reads as a decision, not a miss.
            if (Has(ifaces, "IUnknownObject")) return ItemKind.Unknown;

            // "Project Settings" (IWorkspaceObject) — the compiler-warning states and compile options.
            // This WAS a known-skip, and the reason was specific: the SCRIPTING api exposes nothing readable
            // for it (only a ScriptNoProjectInfoMarker). The object model does — see
            // CodesysObjectModel.ProjectSettingsDescriptor — so the node is now emitted as a read-only
            // `.projectsettings` descriptor instead of dropped.
            if (Has(ifaces, "IWorkspaceObject")) return ItemKind.PlcProjectSettings;

            // A node with NO specific object type — only the base IGenericObject/IObject — is a transparent
            // grouping container (e.g. a SoftMotion "Kinematics" holding its axis devices). No warning: it
            // carries no type to handle. Falls through to GenericContainer below (recurse, never emit).
            // TRULY unrecognized (a specific *Object interface we don't handle): surface ONCE per distinct
            // signature so a kind we SHOULD map becomes visible — logged, NOT thrown.
            if (!IsBareGeneric(ifaces)) WarnUnrecognized(name, ifaces);

            // Either way, treat it as a GenericContainer: RECURSE so nested source under an unclassified node
            // is never dropped (matching the Beckhoff walk, which recurses any hybrid), but never emit the node
            // itself (Map(GenericContainer) is null). This is the safety net the no-fallback policy needs — a
            // new vendor grouping type warns us to add proper handling WITHOUT silently losing its children.
            // (IUnknownObject — CODESYS's own no-handler marker — returned Unknown above and is NOT recursed:
            // its subtree is genuinely unreadable, so we leave it opaque.)
            return ItemKind.GenericContainer;
        }

        /// <summary>Log an unrecognized CODESYS object once per distinct *Object-interface signature, so a kind
        /// we should handle is visible without spamming or crashing the walk. The signature IS the key: two nodes
        /// of the same unhandled shape are one finding.</summary>
        private static void WarnUnrecognized(string? name, HashSet<string> ifaces)
        {
            var objIfaces = new List<string>();
            foreach (var i in ifaces) if (i.EndsWith("Object", StringComparison.Ordinal)) objIfaces.Add(i);
            objIfaces.Sort(StringComparer.Ordinal);
            var sig = string.Join("+", objIfaces);
            Volt.Engine.Ide.BridgeLog.WarnOnce(sig,
                $"unrecognized CODESYS object type (skipped): name='{name}' interfaces=[{sig}]");
        }

        /// <summary>Containers we recurse into but never emit. Device is deliberately NOT here: the walk
        /// handles it earlier and EMITS a `.device` descriptor as well as recursing.</summary>
        public static bool IsRecurseOnlyContainer(int code) =>
            code is ItemKind.Application or ItemKind.PlcLogic or ItemKind.TaskConfig
                or ItemKind.GenericContainer;

        /// <summary>True when the node carries NO classifying object interface — only the universal base
        /// (IGenericObject/IObject). Such a node is a transparent grouping container, not a typed object.</summary>
        private static bool IsBareGeneric(HashSet<string> ifaces)
        {
            foreach (var i in ifaces)
                if (i.EndsWith("Object", StringComparison.Ordinal) && i != "IObject" && i != "IGenericObject")
                    return false;   // has a specific *Object interface → not bare
            return Has(ifaces, "IGenericObject") || Has(ifaces, "IObject");
        }

        /// <summary>Transient/hidden/unrecognized nodes: skip entirely (no emit, no recurse).</summary>
        public static bool IsSkipped(int code) => code is ItemKind.Skip or ItemKind.Unknown;

        private static bool Has(HashSet<string> ifaces, string name) => ifaces.Contains(name);

        private static int RefineAccessor(string? name) =>
            string.Equals(name, "Set", StringComparison.OrdinalIgnoreCase) ? ItemKind.PlcPropSet : ItemKind.PlcPropGet;
    }
}
