using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// AN OBJECT'S PROPERTIES, read and written (openspec <c>bridge-one-to-one</c> §1.1, §1.2, §3): its CLASS where the
    /// text cannot tell it, and the second archive CODESYS keeps beside the object — <c>IMetaObject.Properties</c>
    /// (<c>BuildProperty</c>, <c>DocumentationProperty</c>, <c>FileLink</c>, …), measured member for member by the census
    /// (design §0.1). Every property a source object can hold is decided: spelled (<see cref="ObjectProperties"/>), owned
    /// by another part of the text (the folder, an unsupported body), or refused by name — never dropped.
    /// </summary>
    internal sealed partial class CodesysObjectModel
    {
        /// <summary>The object's IMetaObject — the read checkout, NOT released (<see cref="ReadObject"/>'s note).</summary>
        private object ReadMeta(object node) =>
            InvokeMethod(_objMgr ?? throw new BridgeException(BridgeErrorCodes.IdeUnsupported, "CODESYS ObjectManager unavailable"),
                         "GetObjectToRead", HandleOf(node), GuidOf(node))
            ?? throw new BridgeException(BridgeErrorCodes.Unreadable, $"CODESYS: GetObjectToRead returned nothing for '{GetName(node)}'");

        /// <summary>The meta object's properties — a member every IMetaObject declares; its absence is an object model
        /// Volt was not built against, refused by name (never read as "no properties").</summary>
        private static IReadOnlyList<object> MetaProperties(object meta) =>
            ((NwlInterop.Has(meta, "Properties") ? NwlInterop.Get(meta, "Properties") : null) as IEnumerable
             ?? throw new BridgeException(BridgeErrorCodes.Unsupported,
                 $"CODESYS: the meta object ({meta.GetType().Name}) answers no Properties list — an object model Volt was " +
                 "not built against; refusing rather than reading the object as one with no properties."))
            .Cast<object?>().Where(p => p != null).Select(p => p!).ToList();

        /// <summary>The property classes that belong to an UNSUPPORTED body and travel with it — the body is never written,
        /// so neither are they (design §1.1 "Object properties").</summary>
        private static readonly HashSet<string> BodyProperties = new(StringComparer.Ordinal)
        {
            "SFCProperty", "CFCProperty", "SFCLibraryProperty", "TransitionMonitoringProperty",
            "ActionObjectDuplicationModeProperty", "TransitionObjectDuplicationModeProperty",
        };

        /// <summary>The members of a SENDER's <c>NetVarProperties</c> the text spells, in the vendor's archive order
        /// (census §0.1); <c>GuidTaskStartSlot</c> / <c>GuidTaskEndSlot</c> are vendor-minted identity.</summary>
        private static readonly string[] NetVarMembers =
        {
            "Acknowledge", "Checksum", "EventVariable", "Interval", "ListIdentifier", "MinimumGap", "PackVariables",
            "ProtocolName", "TransmitCyclic", "TransmitOnChange", "TransmitOnEvent", "TaskName", "ImportFileName",
            "ProtocolParameterValues",
        };

        /// <summary>The members of a RECEIVER (<c>NVLObject</c>) the text spells; <c>ReferenceGuidGVL</c> / <c>GuidTaskSlot</c>
        /// are vendor-minted GUIDs and <c>ImportFileTimestamp</c> the import file's mtime (a cache).</summary>
        private static readonly string[] ReceiverMembers = { "ImportFromFile", "ImportFileName", "TaskName", "SenderGVLName" };

        /// <summary>The object's properties, as <see cref="ObjectProperties"/> — <paramref name="what"/> names it for a
        /// refusal. <paramref name="iobj"/> is the object read through the same checkout's <c>.Object</c>.</summary>
        public ObjectProperties ReadProperties(object node, object iobj, string what)
        {
            var meta = ReadMeta(node);
            bool exclude = false, linkAlways = false, external = false, systemCall = false;
            int reserve = 0;
            string? defines = null, comment = null;
            var undefines = new List<string>();
            FileLink? fileLink = null;

            foreach (var p in MetaProperties(meta))
            {
                var cls = p.GetType().Name;
                switch (cls)
                {
                    case "SVFoldersProperty": continue;   // the folder: the tree spells it
                    case "BuildProperty":
                        exclude = RequireBool(p, "ExcludeFromBuild", what);
                        linkAlways = RequireBool(p, "LinkAlways", what);
                        external = RequireBool(p, "External", what);
                        systemCall = RequireBool(p, "EnableSystemCall", what);
                        reserve = NwlInterop.Declared(p, "MemoryReserveForOnlineChange") is int r
                            ? r : throw Unreadable(what, "BuildProperty.MemoryReserveForOnlineChange");
                        defines = NwlInterop.Declared(p, "CompilerDefines") is string d
                            ? (d.Length == 0 ? null : d) : throw Unreadable(what, "BuildProperty.CompilerDefines");
                        undefines = (NwlInterop.Declared(p, "Undefines") as IEnumerable
                                     ?? throw Unreadable(what, "BuildProperty.Undefines"))
                            .Cast<object?>().Select(u => u as string ?? throw Unreadable(what, "BuildProperty.Undefines[]")).ToList();
                        continue;
                    case "DocumentationProperty":
                        comment = NwlInterop.Declared(p, "Documentation") is string doc
                            ? (doc.Length == 0 ? null : doc) : throw Unreadable(what, "DocumentationProperty.Documentation");
                        continue;
                    case "FileLink":
                        fileLink = new FileLink(
                            NwlInterop.Declared(p, "Linkage")?.ToString() ?? throw Unreadable(what, "FileLink.Linkage"),
                            NwlInterop.Declared(p, "FileName") as string ?? throw Unreadable(what, "FileLink.FileName"));
                        continue;
                    case "POUImageProperty":
                        // A binary image has no text form (design §1.1): the pull names it, an in-place write never touches
                        // it (Volt writes no image), and the text does not claim it.
                        VoltLog.Warn($"pull: {what} carries a POU image (POUImageProperty) — it has no text form, so the pull " +
                                     "does not spell it and a create from this text makes the POU without it");
                        continue;
                    default:
                        if (BodyProperties.Contains(cls)) continue;
                        throw new BridgeException(BridgeErrorCodes.Unsupported,
                            $"{what}: its CODESYS object property '{cls}' has no text form in Volt (openspec bridge-one-to-one " +
                            "§1.1: refused by name — niche: accepted loss, 0 occurrences in the corpora for every such class), " +
                            "so the item is not pulled rather than pulled without it.");
                }
            }

            var (objectClass, netVar, parameterList) = ReadClass(iobj, what);
            return new ObjectProperties(objectClass, exclude, linkAlways, external, systemCall, reserve, defines, undefines,
                                        comment, parameterList, netVar, fileLink);
        }

        /// <summary>The object's CLASS where the text cannot tell it (design §1.1 "Classes"), its network-variable
        /// settings and its parameter-list flag.</summary>
        private (ObjectClass? Class, IReadOnlyList<NetVarSetting> NetVar, bool ParameterList) ReadClass(object iobj, string what)
        {
            var type = iobj.GetType().Name;
            var ifaces = ObjectInterfaceNames(iobj);
            var none = Array.Empty<NetVarSetting>();
            RequireMeasuredConstants(iobj, type, what);

            if (type is "TasklocalGVLObject" or "AbstractFunctionblockPropertyAccessorObject" or "TransitionObject")
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: a CODESYS {type} has no text form in Volt (openspec bridge-one-to-one §1.1 — niche: accepted " +
                    "loss, 0 occurrences in the corpora).");

            if (type == "POUObjectCheckFunction")
            {
                var kind = NwlInterop.Declared(iobj, "KindOfCheckFunction")?.ToString()
                    ?? throw Unreadable(what, "KindOfCheckFunction");
                return (new ObjectClass(ObjectClass.Check, kind), none, false);
            }
            if (ifaces.Contains("ITextListEnumerationObject"))
            {
                RequireTextListRowsOnly(iobj, what);
                return (new ObjectClass(ObjectClass.TextListEnum, null), none, false);
            }
            if (ifaces.Contains("INVLObject"))
                return (new ObjectClass(ObjectClass.Nvl, null), ReceiverSettings(iobj, what), false);
            if (ifaces.Contains("IPersistentGVLObject"))
                return (new ObjectClass(ObjectClass.Persistent, null), SenderSettings(iobj, what), false);
            if (ifaces.Contains("IGVLObject"))
            {
                var parameterList = ifaces.Contains("IGVLObject3")
                    && (NwlInterop.Declared(iobj, "ParameterList") is bool b ? b : throw Unreadable(what, "ParameterList"));
                return (null, SenderSettings(iobj, what), parameterList);
            }
            return (null, none, false);
        }

        /// <summary>WHAT A NON-ITEM HOLDS THAT NO TEXT SPELLS (design §1.1; gate review of step 3, finding 3): a FOLDER's
        /// build property (4 excluded folders in the corpora — folders are no items, and the objects inside an excluded
        /// folder are not built, so they must not pull and migrate as built ones), an APPLICATION's build property (its
        /// compiler defines, 2), the Task Configuration's system events (1) and stack settings off their measured value
        /// (<c>StackSize 0</c>, <c>UseConfigurableStackSize false</c> on 5 of 5). Each is REFUSED BY NAME in the pull report:
        /// the walk lists the object unreadable with this reason. <c>Inside</c>: whether what is under it may still be
        /// walked — false for an excluded folder (its objects are read as excluded by nothing, so they are not read), true
        /// for the application and the Task Configuration (what they hold is no property of the items under them). Null
        /// when the object holds none of these.</summary>
        public (string Reason, bool Inside)? ContainerRefusal(object node)
        {
            var meta = ReadMeta(node);
            var what = $"'{GetName(node)}'";
            var reasons = new List<string>();
            var excluded = false;
            if (MetaProperties(meta).FirstOrDefault(p => p.GetType().Name == "BuildProperty") is { } build)
            {
                var set = new List<string>();
                if (RequireBool(build, "ExcludeFromBuild", what)) { set.Add(Volt.Engine.Ide.ExcludedFolder.ExcludeFromBuild); excluded = true; }
                if (RequireBool(build, "LinkAlways", what)) set.Add("LinkAlways");
                if (RequireBool(build, "External", what)) set.Add("External");
                if (RequireBool(build, "EnableSystemCall", what)) set.Add("EnableSystemCall");
                if (!(NwlInterop.Declared(build, "MemoryReserveForOnlineChange") is int r)) throw Unreadable(what, "BuildProperty.MemoryReserveForOnlineChange");
                if (r != 0) set.Add($"MemoryReserveForOnlineChange {r}");
                if (!(NwlInterop.Declared(build, "CompilerDefines") is string d)) throw Unreadable(what, "BuildProperty.CompilerDefines");
                if (d.Length > 0) set.Add($"CompilerDefines '{d}'");
                if (Count(NwlInterop.Declared(build, "Undefines") ?? throw Unreadable(what, "BuildProperty.Undefines")) > 0)
                    set.Add("Undefines");
                if (set.Count > 0) reasons.Add(Volt.Engine.Ide.ExcludedFolder.BuildProperty(set));
            }
            var folder = IsFolder(node);
            var obj = folder ? null : GetMember(meta, "Object");
            if (obj?.GetType().Name == "TaskConfigObject")
            {
                if (Count(ArchivedObject(obj, "alSysEventList", what)) is var events && events > 0)
                    reasons.Add($"{events} system event(s) (alSysEventList)");
                // Both absent from 3.5.18.30's archive (DIALECT V7): no stack setting exists there to name.
                if (Archives(obj, "StackSize", what) && Archived(obj, "StackSize", what) is var stack && stack != "0")
                    reasons.Add($"StackSize {stack} (measured 0 on 5 of 5)");
                if (Archives(obj, "UseConfigurableStackSize", what)
                    && Archived(obj, "UseConfigurableStackSize", what) is var configurable && configurable != "false")
                    reasons.Add($"UseConfigurableStackSize {configurable} (measured false on 5 of 5)");
            }
            if (reasons.Count == 0) return null;
            // Only an EXCLUDED folder's objects are unbuilt (gate review of step 3, finding 4): a folder linked always,
            // or holding defines, holds built objects, and they are walked.
            var inside = !(folder && excluded);
            return (Volt.Engine.Ide.ExcludedFolder.Reason(what, reasons, inside), inside);
        }

        /// <summary>THE MEASURED CONSTANTS of the source classes (design §1.1 "Members of the source classes"; gate review of
        /// step 3, finding 2): a member the census found at ONE value on every occurrence has no text form, so another value
        /// refuses the item by name — unread, an object holding another value would pull as a plain one and a create from
        /// that text would silently make the measured default. Read through the vendor's own archive (the
        /// members the census read), on the classes that archive them.</summary>
        private void RequireMeasuredConstants(object iobj, string type, string what)
        {
            switch (type)
            {
                // The census read these three on the 436 plain POUs. A check function (POUObjectCheckFunction) archives
                // none of them: its archive is `Implementation`, `Interface`, `SpecialFunc` (measured 2026-10-13, step 4b,
                // SP21 Patch 4 — design §0.1 had listed POULevel on it, and requiring it left all 15 corpus check functions
                // unreadable), so it has no constant to hold.
                case "POUObject":
                    RequireConstant(iobj, "POULevel", "Standard", "436 of 436 POUs", what);
                    RequireConstant(iobj, "AddAttributeSubsequent", "false", "496 of 496 POUs and GVLs", what);
                    if (Count(ArchivedObject(iobj, "ChildObjectGuids", what)) is var n && n > 0)
                        throw OffConstant(what, "ChildObjectGuids", $"{n} GUID(s)", "empty on 436 of 436 POUs");
                    break;
                case "GVLObject":
                    RequireConstant(iobj, "AddAttributeSubsequent", "false", "496 of 496 POUs and GVLs", what);
                    break;
                case "VarPersistentObject":
                    if (ArchivedObject(iobj, "persvarlist", what) is { } list)
                        throw OffConstant(what, "persvarlist", Render(list), "null on 4 of 4 persistent lists");
                    break;
            }
        }

        /// <summary>A body aspect's measured constant (design §1.1): <c>Implementation.ParameterInitializationMethodGenerator</c>,
        /// null on each of the 3 aspects that archive it — another value refuses the item by name. An aspect that archives no
        /// such member holds none.</summary>
        public static void RequireMeasuredBodyConstants(object implementation, string what)
        {
            // An aspect that declares no archive holds no archived member (every vendor aspect is IArchivable; a type that
            // is not has nothing the census could have read).
            if (!NwlInterop.Has(implementation, "SerializableValueNames")) return;
            var names = NwlInterop.Declared(implementation, "SerializableValueNames") as IEnumerable
                ?? throw Unreadable(what, $"{implementation.GetType().Name}.SerializableValueNames");
            if (!names.Cast<object?>().Any(x => x as string == "ParameterInitializationMethodGenerator")) return;
            if (NwlInterop.Call(implementation, "GetSerializableValue", "ParameterInitializationMethodGenerator") is { } v)
                throw OffConstant(what, "Implementation.ParameterInitializationMethodGenerator", Render(v), "null on 3 of 3");
        }

        private void RequireConstant(object o, string member, string measured, string where, string what)
        {
            var held = Archived(o, member, what);
            if (held != measured) throw OffConstant(what, member, held, $"'{measured}' on {where}");
        }

        private static BridgeException OffConstant(string what, string member, string held, string measured) =>
            new(BridgeErrorCodes.Unsupported,
                $"{what}: its CODESYS member '{member}' is '{held}' — measured {measured} in the corpora, it has no text " +
                "form in Volt (openspec bridge-one-to-one §1.1), so the item is not pulled rather than pulled as one that " +
                "holds the measured value.");

        /// <summary>A GVL's <c>NetVarProperties</c> — the SENDER's network-variable settings, one per member — or none when
        /// the list sends nothing (the member null, 59 of 60 GVLs).</summary>
        private IReadOnlyList<NetVarSetting> SenderSettings(object gvl, string what)
        {
            if (!NwlInterop.Has(gvl, "NetVarProperties") || NwlInterop.Get(gvl, "NetVarProperties") is not { } nv)
                return Array.Empty<NetVarSetting>();
            return NetVarMembers.Select(m => Setting(m, Archived(nv, m, what), what)).ToList();
        }

        /// <summary>An NVL's receiver members, then the sender settings it imported (<c>ImportNetVarProperties.*</c>).</summary>
        private IReadOnlyList<NetVarSetting> ReceiverSettings(object nvl, string what)
        {
            var list = ReceiverMembers.Select(m => Setting(m, Archived(nvl, m, what), what)).ToList();
            if (ArchivedObject(nvl, "ImportNetVarProperties", what) is { } imported)
                list.AddRange(NetVarMembers.Select(m => Setting("ImportNetVarProperties." + m, Archived(imported, m, what), what)));
            return list;
        }

        /// <summary>One network-variable setting as the text spells it — or the item refused by name where the
        /// <c>%NETVAR</c> line cannot carry the vendor's value exactly (<see cref="Volt.Engine.Format.St.PropertyLines.Unspellable"/>;
        /// gate review of step 3, finding 8).</summary>
        private static NetVarSetting Setting(string key, string value, string what)
        {
            var setting = new NetVarSetting(key, value);
            if (Volt.Engine.Format.St.PropertyLines.Unspellable(setting) is { } why)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: its network-variable setting '{key}': {why} — so the item is not pulled rather than pulled " +
                    "with a value that reads back different (niche: accepted loss, 0 occurrences in the corpora).");
            return setting;
        }

        /// <summary>A text-list enumeration's rows are a MEASURED CACHE of its declaration (<c>textlist-enum-rows-derived</c>,
        /// <c>textlist-enum-edit</c>): rebuilt on every write. What only the vendor's own text-list editor makes — a removed
        /// entry, a language, a translated text — is content Volt has no text form for, refused by name.</summary>
        private void RequireTextListRowsOnly(object textListEnum, string what)
        {
            if (Count(ArchivedObject(textListEnum, "RemovedTextListEntries", what)) > 0)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: its text list holds removed entries (RemovedTextListEntries) — made by CODESYS's own text-list " +
                    "editor, and Volt has no text form for them.");
            if (ArchivedObject(textListEnum, "TextListObject", what) is not { } list) return;
            if (Count(ArchivedObject(list, "Languages", what)) > 0)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: its text list holds languages (translations) — Volt has no text form for them.");
            if (ArchivedObject(list, "TextList", what) is IEnumerable rows)
                foreach (var row in rows)
                    if (row != null && Count(ArchivedObject(row, "LanguageTexts", what)) > 0)
                        throw new BridgeException(BridgeErrorCodes.Unsupported,
                            $"{what}: a row of its text list holds translated texts — Volt has no text form for them.");
        }

        private static int Count(object? collection) =>
            collection is null ? 0 : collection is ICollection c ? c.Count : ((IEnumerable)collection).Cast<object?>().Count();

        /// <summary>An archived member (<c>IArchivable.GetSerializableValue</c>) — the vendor's own member list
        /// (<c>SerializableValueNames</c>), the one the census read — as the text renders it; a member the archive does not
        /// name is refused by name.</summary>
        private string Archived(object o, string member, string what) => Render(ArchivedObject(o, member, what));

        private object? ArchivedObject(object o, string member, string what) =>
            Archives(o, member, what)
                ? NwlInterop.Call(o, "GetSerializableValue", member)
                // The census measured this platform without it, and the caller asked anyway: a site that reads a member
                // with a MemberAvailability row asks Archives first and decides what its absence means there.
                : throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"{what}: CODESYS {_platform} has no member '{o.GetType().Name}.{member}' (DIALECT V7), and Volt reads it " +
                    "here with no measured meaning for its absence, so the item is not pulled.");

        /// <summary>Does the archive name <paramref name="member"/>? True when it does; FALSE when it does not and the
        /// census measured this platform without it (<see cref="MemberAvailability"/>, DIALECT V7) — the fact the member
        /// would carry does not exist here. Any other absence is no version fact and refuses the item by name: member,
        /// type, platform, and why (environment-dependency-audit 2.0).</summary>
        private bool Archives(object o, string member, string what)
        {
            var names = NwlInterop.Declared(o, "SerializableValueNames") as IEnumerable
                ?? throw Unreadable(what, $"{o.GetType().Name}.SerializableValueNames");
            if (names.Cast<object?>().Any(n => n as string == member)) return true;
            if (MemberAvailability.AbsentOn(_platform, o.GetType().Name, member)) return false;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what}: the CODESYS member '{o.GetType().Name}.{member}' is absent from the object's archive on CODESYS " +
                $"{_platform ?? "(platform version unreadable)"} — {MemberAvailability.WhyNotAbsent(_platform)} — so the " +
                "item is not pulled rather than read without it.");
        }

        /// <summary>A vendor value as the text spells it: a bool lower case, a dictionary as <c>key=value</c> pairs sorted by
        /// key, anything else its invariant string.</summary>
        private static string Render(object? v) => v switch
        {
            null => "",
            bool b => b ? "true" : "false",
            string s => s,
            IDictionary d => string.Join("; ", d.Keys.Cast<object>().Select(k => $"{k}={Render(d[k])}").OrderBy(x => x, StringComparer.Ordinal)),
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString() ?? "",
        };

        private static bool RequireBool(object p, string member, string what) =>
            NwlInterop.Declared(p, member) is bool b ? b : throw Unreadable(what, $"{p.GetType().Name}.{member}");

        private static BridgeException Unreadable(string what, string member) =>
            new(BridgeErrorCodes.Unsupported,
                $"{what}: the CODESYS member '{member}' could not be read — Volt reads it rather than assume its value, so " +
                "the item is not pulled.");

        /// <summary>Write the object's properties where they differ from what it holds (<paramref name="held"/>, read in the
        /// same push): the build properties and the comment in one modify transaction. The CLASS never changes in place
        /// (the push refuses a change before it writes, DIALECT C2l), and the network-variable settings, the parameter-list
        /// flag and the file link have no measured write (1, 0 and 1 occurrence in the corpora, no committed fixture) — a
        /// change to any of them is refused by name (niche: accepted loss), never dropped.</summary>
        public void WriteProperties(object node, ObjectProperties held, ObjectProperties pushed, string what)
        {
            if (Equals(held, pushed)) return;
            RefuseUnwritablePropertyChange(held, pushed, what);

            Modify(node, meta =>
            {
                var props = MetaProperties(meta);
                if (!SameBuild(held, pushed))
                {
                    var build = props.FirstOrDefault(p => p.GetType().Name == "BuildProperty");
                    if (build is null && !DefaultBuild(pushed))
                        build = AddProperty(meta, "_3S.CoDeSys.LanguageModelManager.BuildProperty");
                    if (build is not null)
                    {
                        SetMember(build, "ExcludeFromBuild", pushed.ExcludeFromBuild);
                        SetMember(build, "LinkAlways", pushed.LinkAlways);
                        SetMember(build, "External", pushed.External);
                        SetMember(build, "EnableSystemCall", pushed.EnableSystemCall);
                        SetMember(build, "MemoryReserveForOnlineChange", pushed.OnlineChangeReserve);
                        SetMember(build, "CompilerDefines", pushed.CompilerDefines ?? "");
                        SetMember(build, "Undefines", new List<string>(pushed.Undefines));
                    }
                }
                if (held.Comment != pushed.Comment)
                {
                    var doc = props.FirstOrDefault(p => p.GetType().Name == "DocumentationProperty");
                    if (doc is null && pushed.Comment is not null)
                        doc = AddProperty(meta, "_3S.CoDeSys.ObjectCommands.DocumentationProperty");
                    if (doc is not null) SetMember(doc, "Documentation", pushed.Comment ?? "");
                }
            });
        }

        private static bool SameBuild(ObjectProperties a, ObjectProperties b) =>
            a.ExcludeFromBuild == b.ExcludeFromBuild && a.LinkAlways == b.LinkAlways && a.External == b.External
            && a.EnableSystemCall == b.EnableSystemCall && a.OnlineChangeReserve == b.OnlineChangeReserve
            && a.CompilerDefines == b.CompilerDefines && a.Undefines.SequenceEqual(b.Undefines);

        private static bool DefaultBuild(ObjectProperties p) => SameBuild(p, ObjectProperties.None);

        /// <summary>A fresh property of <paramref name="typeName"/> on the checked-out meta object (<c>IMetaObject.AddProperty</c>),
        /// constructed by its parameterless constructor as the vendor's own property pages do; a type that is not loaded
        /// is refused by name.</summary>
        private static object AddProperty(object meta, string typeName)
        {
            var t = Reflection.FindType(typeName)
                ?? throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: the property class '{typeName}' is not loaded in this IDE, so the property cannot be written");
            var p = Activator.CreateInstance(t)!;
            NwlInterop.Call(meta, "AddProperty", p);
            return p;
        }

        /// <summary>Refuse — before anything of the write lands — a property change this driver has no measured write for:
        /// the network-variable settings, the parameter-list flag, the file link (1, 0 and 1 occurrence in the corpora, no
        /// committed fixture: niche, accepted loss). A class change never reaches here (the push refuses it first).</summary>
        public void RefuseUnwritablePropertyChange(ObjectProperties held, ObjectProperties pushed, string what)
        {
            if (!Equals(held.Class, pushed.Class))
                throw new VoltInvariantException($"{what}: a class change reached the write — the push refuses it first");
            RefuseUnmeasuredChange(what, "%NETVAR", held.NetVar.SequenceEqual(pushed.NetVar), 1);
            RefuseUnmeasuredChange(what, "%PARAMETER_LIST", held.ParameterList == pushed.ParameterList, 0);
            RefuseUnmeasuredChange(what, "%FILE_LINK", Equals(held.FileLink, pushed.FileLink), 1);
        }

        private static void RefuseUnmeasuredChange(string what, string key, bool same, int occurrences)
        {
            if (same) return;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what}: a {key} change is not written — Volt has no measured write for it on CODESYS (niche: accepted " +
                $"loss, {occurrences} occurrence(s) in the corpora). Change it in the IDE and pull.");
        }
    }
}
