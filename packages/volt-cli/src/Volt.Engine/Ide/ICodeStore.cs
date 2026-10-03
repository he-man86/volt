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
/// back. What the ENGINE owns is unchanged and is Volt's own: the canonical <c>.pou</c> layout, network text,
/// the model, and sync. <c>BodyLanguage</c> is gone from the contract because the language now arrives INSIDE
/// the content — a second round-trip to ask "what language is this" was the transport leaking upward.</para>
/// </summary>
public interface ICodeStore
{
    /// <summary>Everything about one item: kind, declaration, body language, body, and members with theirs.
    /// A body is workspace TEXT — ST verbatim, a graphical body as network text, a body Volt cannot write as its
    /// read-only <c>IMPLEMENTATION</c> line (with the reason on <c>Unsupported</c> for an LD/FBD one) — because that is
    /// what the workspace stores and what the ST layer round-trips.</summary>
    ItemContent ReadContent(ItemRef item);

    /// <summary>Apply content to an item, in place. The driver decides how much of it actually changes: a
    /// write must not disturb what the engineer did not edit, which on CODESYS means mutating the live objects
    /// and on TwinCAT means rewriting only the networks that differ.
    /// <para>A <c>null</c> body means the item HAS no body and none must be written; an EMPTY body means clear
    /// it. That distinction is load-bearing and was paid for once already — TwinCAT skipped empty
    /// implementations, so emptying a body silently kept the old code.</para>
    ///
    /// <para><b>A network-text body arrives as its MODEL</b> (<paramref name="bodies"/>, openspec <c>bridge-refusal-review</c>
    /// D8/D12): every network body of the pushed item, validated ONCE by the push pre-flight
    /// (<see cref="SourceScopes.Validated"/>), with the scope it was read against and where it sits. At each network body
    /// it writes, the driver takes that site's model and scope (<see cref="PushedNetworkBody.At"/>) — it holds no copy of
    /// the validation and parses no body text. The scope is what carried the push's own declarations to the write
    /// (<see cref="NetworkScopeFor"/>: a graphical box can call through a name this item does not declare, and every
    /// other item of the push answers before the IDE does, so the answer does not depend on op order); it travels with
    /// its model now, so this call takes no declarations of its own. A network body with no entry is Volt's bug, refused
    /// loud by the lookup.</para></summary>
    void WriteContent(ItemRef item, ItemContent content, IReadOnlyList<PushedNetworkBody> bodies);

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
    /// <para>CODESYS only. Every field is a live setter there (`probe-task-writable.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-writable.py`)); TwinCAT
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
    /// host, which has no such thing.)</para>
    ///
    /// <para><b>It is handed MODELS, never text</b> (openspec <c>bridge-refusal-review</c> 2.27, D8/D12): every
    /// network-text body of the pushed item the engine's pre-flight has already validated against its own scope, with
    /// where it sits. The TwinCAT override used to re-read the whole source with <c>StReader</c>, re-derive the kind from
    /// the wire name and validate every body a second time — a second reader the first could disagree with.</para>
    ///
    /// <para><paramref name="existing"/> is the item the op writes into, or null when the push CREATES it. Whether a
    /// body is created or edited is decided per BODY by the write (a new member in an existing item is a create), so
    /// the driver is asked on an update too and answers for each body as its write would (openspec
    /// <c>bridge-refusal-review</c> 2.28, D21).</para></summary>
    void ValidateSource(ItemRef? existing, IReadOnlyList<PushedNetworkBody> bodies);

    /// <summary>Why the IDE refuses <paramref name="name"/> for a NEW object of <paramref name="kind"/> (an
    /// <see cref="ItemKind.Kinds"/> value: a POU, or a METHOD / ACTION / PROPERTY / interface METHOD / interface
    /// PROPERTY) — or null when the driver has no measured refusal of it. Asked by the push PRE-FLIGHT for every name a
    /// set op would create, so a refusal the vendor decides from the name alone lands before the first write instead of
    /// after the batch's earlier ops (openspec <c>push-keeps-what-landed</c> 3.1).
    ///
    /// <para>The refusals are the VENDOR's, and each driver answers only what its IDE was MEASURED to refuse, for the
    /// kinds it was measured on: reserved WORDS — case-insensitively (measured), whatever the POU / METHOD / ACTION /
    /// PROPERTY (measured: the verdict is the word's; on an interface member only the words asked there), and whatever the project
    /// (measured: a name colliding with a variable or another POU is accepted) — and name SHAPES that are no identifier,
    /// for all six kinds (openspec <c>bridge-refusal-review</c> 3.1; they were the reader's unmeasured INVALID_ST). A name
    /// nobody asked is not guessed at: it reaches the IDE, whose apply-time refusal the push reports as what it is.</para></summary>
    string? RefusedName(string kind, string name);

    /// <summary>Why the IDE cannot CREATE a member of <paramref name="memberKind"/> named <paramref name="name"/> with the
    /// create argument <paramref name="seed"/> (<c>PushService.CreateSeed</c>: an interface member's declared type, any
    /// other member's body language) — or null when the driver creates it. Asked by the push PRE-FLIGHT for every member
    /// the push would create, so a create the vendor refuses from its argument alone lands before the first write, as
    /// <see cref="RefusedName"/> does for a word (bridge-refusal-review 2.4/2.6: TwinCAT creates an interface member with
    /// its type as the create argument and cannot create one that states none). The driver's own <c>CreateChild</c>
    /// refuses the same create by the same predicate, so the two never disagree.</summary>
    string? RefusedMemberCreate(string memberKind, string name, string? seed);

    /// <summary>Refuse — by throwing the refusal the write would answer — an INTERFACE property's GET/SET this vendor
    /// cannot write, or do nothing. Asked by the push PRE-FLIGHT for every accessor of every interface property the text
    /// carries, so the refusal lands before the batch's first write instead of after the earlier ops (and the item's own
    /// interface and property declarations) had landed (review of bridge-refusal-review 3a+3b). Decided from the pushed
    /// accessor alone: CODESYS refuses a BODY, which its accessor has no slot for (DIALECT D41); TwinCAT refuses any
    /// declaration or body, which its live accessor never holds (D21). The driver's own write refuses by the same call,
    /// so the two never disagree.</summary>
    void ValidateInterfaceAccessor(Accessor pushed);

    /// <summary>Refuse — by throwing the refusal, with the code the write would answer — a task whose SETTINGS this
    /// vendor cannot hold, or do nothing. Asked by the push PRE-FLIGHT for every `.task` set op, with the settings the
    /// engine's own gate read (<c>TaskDescriptorFormat.Gate</c>), so a refusal the vendor decides from the settings
    /// alone lands before the batch's first write instead of after its earlier ops (openspec
    /// <c>bridge-refusal-review</c>, review of 2e+2g: CODESYS's unknown `Type:` and TwinCAT's non-cyclic task were found
    /// only by the write). The driver's own write refuses the same settings by the same check, so the two never
    /// disagree.</summary>
    void ValidateTask(TaskSettings settings);

    /// <summary>Why the IDE cannot change an EXISTING body's language in place — from <paramref name="from"/> to
    /// <paramref name="to"/>, ST ⇄ LD/FBD — at a body of <paramref name="site"/>: the item's own body (its kind,
    /// <c>pou</c>), a member's (<c>method</c>, <c>action</c>), or a property accessor's (<c>property_get</c> /
    /// <c>property_set</c>) — or null when the driver writes the change. ONE comparison decides that a body changes
    /// language (<c>BodyFormatGuard</c>, openspec <c>bridge-refusal-review</c> D7); the vendor answers whether it can write
    /// it, and the driver's own write asks the same predicate, so the two cannot disagree. Measured (DIALECT N24): CODESYS
    /// swaps a POU's body aspect in place; TwinCAT has no in-place route. A site no measurement covered is refused by
    /// name, never guessed writable.</summary>
    string? RefusedLanguageChange(string site, string from, string to);

    /// <summary>The scope a graphical body resolves against: its own declarations (<paramref name="declaration"/>,
    /// innermost first — <see cref="SourceScopes.Scope"/>), the project's other items and its globals, the push's
    /// own declarations answering before the IDE's. The SAME scope the driver writes a pulled body against, so the
    /// engine's pre-flight reads a body exactly as the driver will (network text v2, task 3.9) — a pre-flight
    /// with a smaller scope would refuse an undeclared-looking wire the write accepts.</summary>
    Volt.Engine.Format.Network.NetworkScope NetworkScopeFor(string? declaration,
                                                            PushedDeclarations pushedDeclarations);
}
