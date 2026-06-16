using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Codesys
{
    /// <summary>
    /// CODESYS-specific classification: maps an object-model <c>IObject</c> to a
    /// shared <see cref="ItemKind"/> code by its implemented interfaces
    /// (<c>IPOUObject</c>, <c>IGVLObject</c>, <c>IDUTObject</c>, …) — the same basis
    /// CODESYS uses internally, NOT type GUIDs. POU/DUT kinds refine via the
    /// declaration's leading IEC keyword. Code values and kind strings themselves
    /// live in <see cref="ItemKind"/> (shared with Beckhoff).
    /// </summary>
    internal static class CodesysTypeMap
    {
        /// <summary>Classify from the IObject's interface-name set (+ folder flag, +
        /// declaration for POU/DUT keyword refinement).</summary>
        public static int CodeForObject(HashSet<string> ifaces, bool isFolder, string? name, string? declaration)
        {
            if (isFolder) return ItemKind.Folder;

            // Transient / hidden: task POU-call refs, runtime copies, hidden visu
            // styles — same name as a real object → never emit.
            if (Has(ifaces, "ITransientObject") || Has(ifaces, "IHiddenObject")) return ItemKind.Skip;

            // Containers: descended into, never emitted. Task Configuration is a
            // grouping node whose ITaskObject children surface as individual `task`s.
            if (Has(ifaces, "IApplicationObject")) return ItemKind.Application;
            if (Has(ifaces, "IPlcLogicObject")) return ItemKind.PlcLogic;
            if (Has(ifaces, "IDeviceObject")) return ItemKind.Device;
            if (Has(ifaces, "ITaskConfigObject")) return ItemKind.TaskConfig;

            // Inlined in a POU/interface source (collected by SourceAssembler). Each
            // gets its own code — SourceAssembler keys on the distinct values
            // (interface_method/transition/interface_property), matching TwinCAT.
            if (Has(ifaces, "IInterfaceMethodObject")) return ItemKind.InterfaceMethod;
            if (Has(ifaces, "IPOUMethodObject")) return ItemKind.Method;
            if (Has(ifaces, "IPropertyAccessorObject") || Has(ifaces, "IInterfacePropertyAccessorObject")) return RefineAccessor(name);
            if (Has(ifaces, "IInterfacePropertyObject")) return ItemKind.InterfaceProperty;
            if (Has(ifaces, "IPropertyObject")) return ItemKind.Property;
            if (Has(ifaces, "ITransitionObject")) return ItemKind.Transition;
            if (Has(ifaces, "IActionObject")) return ItemKind.Action;

            // Top-level source.
            if (Has(ifaces, "IPOUObject")) return RefinePou(declaration);
            if (Has(ifaces, "IGVLObject") || Has(ifaces, "INVLObject")) return ItemKind.Gvl;
            if (Has(ifaces, "IDUTObject")) return RefineDut(declaration);
            if (Has(ifaces, "IInterfaceObject")) return ItemKind.Interface;

            // Recognized non-source kinds — distinct wire kinds matching TwinCAT
            // (interface names verified against the Hauzer project's object model).
            if (Has(ifaces, "ILibManObject")) return ItemKind.LibraryManager;
            if (Has(ifaces, "IVisualManagerObject")) return ItemKind.VisualizationManager;
            if (Has(ifaces, "IVisualObject")) return ItemKind.Visualization;
            if (Has(ifaces, "IRecipeManObject")) return ItemKind.RecipeManager;
            if (Has(ifaces, "IImagePoolObject")) return ItemKind.ImagePool;
            if (Has(ifaces, "IGlobalTextListObject") || Has(ifaces, "ITextListObject")) return ItemKind.TextList;

            // Individual cyclic task → `task` (621), matching TwinCAT's flat task items.
            if (Has(ifaces, "ITaskObject")) return ItemKind.Task;

            // Trace recordings, symbol config and project settings are CODESYS-only
            // build/debug artifacts: no TwinCAT tree-item equivalent and no editable
            // source. Return Unknown (skip) rather than lump them into a meaningless
            // catch-all — ITraceObject / ISymbolConfigObject / IWorkspaceObject fall
            // through here intentionally.
            return ItemKind.Unknown; // unrecognized / non-emittable — don't emit a phantom item
        }

        /// <summary>Containers we recurse into but never emit.</summary>
        public static bool IsRecurseOnlyContainer(int code) =>
            code is ItemKind.Application or ItemKind.PlcLogic or ItemKind.Device or ItemKind.TaskConfig;

        /// <summary>Transient/hidden/unrecognized nodes: skip entirely (no emit, no recurse).</summary>
        public static bool IsSkipped(int code) => code is ItemKind.Skip or ItemKind.Unknown;

        private static bool Has(HashSet<string> ifaces, string name) => ifaces.Contains(name);

        private static int RefinePou(string? decl)
        {
            var k = LeadingKeyword(decl);
            if (k.StartsWith("FUNCTION_BLOCK")) return ItemKind.FunctionBlock;
            if (k.StartsWith("INTERFACE")) return ItemKind.Interface;
            if (k.StartsWith("FUNCTION")) return ItemKind.Function;
            if (k.StartsWith("PROGRAM")) return ItemKind.Program;
            return ItemKind.FunctionBlock; // default
        }

        private static int RefineDut(string? decl)
        {
            var u = (decl ?? "").ToUpperInvariant();
            if (u.IndexOf("STRUCT", StringComparison.Ordinal) >= 0) return ItemKind.Structure;
            if (u.IndexOf("UNION", StringComparison.Ordinal) >= 0) return ItemKind.Union;
            if (u.IndexOf('(') >= 0 && u.IndexOf(':') >= 0) return ItemKind.Enumeration;  // TYPE x : (a,b,c);
            return ItemKind.Alias;
        }

        private static int RefineAccessor(string? name) =>
            string.Equals(name, "Set", StringComparison.OrdinalIgnoreCase) ? ItemKind.PropertySet : ItemKind.PropertyGet;

        private static string LeadingKeyword(string? decl)
        {
            if (string.IsNullOrEmpty(decl)) return "";
            var s = decl!.TrimStart();
            int end = 0;
            while (end < s.Length && (char.IsLetterOrDigit(s[end]) || s[end] == '_')) end++;
            return s.Substring(0, end).ToUpperInvariant();
        }
    }
}
