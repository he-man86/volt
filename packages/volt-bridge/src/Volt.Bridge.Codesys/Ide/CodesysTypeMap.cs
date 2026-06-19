using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
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
            if (isFolder) return ItemKind.PlcFolder;

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
            if (Has(ifaces, "IInterfaceMethodObject")) return ItemKind.PlcItfMeth;
            if (Has(ifaces, "IPOUMethodObject")) return ItemKind.PlcMethod;
            if (Has(ifaces, "IPropertyAccessorObject") || Has(ifaces, "IInterfacePropertyAccessorObject")) return RefineAccessor(name);
            if (Has(ifaces, "IInterfacePropertyObject")) return ItemKind.PlcItfProp;
            if (Has(ifaces, "IPropertyObject")) return ItemKind.PlcProp;
            if (Has(ifaces, "ITransitionObject")) return ItemKind.PlcTrans;
            if (Has(ifaces, "IActionObject")) return ItemKind.PlcAction;

            // Top-level source.
            if (Has(ifaces, "IPOUObject")) return RefinePou(declaration);
            if (Has(ifaces, "IGVLObject") || Has(ifaces, "INVLObject")) return ItemKind.PlcGvl;
            if (Has(ifaces, "IDUTObject")) return RefineDut(declaration);
            if (Has(ifaces, "IInterfaceObject")) return ItemKind.PlcItf;

            // Recognized non-source kinds — distinct wire kinds matching TwinCAT
            // (interface names verified against the Hauzer project's object model).
            if (Has(ifaces, "ILibManObject")) return ItemKind.PlcLibMan;
            if (Has(ifaces, "IVisualManagerObject")) return ItemKind.PlcVisMan;
            if (Has(ifaces, "IVisualObject")) return ItemKind.PlcVisObj;
            if (Has(ifaces, "IRecipeManObject")) return ItemKind.PlcRecipeMan;
            if (Has(ifaces, "IImagePoolObject")) return ItemKind.PlcImagePool;
            if (Has(ifaces, "IGlobalTextListObject") || Has(ifaces, "ITextListObject")) return ItemKind.PlcTextList;

            // Individual cyclic task → `task` (621), matching TwinCAT's flat task items.
            if (Has(ifaces, "ITaskObject")) return ItemKind.PlcTask;

            // CODESYS's OWN "no loaded handler" marker: an object whose providing plugin isn't present in
            // this install reports ONLY IUnknownObject (verified live on Hauzer — 20 such nodes: the German
            // "Bibliotheksverwalter", SoftMotion MotionObjects / Carrier_* / CamRef_* / CamTracks, …). We
            // cannot type what CODESYS itself can't, so emit nothing. This is NOT a classification gap — it
            // is CODESYS declaring the type opaque. Listed explicitly so it reads as a decision, not a miss.
            if (Has(ifaces, "IUnknownObject")) return ItemKind.Unknown;

            // KNOWN-SKIP: CODESYS-only build/debug artifacts with no TwinCAT tree-item equivalent and no
            // editable source — intentionally not emitted (no warning). Recipe DEFINITIONs fall here too:
            // TwinCAT doesn't emit them separately from the recipe manager, so skipping preserves parity.
            if (Has(ifaces, "ITraceObject") || Has(ifaces, "ISymbolConfigObject")
                || Has(ifaces, "IWorkspaceObject") || Has(ifaces, "IRecipeDefinitionObject"))
                return ItemKind.Unknown;

            // TRULY unrecognized: surface ONCE per distinct object-interface signature so a kind we SHOULD
            // handle becomes visible — logged, NOT thrown (throwing mid-walk would crash /refs on one node).
            WarnUnrecognized(name, ifaces);
            return ItemKind.Unknown; // unrecognized / non-emittable — don't emit a phantom item
        }

        private static readonly HashSet<string> _loggedUnknown = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>Log an unrecognized CODESYS object once per distinct *Object-interface signature, so a kind
        /// we should handle is visible without spamming or crashing the walk.</summary>
        private static void WarnUnrecognized(string? name, HashSet<string> ifaces)
        {
            var objIfaces = new List<string>();
            foreach (var i in ifaces) if (i.EndsWith("Object", StringComparison.Ordinal)) objIfaces.Add(i);
            objIfaces.Sort(StringComparer.Ordinal);
            var sig = string.Join("+", objIfaces);
            bool isNew;
            lock (_loggedUnknown) isNew = _loggedUnknown.Add(sig);
            if (isNew)
                Console.Error.WriteLine($"[bridge] unrecognized CODESYS object type (skipped): name='{name}' interfaces=[{sig}]");
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
            if (k.StartsWith("FUNCTION_BLOCK")) return ItemKind.PlcPouFb;
            if (k.StartsWith("INTERFACE")) return ItemKind.PlcItf;
            if (k.StartsWith("FUNCTION")) return ItemKind.PlcPouFunc;
            if (k.StartsWith("PROGRAM")) return ItemKind.PlcPouProg;
            return ItemKind.PlcPouFb; // default
        }

        private static int RefineDut(string? decl)
        {
            var u = (decl ?? "").ToUpperInvariant();
            if (u.IndexOf("STRUCT", StringComparison.Ordinal) >= 0) return ItemKind.PlcDutStruct;
            if (u.IndexOf("UNION", StringComparison.Ordinal) >= 0) return ItemKind.PlcDutUnion;
            // Enum value-list form `TYPE x : (a,b,c);` — match the colon IMMEDIATELY followed by '(', not
            // any '(' anywhere (an alias whose comment contains a paren would otherwise misclassify).
            if (Regex.IsMatch(u, @":\s*\(")) return ItemKind.PlcDutEnum;
            return ItemKind.PlcDutAlias;
        }

        private static int RefineAccessor(string? name) =>
            string.Equals(name, "Set", StringComparison.OrdinalIgnoreCase) ? ItemKind.PlcPropSet : ItemKind.PlcPropGet;

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
