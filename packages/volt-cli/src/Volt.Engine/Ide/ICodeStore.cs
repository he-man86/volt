using System.Collections.Generic;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// How code moves in and out of an IDE. <b>The whole surface is Volt's own vocabulary</b> — an
/// <see cref="ItemContent"/> in, an <see cref="ItemContent"/> out — and the engine never learns which
/// transport produced it. Every method throws on real IDE failure; there is no silent fallback.
///
/// <para><b>This interface used to demand a PLCopen document</b>:</para>
/// <code>
/// string ReadXml(ItemRef item);              // "export this POU as PLCopen XML"
/// void   WriteXml(ItemRef item, string xml);
/// string? BodyLanguage(ItemRef item);
/// </code>
/// <para>which made a vendor's file format part of the vendor-neutral contract. Three consequences, all of
/// them real rather than theoretical:</para>
/// <list type="bullet">
/// <item>An IDE with no PLCopen export <b>could not implement the contract at all</b>. TIA Portal is the
/// concrete case: Openness has its own representation and no PLCopen, so a Siemens driver was impossible for
/// a reason that had nothing to do with Siemens.</item>
/// <item>TwinCAT could not adopt its own better transport, because the engine would not accept it — which is
/// how PLCopen's seven checklist failures on TwinCAT became Volt's failures.</item>
/// <item>CODESYS could not hand over the typed objects it actually has, and had to serialize a document
/// instead.</item>
/// </list>
///
/// <para><b>What a driver now owns</b> is everything between its IDE and <see cref="ItemContent"/>: reading a
/// declaration, deciding a body's language, rendering a graphical body to network text, and putting all of it
/// back. What the ENGINE owns is unchanged and is Volt's own: the canonical <c>.fb</c> layout, network text,
/// the model, and sync. <c>BodyLanguage</c> is gone from the contract because the language now arrives INSIDE
/// the content — a second round-trip to ask "what language is this" was the transport leaking upward.</para>
/// </summary>
public interface ICodeStore
{
    /// <summary>Everything about one item: kind, declaration, body language, body, and members with theirs.
    /// A body is workspace TEXT — ST verbatim, a graphical body as network text, an unsupported language as
    /// its marker — because that is what the workspace stores and what the ST layer round-trips.</summary>
    ItemContent ReadContent(ItemRef item);

    /// <summary>Apply content to an item, in place. The driver decides how much of it actually changes: a
    /// write must not disturb what the engineer did not edit, which on CODESYS means mutating the live objects
    /// and on TwinCAT means rewriting only the networks that differ.
    /// <para>A <c>null</c> body means the item HAS no body and none must be written; an EMPTY body means clear
    /// it. That distinction is load-bearing and was paid for once already — TwinCAT skipped empty
    /// implementations, so emptying a body silently kept the old code.</para>
    ///
    /// <para><paramref name="pushedDeclarations"/> is EVERY OTHER ITEM'S declaration arriving in the same push,
    /// by bare name. A graphical box can call through a name this item does not declare — a qualified path
    /// (`Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives`) walks a GVL, then a struct, to reach the timer — and the
    /// driver has to know the TYPE to write into the box. Asking the IDE alone answers only for items that are
    /// ALREADY there, which on a push that creates a whole project depends on op order: pushing Lenze's
    /// MID-S100 into an empty project failed on `Mach1_Drives` because the struct it walks through was two
    /// hundred ops away. The push is also the newer truth for an item it is updating, so it is consulted FIRST
    /// and the IDE answers for everything the push does not carry.</para></summary>
    void WriteContent(ItemRef item, ItemContent content, IReadOnlyDictionary<string, string> pushedDeclarations);

    /// <summary>The item's MANIFEST: a canonical text body for a NON-SOURCE item (library ref, task, device,
    /// project info, trace, recipe, symbol config) — the vendor's metadata rendered as deterministic text. It is
    /// wire-observable twice over: <c>Materializer</c> writes it verbatim as the item's workspace file, and
    /// <c>Hasher</c> takes the item's content version from it. So it is PARITY-CRITICAL — the same project must
    /// yield byte-identical manifests on both vendors (see <c>Library/LibraryManifest</c>, the shared renderer
    /// for <c>.library</c> refs). An item whose vendor exposes no metadata for this kind yields the canonical
    /// kind-stamped body <c>ItemKind.EmptyManifest(kind)</c> — never null, never empty, so the version basis
    /// stays stable. Throws on real IDE failure; there is no silent fallback.</summary>
    string ReadManifest(ItemRef item, string kind);

    /// <summary>Write a TASK's settings back — the one descriptor kind that is not read-only.
    ///
    /// <para>Typed rather than textual, unlike the textual manifests it sits beside: the `.task`
    /// FORMAT is shared (<c>Volt.Engine.Format.Task.TaskDescriptorFormat</c>) and is parsed and GATED once in
    /// the engine, so a driver receives data it cannot misread and never re-implements the file layout. That
    /// is the same seam <c>ICodeStore</c> keeps everywhere else — the engine owns the representation, the
    /// driver owns the vendor call.</para>
    ///
    /// <para>CODESYS only. Every field is a live setter there (`scripts/probe-task-writable.py`); TwinCAT
    /// renders a different `.task` shape entirely and REFUSES rather than guess at one nobody has
    /// measured.</para></summary>
    void WriteTask(ItemRef task, TaskSettings settings);

    /// <summary>Throw exactly what <see cref="WriteContent"/> would throw, for the reasons this driver can
    /// decide WITHOUT touching the IDE. Called by the push PRE-FLIGHT, before any op has been applied.
    ///
    /// <para><b>Why the engine cannot do this itself.</b> Its own pre-flight covers everything decidable from
    /// the source text alone — a malformed document, network text that does not parse or is not canonical — and
    /// that is vendor-neutral by construction. What it cannot cover is a shape one VENDOR cannot express:
    /// TwinCAT's PLCopen writer refuses an unconditional jump or return, an Execute box, and a box output pin
    /// wired straight to a variable, and it refuses them from a pure function of the parsed body. Being pure is
    /// the whole point — it was being called from inside the write, so a push whose second item carried one left
    /// the first item in the project and told the caller it had failed.</para>
    ///
    /// <para><see cref="DriverBase"/> refuses nothing, which is the honest answer for a driver whose refusals
    /// genuinely need the live objects: a pre-flight that guesses is worse than one that declines to. (It lives
    /// there rather than as a default interface member because this engine still targets net48 for the CODESYS
    /// host, which has no such thing.)</para></summary>
    void ValidateSource(string wireName, string sourceText,
                        IReadOnlyDictionary<string, string> pushedDeclarations);
}
