using System;
using System.Linq;
using System.Reflection;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// A CLASS THE TEXT NAMES, made at the create (openspec <c>bridge-one-to-one</c> §3, DIALECT C2r): through the
    /// vendor's own Add Object path — the class's factory, or its constructor with the aspects the POU factory makes — as
    /// <c>create-each-class</c> measured on SP21 (each kept as its class across a reload, build clean). A class with no
    /// measured path is refused by name, never the plain class reported created: the scripting <c>create_*</c> calls make
    /// only the plain classes, and a class never changes in place (C2l).
    /// </summary>
    internal sealed partial class CodesysObjectModel
    {
        private const string TextListEnumFactory = "_3S.CoDeSys.TextList.TextListEnumerationObjectFactory";
        private const string CheckFunctionClass = "_3S.CoDeSys.POUObject.POUObjectCheckFunction";
        private const string AbstractMethodClass = "_3S.CoDeSys.MethodObject.AbstractPOUMethodObject";

        private object CreateClass(object parent, string name, int itemType, ObjectClass cls)
        {
            string Refused(string why) => $"%CLASS {cls}: {why}";
            if (IsScriptProject(Unwrap(parent)))
                throw new ChildRefusedException(Refused(
                    "a class is created only under an application or a folder of one — the POU pool at the project root " +
                    "is not measured (create-each-class)"), ChildRefusalCause.Kind);
            switch (cls.Word, itemType)
            {
                case (ObjectClass.Check, ItemKind.PlcPou):
                    return AddVendorObject(parent, name, NewCheckFunction(cls.Argument!, Refused), factory: null, Refused);
                case (ObjectClass.TextListEnum, ItemKind.PlcDut):
                    return AddViaFactory(parent, name, TextListEnumFactory, Refused);
                case (ObjectClass.Persistent, ItemKind.PlcGvl):
                    // ONLY ONCE THE ORACLE REPRODUCES ONE (design §1.1 `VarPersistentObject`, gate 1): the factory path is
                    // measured creatable (`create-each-class`), but the list's `dymmattributecount` is not — the completeness
                    // oracle (2.1) has not yet re-created a persistent list and read it back (declaration and build) through
                    // this create. Until it does, the create is refused by name rather than made on an unmeasured member
                    // (gate review of step 3, finding 7b). An update, a rename and a move keep the class.
                    throw new ChildRefusedException(Refused(
                        "a persistent list is not created by Volt yet — its factory is measured, but its dymmattributecount " +
                        "is not: the completeness oracle has not reproduced a re-created list (openspec bridge-one-to-one " +
                        "§1.1). Create it in the IDE and pull; an update of an existing one is written."), ChildRefusalCause.Kind);
                case (ObjectClass.AbstractMethod, ItemKind.PlcMethod):
                    // The vendor's abstract method class, made as `create-each-class` / `abstract-member-equivalence` made it
                    // (C2r): its constructor, the aspect it holds null from the POU factory's `DoCreate` — derived from the
                    // text (`METHOD ABSTRACT` with no code), never spelled.
                    return AddVendorObject(parent, name, NewConstructed(AbstractMethodClass, Refused), factory: null, Refused);
                case (ObjectClass.Nvl, ItemKind.PlcGvl):
                    throw new ChildRefusedException(Refused(
                        "CODESYS creates a network variable list only through its wizard — its factory raised a " +
                        "NullReferenceException when called without one (create-each-class, DIALECT C2r). Create it in the IDE " +
                        "and pull; an update of an existing one is written."), ChildRefusalCause.Kind);
                default:
                    throw new ChildRefusedException(Refused(
                        $"no {cls.Word} class exists for this kind of object (code {itemType})"), ChildRefusalCause.Kind);
            }
        }

        /// <summary>A check function: the class by its constructor, the Interface / Implementation aspects it holds null
        /// taken from the POU factory's own <c>DoCreate</c> (an ST POU at the Standard level), its
        /// <c>KindOfCheckFunction</c> the check the text names — a name the vendor enum does not hold is refused by name.</summary>
        private static object NewCheckFunction(string check, Func<string, string> refused)
        {
            var selection = Reflection.FindType("_3S.CoDeSys.POUObject.CheckFunctionSelection")
                ?? throw new ChildRefusedException(refused("CheckFunctionSelection is not loaded in this IDE"), ChildRefusalCause.Kind);
            if (!Enum.GetNames(selection).Contains(check, StringComparer.Ordinal))
                throw new ChildRefusedException(refused(
                    $"'{check}' is no check function CODESYS knows — one of {string.Join(", ", Enum.GetNames(selection))}"),
                    ChildRefusalCause.Kind);
            var o = NewConstructed(CheckFunctionClass, refused);
            o.GetType().GetProperty("KindOfCheckFunction", BF)!.SetValue(o, Enum.Parse(selection, check));
            return o;
        }

        /// <summary>A class by its parameterless constructor, each <c>Interface</c> / <c>Implementation</c> aspect it holds
        /// null taken from the POU factory's own <c>DoCreate</c> (an ST POU at the Standard level) — the vendor-facts core's
        /// <c>vendorClass</c> create, the path <c>create-each-class</c> measured for the check function and the abstract
        /// method (C2r).</summary>
        private static object NewConstructed(string typeName, Func<string, string> refused)
        {
            var o = New(typeName, refused);
            var t = o.GetType();
            var holes = new[] { "Interface", "Implementation" }
                .Where(p => t.GetProperty(p, BF) is { } pi && pi.GetValue(o) is null).ToList();
            if (holes.Count > 0)
            {
                var pf = New("_3S.CoDeSys.POUObject.POUObjectFactory", refused);
                var st = New("_3S.CoDeSys.STObject.STImplementationObjectFactory", refused);
                var level = Enum.Parse(Reflection.FindType("_3S.CoDeSys.POUObject.POULevel")
                                       ?? throw new ChildRefusedException(refused("POULevel is not loaded"), ChildRefusalCause.Kind),
                                       "Standard");
                var source = pf.GetType().GetMethod("DoCreate", BF)?.Invoke(pf, new[] { "", st, level })
                    ?? throw new ChildRefusedException(refused("POUObjectFactory.DoCreate answered nothing"), ChildRefusalCause.Kind);
                foreach (var hole in holes)
                    t.GetProperty(hole, BF)!.SetValue(o, source.GetType().GetProperty(hole, BF)!.GetValue(source));
            }
            return o;
        }

        private object AddViaFactory(object parent, string name, string factoryType, Func<string, string> refused)
        {
            var factory = New(factoryType, refused);
            var o = NwlInterop.Call(factory, "Create")
                ?? throw new ChildRefusedException(refused($"{factoryType}.Create() answered nothing"), ChildRefusalCause.Kind);
            return AddVendorObject(parent, name, o, factory, refused);
        }

        /// <summary><c>ObjectMgr.AddObject</c> under the parent, then the factory's <c>ObjectCreated</c>, as the vendor's Add
        /// Object does — and the new node found again by name. A vendor exception (a second persistent list in an
        /// application: "Cannot insert … below 'Application …'") is the create's refusal, by name.
        ///
        /// <para>A FOLDER is no owner AddObject takes for these classes ("Cannot insert 'CheckPointer' below 'Implicit Check
        /// Functions'", measured on Pro2193 by the completeness oracle): the object is added under the folder's owner — the
        /// nearest ancestor that is no folder, the application — and then moved into the folder by the scripting
        /// <c>move</c>, the vendor's own primitive, as a drag in the tree does.</para></summary>
        private object AddVendorObject(object parent, string name, object o, object? factory, Func<string, string> refused)
        {
            var om = _objMgr ?? throw new BridgeException(BridgeErrorCodes.IdeUnsupported, "CODESYS ObjectManager unavailable");
            var owner = parent;
            while (IsFolder(owner))
                owner = ParentOf(owner) ?? throw new ChildRefusedException(refused("the folder has no owner to add it under"),
                                                                           ChildRefusalCause.Kind);
            var ph = HandleOf(owner);
            try
            {
                var g = NwlInterop.Call(om, "AddObject", ph, GuidOf(owner), Guid.NewGuid(), o, name, -1);
                if (factory is not null) NwlInterop.Call(factory, "ObjectCreated", ph, g);
            }
            catch (Exception ex) when (ex is not ChildRefusedException)
            {
                var inner = ex is TargetInvocationException { InnerException: { } i } ? i : ex;
                throw new ChildRefusedException(refused($"CODESYS refused it: {inner.Message}"), ChildRefusalCause.Kind, inner);
            }
            foreach (var child in GetChildren(owner))
                if (string.Equals(GetName(child), name, StringComparison.Ordinal))
                {
                    if (ReferenceEquals(owner, parent)) return child;
                    try { Move(child, parent); }
                    catch (Exception ex)
                    {
                        DeleteChild(owner, name);   // nothing half-made: the object never stands where the text did not put it
                        throw new ChildRefusedException(refused($"CODESYS would not move it into its folder: {ex.Message}"),
                                                        ChildRefusalCause.Kind, ex);
                    }
                    foreach (var moved in GetChildren(parent))
                        if (string.Equals(GetName(moved), name, StringComparison.Ordinal)) return moved;
                    throw new BridgeException(BridgeErrorCodes.IdeLostItem, $"CODESYS: '{name}' was moved into its folder, but the folder holds no child of that name");
                }
            throw new BridgeException(BridgeErrorCodes.IdeLostItem, $"CODESYS: '{name}' was added, but its owner holds no child of that name");
        }

        private static object New(string typeName, Func<string, string> refused) =>
            Activator.CreateInstance(Reflection.FindType(typeName)
                ?? throw new ChildRefusedException(refused($"the class '{typeName}' is not loaded in this IDE"), ChildRefusalCause.Kind))!;
    }
}
