using System.Globalization;
using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Twincat;

/// <summary>
/// TwinCAT's per-item archive — <c>ITcSmTreeItem.ExportChild</c> / <c>ImportChild</c> — and the one fact that
/// turns it into a MOVE.
///
/// <para><b>The archive is a plain zip, and each entry is named by the item's PROJECT-RELATIVE PATH.</b> Measured
/// live (DIALECT D4f): exporting <c>VltProbePou</c> out of folder <c>VltProbeF</c> yields a single entry
/// <c>VltProbeF\VltProbePou.TcPOU</c>, and <c>ImportChild</c> RECREATES that path under the target — which is why
/// a naive export/import lands the item at <c>Target/VltProbeF/VltProbePou</c> instead of moving it. That
/// recreation was read for a long time as "TwinCAT has no move", and the note it left behind said the technique
/// was "usable only with a way to rewrite the path inside the archive, which has not been found". The path is a
/// zip ENTRY NAME. Rewriting it is <see cref="Flatten"/>, below.</para>
///
/// <para>Two vendor constraints the file name and arguments encode, both measured:
/// <list type="bullet">
/// <item><c>ExportChild</c> REQUIRES a <c>.zip</c> file name — <c>.xml</c>, <c>.tszip</c>, <c>.tpzip</c>,
/// <c>.tczip</c>, <c>.tcpou</c>, <c>.xti</c> and <c>.tsproj</c> are all refused.</item>
/// <item><c>ImportChild</c>'s 4th argument RENAMES the imported child, and TwinCAT then rejects the import
/// outright ("Cannot change imported child name!"). It must be omitted, so a move keeps the NAME — which is what
/// Volt wants anyway: the wire identity is the name.</item>
/// </list></para>
/// </summary>
internal static class TcItemArchive
{
    /// <summary>Relocate <paramref name="name"/> from <paramref name="from"/> to <paramref name="to"/>, whole —
    /// children, graphical bodies and all. Export, flatten, delete, import.
    /// <para>The delete has to happen between the export and the import (<c>ImportChild</c> refuses a name the
    /// target's subtree already holds), which opens a window where the item exists only inside the archive. If the
    /// import fails, the archive is imported back into the ORIGINAL parent before the failure is rethrown, so a
    /// refused move leaves the project as it was rather than one POU short. That restore is not a fallback hiding
    /// a fault — the fault is still thrown; it is the undo for a step that already succeeded.</para>
    /// <para><b>A refused import can still deposit the item</b> (DIALECT C2q, measured on TwinCAT: <c>ImportChild</c> into
    /// <c>References</c> refused "No elements imported" and left the item at the PLC project root, so the undo's
    /// re-import came back as <c>GVL_PackML_1</c> — the push said "refused" and the next pull showed two items). So the
    /// undo first deletes a copy of the name the PLC project root (<paramref name="plcRoot"/>) did not hold before the
    /// import, and an undo that restores the item under ANOTHER name is refused naming both — never reported as a
    /// plain refusal. <paramref name="childNames"/> lists a node's child names (the object model's own walk, which never
    /// opens a child Volt must not touch, DIALECT C2i).</para></summary>
    public static void Move(dynamic from, dynamic to, string name, IReadOnlyList<LiveText> live, Action? discard,
                            object plcRoot, Func<object, IReadOnlyCollection<string>> childNames) =>
        RoundTrip(from, to, name, null, live, discard, new Strays(plcRoot, childNames));

    /// <summary>Where a refused import may have left a copy, and how to read a node's child names (see <see cref="Move"/>).</summary>
    private sealed record Strays(object PlcRoot, Func<object, IReadOnlyCollection<string>> ChildNames)
    {
        public bool Holds(object node, string name) =>
            ChildNames(node).Contains(name, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Place <paramref name="memberName"/> — a POU MEMBER — into <paramref name="folderPath"/> inside its
    /// own POU, by rewriting the POU's archive and re-importing it into the SAME parent.
    ///
    /// <para><b>Why not a move.</b> `ExportChild` REFUSES a member — *"The tree item 'Deep' cannot be exported
    /// seperately because it has no document file. Please export the parent node that contains the document!"* —
    /// because a member is not a file: TwinCAT stores the whole POU, members and all, in one `.TcPOU`. So the
    /// relocation happens one level up, on the thing that IS a file.</para>
    ///
    /// <para><b>And the placement is IN that file</b>, which is what makes this work at all (DIALECT D4j). A
    /// member carries <c>FolderPath="Helpers\Inner\"</c> — the full path, backslash-separated, trailing
    /// separator — and the folders themselves are <c>&lt;Folder Name="Helpers" Id="{guid}"&gt;</c> elements that
    /// NEST by element rather than by path. Every member kind uses the same attribute: <c>&lt;Method&gt;</c>,
    /// <c>&lt;Action&gt;</c> and <c>&lt;Property&gt;</c> alike. So a member's placement is expressible, exactly, in
    /// Beckhoff's own storage format.</para>
    ///
    /// <para>An empty <paramref name="folderPath"/> moves the member back to the POU root.</para></summary>
    public static void MoveMember(dynamic pouParent, string pouName, IReadOnlyList<LiveText> live, Action? discard,
                                  string memberName, string folderPath)
    {
        // The lambda is typed BEFORE the call: RoundTrip's first arguments are `dynamic`, so the whole invocation
        // binds at runtime and a bare lambda has no type to infer there.
        Action<string> place = zip => SetMemberFolder(zip, memberName, folderPath);
        RoundTrip(pouParent, pouParent, pouName, place, live, discard);
    }

    /// <summary>Give POU MEMBERS graphical bodies, by rewriting the POU's own archive and re-importing it.
    ///
    /// <para><b>Why this exists at all.</b> `WriteText` sets `ImplementationText`, and on a POU already
    /// holding an NWL archive TwinCAT replaces the archive — but on a METHOD, an ACTION or a property
    /// ACCESSOR the same assignment stores the archive AS TEXT. The POU is written, the push reports
    /// success, the body round-trips (Volt reads its own archive straight back), and the project will not
    /// build: `Unexpected Token '&lt;' found`, `';' expected instead of 'NWL'`. Measured by disabling the
    /// refusal that stood here and watching it happen again.</para>
    ///
    /// <para><b>One round trip for the whole POU</b>, not one per member. Each trip DELETES the item before
    /// importing it back (see <see cref="RoundTrip"/>), so doing it per accessor would open that window
    /// three times for one property.</para>
    ///
    /// <para>Each body is addressed by its PATH inside the POU: <c>["M_G"]</c> for a method or action,
    /// <c>["P_G", "Get"]</c> for an accessor — which is how the archive nests them
    /// (<c>&lt;Property Name="P_G"&gt;&lt;Get Name="Get"&gt;</c>).</para></summary>
    public static void SetMemberBodies(dynamic pouParent, string pouName, IReadOnlyList<LiveText> live, Action? discard,
                                       System.Collections.Generic.IReadOnlyList<(string[] Path, string Nwl)> bodies)
    {
        Action<string> write = zip => SetBodies(zip, pouName, bodies);
        RoundTrip(pouParent, pouParent, pouName, write, live, discard);
    }

    /// <summary>One text slot of the item as the IDE holds it NOW, by its path below the item: <c>[]</c> the item itself,
    /// <c>["M"]</c> a member, <c>["P", "Get"]</c> an accessor. A null text is a slot the object does not have, or one
    /// that is not carried (<see cref="TcObjectModel.LiveTexts"/>).</summary>
    internal sealed record LiveText(string[] Path, string? Declaration, string? Implementation);

    /// <summary>Export <paramref name="name"/> out of <paramref name="from"/>, make the archive hold what the IDE holds
    /// (<paramref name="live"/>), optionally rewrite it, and import it into <paramref name="to"/>. The one shape every
    /// round trip shares.
    ///
    /// <para><b>The export is the SAVED document, not what the IDE holds</b> (DIALECT D45, vendor-facts
    /// <c>tc-unsaved-move</c>): an implementation written since the last save, and a rename, are not in it. Volt never
    /// saves the engineer's project, so the round trip carries the live state itself: every text slot that differs from
    /// the archive is written into it before the import (<see cref="CarryLive"/>), and an item the archive still names
    /// by its saved name is renamed to its live one after the import.</para></summary>
    private static void RoundTrip(dynamic from, dynamic to, string name, Action<string>? rewrite,
                                  IReadOnlyList<LiveText> live, Action? discard, Strays? strays = null)
    {
        var zip = Path.Combine(Path.GetTempPath(), "volt_move_" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture) + ".zip");
        // Set when the archive becomes the ONLY surviving copy of the item — the source has been deleted and the
        // undo failed too. In that state the file is not a temp artefact, it is the engineer's work.
        var archiveIsLastCopy = false;
        try
        {
            from.ExportChild(name, zip);
            Flatten(zip);
            // The name the archive carries: the item's SAVED name, which an import gives it (a rename since is not in it).
            var archived = CarryLive(zip, name, live);
            rewrite?.Invoke(zip);
            // The member documents XAE holds open would make the delete ask to save them (D45); the archive carries them.
            discard?.Invoke();
            from.DeleteChild(name);
            // Asked BEFORE the import: a name the root holds already is another object, never the move's own copy.
            var rootHeldName = strays is { } before && before.Holds(before.PlcRoot, archived);
            try
            {
                to.ImportChild(zip, Type.Missing, false, Type.Missing);
            }
            catch (Exception refused)
            {
                // A REFUSED import that still deposited the item at the PLC project root (DIALECT C2q): that copy is
                // the move's own, so it goes before the undo — else the undo's re-import clashes with it and the
                // vendor renames the restored item.
                if (strays is { } s && !rootHeldName && s.Holds(s.PlcRoot, archived))
                    ((dynamic)s.PlcRoot).DeleteChild(archived);

                // Put it back where it came from. If THIS throws too the original is genuinely gone, and the
                // archive path is in the message so it can be re-imported by hand.
                var fromBefore = strays?.ChildNames((object)from).ToList();
                try { from.ImportChild(zip, Type.Missing, false, Type.Missing); }
                catch (Exception restore)
                {
                    // The item is gone from the source and never arrived at the destination: this archive is all
                    // that is left of it, so the `finally` below must not delete it: the message's recovery
                    // instruction points at it. A recovery route that deletes its own evidence is worse than no message.
                    archiveIsLastCopy = true;
                    throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                        $"move of '{name}' failed AND could not be undone — the item is in the archive at {zip}, " +
                        $"import it manually ({restore.Message})", restore);
                }

                // Restored under its SAVED name: give it its live name back, as the move would have.
                try { Rename(from, archived, name); }
                catch (Exception rename)
                {
                    throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                        $"move of '{name}' was refused ({refused.Message}) and its undo restored the item under its saved " +
                        $"name '{archived}' ({rename.Message}) — rename it back to '{name}' in the IDE", refused);
                }

                // RESTORED — but under its own name? The vendor renames an import that clashes (`GVL_PackML_1`), and
                // a renamed restore is a NEW item to the next pull, not "the move was refused".
                if (strays is { } r && !r.Holds((object)from, name))
                {
                    var appeared = r.ChildNames((object)from).Except(fromBefore!, StringComparer.OrdinalIgnoreCase).ToList();
                    throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                        $"move of '{name}' was refused ({refused.Message}) and its undo restored the item as " +
                        $"'{string.Join("', '", appeared)}', not '{name}' — rename it back to '{name}' in the IDE",
                        refused);
                }
                throw;
            }
            Rename(to, archived, name);
        }
        // Deleted on every path EXCEPT the unrecoverable one. Keeping every archive would litter %TEMP% after
        // an ordinary hiccup the undo already repaired; keeping this one is the difference between a failed move
        // and a lost POU.
        finally { if (!archiveIsLastCopy) { try { File.Delete(zip); } catch { /* temp file */ } } }
    }

    /// <summary>The imported item under <paramref name="parent"/> carries its SAVED name <paramref name="archived"/>; give
    /// it its live name. Measured (D45, <c>tc-unsaved-move</c>): a rename after the import lands, header and all.</summary>
    private static void Rename(dynamic parent, string archived, string name)
    {
        if (string.Equals(archived, name, StringComparison.Ordinal)) return;
        dynamic landed = parent.LookupChild(archived);
        landed.Name = name;
    }

    /// <summary>Write what the IDE holds into the exported archive: each <paramref name="live"/> slot whose text differs
    /// from the archived one replaces it — a declaration as its CDATA, a textual body as its <c>&lt;ST&gt;</c>, a network
    /// body as its <c>&lt;NWL&gt;</c> element, with the body's <c>LineIds</c> removed as <see cref="TrySetBody"/> does
    /// (line bookkeeping for text that is no longer there). A body archived in any other form (CFC, SFC) travels as
    /// archived, so the IDE must hold exactly it: one edited since the save is refused by name. A slot equal to the
    /// archive leaves the vendor's bytes untouched.
    ///
    /// <para>A live member the archive does not hold (renamed since the save) is refused HERE, before the item is
    /// deleted: the import would drop it. Returns the name the archive carries.</para></summary>
    private static string CarryLive(string zip, string name, IReadOnlyList<LiveText> live)
    {
        var rebuilt = zip + ".live";
        try { File.Delete(rebuilt); } catch { /* fresh temp */ }
        string? archived = null;
        var carried = new HashSet<string>(StringComparer.Ordinal);
        var changedAny = false;
        try
        {
        using (var src = ZipFile.OpenRead(zip))
        using (var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create))
        {
            foreach (var entry in src.Entries)
            {
                var (text, bom) = ReadEntry(entry);
                if (IsPlcSource(entry.FullName) && archived is null)
                {
                    var doc = ParseVerbatim(text);
                    var obj = doc.Root?.Elements().FirstOrDefault()
                        ?? throw new BridgeException(BridgeErrorCodes.Unreadable, $"the archive of '{name}' holds no object element");
                    archived = (string?)obj.Attribute("Name") ?? Path.GetFileNameWithoutExtension(Leaf(entry.FullName));
                    var changed = false;
                    foreach (var slot in live)
                    {
                        if (Slot(obj, slot.Path) is not { } el) continue;
                        carried.Add(string.Join(".", slot.Path));
                        changed |= CarryDeclaration(el, slot.Declaration);
                        changed |= CarryImplementation(obj, el, slot.Implementation,
                            () => slot.Path.Length == 0 ? $"'{name}'" : $"'{name}': '{string.Join(".", slot.Path)}'");
                    }
                    if (changed) { text = SaveVerbatim(doc); changedAny = true; }
                }
                WriteEntry(dst, entry.FullName, text, bom);
            }
        }
        }
        catch
        {
            try { File.Delete(rebuilt); } catch { /* temp */ }
            throw;
        }
        var lost = live.Select(t => string.Join(".", t.Path)).Where(k => !carried.Contains(k)).ToList();
        if (archived is null || lost.Count > 0)
        {
            try { File.Delete(rebuilt); } catch { /* temp */ }
            if (archived is null) throw new BridgeException(BridgeErrorCodes.Unreadable, $"the archive of '{name}' holds no source document");
            // A vendor limit, not Volt's invariant: TwinCAT's archive carries no member renamed since the save (D45).
            throw new Volt.Engine.BridgeException(Volt.Contracts.BridgeErrorCodes.Unsupported,
                $"'{name}': '{string.Join("', '", lost)}' is in the IDE but not in the document TwinCAT exports for it " +
                "(renamed since the project was saved) — the round trip would drop it, so nothing was changed. Save the " +
                "project in the IDE and push again.");
        }
        if (changedAny) { File.Delete(zip); File.Move(rebuilt, zip); }
        else File.Delete(rebuilt);
        return archived;
    }

    /// <summary>The archive element of the slot at <paramref name="path"/> below the item's own element, matched by name
    /// ordinal-ignore-case, as every layer matches a member (see <see cref="TrySetBody"/>).</summary>
    private static XElement? Slot(XElement obj, string[] path)
    {
        XElement? at = obj;
        foreach (var step in path)
        {
            at = at?.Descendants().FirstOrDefault(e => e.Name.LocalName is "Method" or "Action" or "Property" or "Transition"
                                                                         or "Get" or "Set"
                                                       && string.Equals((string?)e.Attribute("Name"), step,
                                                                        StringComparison.OrdinalIgnoreCase));
            if (at is null) return null;
        }
        return at;
    }

    private static bool CarryDeclaration(XElement el, string? live)
    {
        if (live is null || el.Elements().FirstOrDefault(e => e.Name.LocalName == "Declaration") is not { } d) return false;
        if (SameText(d.Value, live)) return false;
        d.ReplaceNodes(new XCData(live));
        return true;
    }

    private static bool CarryImplementation(XElement obj, XElement el, string? live, Func<string> what)
    {
        if (live is null || el.Elements().FirstOrDefault(e => e.Name.LocalName == "Implementation") is not { } impl)
            return false;
        var form = impl.Elements().FirstOrDefault();
        if (form is not null && form.Name.LocalName is not ("ST" or "NWL"))
        {
            // A body archived in a form Volt does not write (CFC, SFC) travels as archived — so only when the IDE holds
            // exactly it. XAE answers such a body live as the very element the file saves (measured 2026-10-23 on
            // VltFixtureCfc / VltFixtureSfc: equal as parsed XML); any other answer is an edit since the save, which the
            // export does not hold (D45) and the round trip cannot carry. Refused by name, before anything is deleted.
            if (ParsedOrNull(live) is { } held && XNode.DeepEquals(XElement.Parse(form.ToString(SaveOptions.DisableFormatting)), held))
                return false;
            throw new Volt.Engine.BridgeException(Volt.Contracts.BridgeErrorCodes.Unsupported,
                $"{what()}: its {form.Name.LocalName} body in the IDE is not the one TwinCAT exports for it (edited since the " +
                "project was saved) — the round trip would put the saved body back, so nothing was changed. Save the " +
                "project in the IDE and push again.");
        }
        if (TcArchive.Root(live) is null)
        {
            // A textual body is carried into an ST body.
            if (form is null ? live.Length == 0 : SameText(form.Value, live)) return false;
            impl.ReplaceNodes(new XElement(impl.Name.Namespace + "ST", new XCData(live)));
        }
        else
        {
            var network = XElement.Parse(live);
            if (form is not null && form.Name.LocalName == "NWL"
                && XNode.DeepEquals(XElement.Parse(form.ToString(SaveOptions.DisableFormatting)), network))
                return false;
            impl.ReplaceNodes(network);
        }
        RemoveLineIds(obj, el, what);
        return true;
    }

    /// <summary>The body as XML, or null for text that is none (an ST body).</summary>
    private static XElement? ParsedOrNull(string body)
    {
        try { return XElement.Parse(body); }
        catch (System.Xml.XmlException) { return null; }
    }

    /// <summary>Text compared line endings aside: the archive stores CRLF.</summary>
    private static bool SameText(string archived, string live) =>
        string.Equals(archived.Replace("\r\n", "\n"), live.Replace("\r\n", "\n"), StringComparison.Ordinal);

    /// <summary>The <c>Name</c> an archived element states — the POU's, or a member's on the path to a body — the key its
    /// <c>&lt;LineIds&gt;</c> are found by. TwinCAT names each one; an element that names itself nothing is refused by name,
    /// never keyed by <c>""</c>, which matched no <c>LineIds</c> and left the stale ones in the archive.</summary>
    private static string ArchivedName(XElement element, Func<string> what) =>
        (string?)element.Attribute("Name")
        ?? throw new BridgeException(BridgeErrorCodes.Unreadable,
            $"{what()}: TwinCAT's archive of it holds a <{element.Name.LocalName}> with no Name — Volt finds " +
            "a body's line bookkeeping by those names, so nothing was changed.");

    /// <summary>Remove the <c>&lt;LineIds Name="POU.M"&gt;</c> of the body at <paramref name="el"/>: the item's own name,
    /// then the path as the archive spells it.</summary>
    private static void RemoveLineIds(XElement obj, XElement el, Func<string> what)
    {
        var spelled = new List<string>();
        for (var e = el; e != null && e != obj; e = e.Parent)
            if (e.Attribute("Name") is { } n) spelled.Insert(0, n.Value);
        spelled.Insert(0, ArchivedName(obj, what));
        var key = string.Join(".", spelled);
        foreach (var ids in obj.Descendants().Where(e => e.Name.LocalName == "LineIds"
                                                         && string.Equals((string?)e.Attribute("Name"), key,
                                                                          StringComparison.OrdinalIgnoreCase)).ToList())
            ids.Remove();
    }

    /// <summary>Strip every entry's directory prefix, so <c>ImportChild</c> has no source path left to recreate
    /// under the target and drops the item straight in. Rewrites the archive in place.
    /// <para>Only entry NAMES change — each entry's bytes are copied through untouched, so nothing here parses or
    /// re-serializes the vendor's payload.</para></summary>
    private static void Flatten(string zip)
    {
        var rebuilt = zip + ".flat";
        using (var src = ZipFile.OpenRead(zip))
        {
            if (src.Entries.All(e => Leaf(e.FullName) == e.FullName)) return;   // already flat (item was at the root)
            using var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create);
            foreach (var entry in src.Entries)
            {
                var copy = dst.CreateEntry(Leaf(entry.FullName), CompressionLevel.Optimal);
                using var input = entry.Open();
                using var output = copy.Open();
                input.CopyTo(output);
            }
        }
        File.Delete(zip);
        File.Move(rebuilt, zip);
    }

    /// <summary>Point the named member at <paramref name="folderPath"/> inside the archived <c>.TcPOU</c>, creating
    /// the <c>&lt;Folder&gt;</c> chain it names. Rewrites the archive in place.
    /// <para>Parsed as XML rather than patched as text: the member elements carry declarations and implementations
    /// in CDATA, and a regex over that works until a body happens to contain the pattern.</para>
    /// <para>A member the archive does not carry is an ERROR, not a no-op. Silence would report a placement that
    /// never happened.</para></summary>
    private static void SetMemberFolder(string zip, string memberName, string folderPath)
    {
        var rebuilt = zip + ".placed";
        try { File.Delete(rebuilt); } catch { /* fresh temp */ }
        using (var src = ZipFile.OpenRead(zip))
        using (var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create))
        {
            var placed = false;
            foreach (var entry in src.Entries)
            {
                var (text, bom) = ReadEntry(entry);
                // ANY vendor source document, not just a .TcPOU. An interface lives in a `.TcIO`, whose
                // `<Itf>` holds exactly the `<Method>`/`<Property>` children `TryPlace` looks for - and
                // `EnclosingPouOf` deliberately routes interface members here. Matching only `.TcPOU` meant an
                // interface member could NEVER be placed, and the failure blamed the archive
                // ("is not in its POU's archive") for not containing something it did contain, which sends
                // whoever reads it looking in the wrong place. `TryPlace` selects by ELEMENT anyway, so it is
                // safe to offer it every source document and let it decide.
                if (IsPlcSource(entry.FullName))
                    placed |= TryPlace(ref text, memberName, folderPath);
                WriteEntry(dst, entry.FullName, text, bom);
            }
            if (!placed)
                throw new BridgeException(BridgeErrorCodes.Unreadable,
                    $"'{memberName}' is not in its POU's archive, so it cannot be placed in '{folderPath}'");
        }
        File.Delete(zip);
        File.Move(rebuilt, zip);
    }

    /// <summary>Write each body into the archive's source documents. Same shape as
    /// <see cref="SetMemberFolder"/>: every entry is copied through, the PLC source documents get the
    /// rewrite offered to them, and a body no document claims is an ERROR rather than a silent no-op.</summary>
    private static void SetBodies(string zip, string pouName,
                                  System.Collections.Generic.IReadOnlyList<(string[] Path, string Nwl)> bodies)
    {
        var rebuilt = zip + ".bodies";
        try { File.Delete(rebuilt); } catch { /* fresh temp */ }

        var written = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
        using (var src = ZipFile.OpenRead(zip))
        using (var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create))
        {
            foreach (var entry in src.Entries)
            {
                var (text, bom) = ReadEntry(entry);

                if (IsPlcSource(entry.FullName))
                    foreach (var (path, nwl) in bodies)
                        if (TrySetBody(ref text, path, nwl, pouName))
                            written.Add(string.Join(".", path));

                WriteEntry(dst, entry.FullName, text, bom);
            }
        }

        var missing = bodies.Select(b => string.Join(".", b.Path)).Where(k => !written.Contains(k)).ToList();
        if (missing.Count > 0)
        {
            try { File.Delete(rebuilt); } catch { /* temp */ }
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"'{string.Join("', '", missing)}' is not in the POU's archive, so no graphical body could be " +
                "written into it");
        }

        File.Delete(zip);
        File.Move(rebuilt, zip);
    }

    /// <summary>An archive entry's text, and whether the vendor opened it with a UTF-8 byte order mark.
    /// <para>TwinCAT writes one on every source document, and the rewrite goes back into the IDE whole — so the
    /// mark is part of "every byte as the vendor wrote it", not decoration. A default <c>StreamReader</c> eats it
    /// and a default <c>StreamWriter</c> writes none, which cost every re-imported document its first three bytes
    /// (<c>TcHiddenBodyWriteTests</c>).</para></summary>
    private static (string Text, bool Bom) ReadEntry(ZipArchiveEntry entry)
    {
        using var input = entry.Open();
        using var bytes = new MemoryStream();
        input.CopyTo(bytes);
        var raw = bytes.ToArray();
        var bom = raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF;
        return (Utf8.GetString(raw, bom ? 3 : 0, raw.Length - (bom ? 3 : 0)), bom);
    }

    /// <summary>The counterpart of <see cref="ReadEntry"/>: the text as UTF-8, with the mark exactly when the vendor's
    /// entry had one.</summary>
    private static void WriteEntry(ZipArchive dst, string entryName, string text, bool bom)
    {
        using var output = dst.CreateEntry(entryName, CompressionLevel.Optimal).Open();
        if (bom) output.Write(new byte[] { 0xEF, 0xBB, 0xBF }, 0, 3);
        var body = Utf8.GetBytes(text);
        output.Write(body, 0, body.Length);
    }

    // Strict: bytes that are not UTF-8 throw here, BEFORE the POU is deleted, rather than being replaced with U+FFFD
    // and imported over the engineer's text.
    private static readonly System.Text.UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>Point one member's <c>&lt;Implementation&gt;</c> at a graphical body.
    ///
    /// <para><b>The member's <c>LineIds</c> go with it.</b> Those are the ST line-number bookkeeping
    /// TwinCAT keeps per textual body — <c>&lt;LineIds Name="POU.P_G.Get"&gt;</c> — and a graphical body has
    /// none: measured on an IDE-drawn ladder, which carries no <c>LineIds</c> element at all. Leaving them
    /// behind would describe line numbers for a body that no longer has lines.</para>
    ///
    /// <para>The NWL is parsed rather than pasted, so a malformed archive fails HERE — before the POU has
    /// been deleted from the project — rather than inside the import, where the item is already gone.</para></summary>
    private static bool TrySetBody(ref string tcPou, string[] path, string nwlXml, string pouName)
    {
        var doc = ParseVerbatim(tcPou);

        // ORDINAL-IGNORE-CASE, like every other layer that matches a member by name. The `step` values are
        // the PUSHED spellings, taken from the engineer's signature line, and IEC identifiers are
        // case-insensitive in both IDEs — so `METHOD Calc` renamed to `METHOD calc` passes
        // `ReconcileMembers`, `OnlyChanged`, `BodyFormatGuard` and the driver's own `byName` map (all
        // OrdinalIgnoreCase), and an Ordinal compare HERE would refuse it with "'calc' is not in the POU's
        // archive" — false, and it sends the engineer looking inside a vendor file.
        XElement? member = doc.Root;
        foreach (var step in path)
        {
            member = member?.Descendants()
                            .FirstOrDefault(e => e.Name.LocalName is "Method" or "Action" or "Property"
                                                                  or "Get" or "Set"
                                              && string.Equals((string?)e.Attribute("Name"), step,
                                                               StringComparison.OrdinalIgnoreCase));
            if (member is null) return false;
        }

        var impl = member!.Elements().FirstOrDefault(e => e.Name.LocalName == "Implementation");
        if (impl is null) return false;

        impl.ReplaceNodes(XElement.Parse(nwlXml));

        // `<LineIds Name="POU.P_G.Get">` — the POU's own name, then the path AS THE ARCHIVE SPELLS IT.
        //
        // Built from the elements actually walked, not from the pushed `path`: with the case-insensitive
        // match above, a member the engineer relettered would otherwise leave its old `LineIds` behind —
        // line bookkeeping for a body that no longer has lines, keyed to a spelling nothing else uses.
        var pou = doc.Descendants().First(e => e.Name.LocalName == "POU");
        var spelled = new List<string> { ArchivedName(pou, () => $"'{pouName}'") };
        for (var e = member; e != null && e.Name.LocalName != "POU"; e = e.Parent)
            spelled.Insert(1, ArchivedName(e, () => $"'{pouName}'"));
        var key = string.Join(".", spelled);

        foreach (var ids in doc.Descendants()
                               .Where(e => e.Name.LocalName == "LineIds"
                                        && string.Equals((string?)e.Attribute("Name"), key,
                                                         StringComparison.OrdinalIgnoreCase))
                               .ToList())
            ids.Remove();

        tcPou = SaveVerbatim(doc);
        return true;
    }

    /// <summary>Parse a vendor document keeping every character the vendor wrote, so <see cref="SaveVerbatim"/> can
    /// give back the same bytes for every element Volt did not touch.
    ///
    /// <para>The rewrite goes back into the IDE WHOLE: the round trip deletes the POU and imports this document, so
    /// every sibling Volt was not asked to change — a CFC chart, an SFC action, a body Volt does not show — rides
    /// along. "Nothing in the IDE is overwritten" (openspec <c>implementation-keyword</c>) is therefore a claim
    /// about THIS text. A default parse broke it three ways, each measured on vendor output
    /// (<c>TcHiddenBodyWriteTests</c>): it dropped the indentation between elements, the XML reader turned every
    /// CRLF — the vendor's line ending, inside a CDATA declaration too — into LF, and the writer re-spelled what was
    /// left. So: every whitespace node kept, line endings not normalized.</para></summary>
    private static XDocument ParseVerbatim(string text)
    {
        using var reader = new XmlTextReader(new StringReader(text))
        {
            Normalization = false,                       // keep CRLF as CRLF, in text, CDATA and attributes
            WhitespaceHandling = WhitespaceHandling.All,
            DtdProcessing = DtdProcessing.Prohibit,
        };
        return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
    }

    /// <summary>Serialize WITH the XML declaration, AS UTF-8, WITHOUT re-indenting and WITHOUT touching a line
    /// ending — the counterpart of <see cref="ParseVerbatim"/>.
    ///
    /// <para>A plain StringWriter declares <c>encoding="utf-16"</c> over UTF-8 bytes, which a reader refuses
    /// ("There is no Unicode byte order mark. Cannot switch to Unicode") — and <c>RoundTrip</c> DELETES the item
    /// before importing this text, so for that window it is the ONLY copy, and the undo re-imports the same bytes.</para></summary>
    private static string SaveVerbatim(XDocument doc)
    {
        var sw = new Utf8StringWriter();
        using (var w = XmlWriter.Create(sw, new XmlWriterSettings
               {
                   Indent = false,
                   NewLineHandling = NewLineHandling.None,
               }))
            doc.Save(w);
        return sw.ToString();
    }

    /// <summary>A StringWriter that says UTF-8, because <see cref="XDocument.Save(System.IO.TextWriter)"/>
    /// writes whatever encoding its writer declares - and a plain StringWriter declares UTF-16 while the caller
    /// then writes UTF-8 bytes.</summary>
    private sealed class Utf8StringWriter : System.IO.StringWriter
    {
        public override System.Text.Encoding Encoding => new System.Text.UTF8Encoding(false);
    }

    /// <summary>The archive entries that are vendor SOURCE documents — a POU, an interface, a DUT or a GVL.
    /// Everything else in the zip (project metadata, the manifest) is copied through untouched.</summary>
    private static bool IsPlcSource(string entryName) =>
        entryName.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase)
        || entryName.EndsWith(".TcIO", StringComparison.OrdinalIgnoreCase)
        || entryName.EndsWith(".TcDUT", StringComparison.OrdinalIgnoreCase)
        || entryName.EndsWith(".TcGVL", StringComparison.OrdinalIgnoreCase);

    private static bool TryPlace(ref string tcPou, string memberName, string folderPath)
    {
        var doc = ParseVerbatim(tcPou);
        var member = doc.Descendants().FirstOrDefault(e =>
            e.Name.LocalName is "Method" or "Action" or "Property"
            && (string?)e.Attribute("Name") == memberName);
        if (member is null) return false;

        if (string.IsNullOrEmpty(folderPath))
        {
            member.Attribute("FolderPath")?.Remove();   // back to the POU root
        }
        else
        {
            var segments = folderPath.Split(Separators, StringSplitOptions.RemoveEmptyEntries);
            EnsureFolders(member.Parent!, segments);
            // The TRAILING separator is TwinCAT's own spelling, not decoration — this file is read by the IDE.
            member.SetAttributeValue("FolderPath", string.Join(Sep, segments) + Sep);
        }

        tcPou = SaveVerbatim(doc);
        return true;
    }

    /// <summary>Ensure the nested <c>&lt;Folder Name="x" Id="{guid}"&gt;</c> chain exists under the POU. Folders
    /// nest by ELEMENT, one path segment each — not by writing a whole path into one Name.</summary>
    private static void EnsureFolders(XElement pou, string[] segments)
    {
        var node = pou;
        foreach (var segment in segments)
        {
            var next = node.Elements().FirstOrDefault(e =>
                e.Name.LocalName == "Folder" && (string?)e.Attribute("Name") == segment);
            if (next is null)
            {
                next = new XElement(pou.Name.Namespace + "Folder",
                    new XAttribute("Name", segment),
                    new XAttribute("Id", "{" + Guid.NewGuid() + "}"));
                node.Add(next);
            }
            node = next;
        }
    }

    // TwinCAT spells the member folder separator as a backslash, with a trailing one.
    private const string Sep = "\\";
    private static readonly char[] Separators = { '/', '\\' };

    // TwinCAT writes the separator as '\', .NET's zip API normalizes to '/' on read — handle both.
    private static string Leaf(string entryPath) =>
        entryPath.Substring(entryPath.LastIndexOfAny(new[] { '/', '\\' }) + 1);
}
