using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Engine.Seam;

/// <summary>
/// THE contract a vendor host implements (openspec <c>volt-cli-rework</c>, design "New Ide/ contract"): session + tree +
/// store, in vendor-neutral words only. Kinds are strings its <see cref="IVendorSession.Declaration"/> registers, bodies
/// are keyed by language, object properties are declared keys, and nothing here is a number or a CODESYS-family model.
/// Written beside the old <c>Ide/</c> contract; the Engine moves onto it in step 5.
/// </summary>
public interface IVendorDriver : IVendorSession, IVendorTree, IVendorStore
{
}

/// <summary>The IDE connection: attach state, identity, threading, build — PRIMITIVES only. What is the same for every
/// vendor is the engine's, composed over these (<c>Sync/ComposedSession</c>): the degraded-state machine, the busy/freshness
/// bracketing around <see cref="MarshalToIdeThread{T}"/>, the single-flight health probe and the whole
/// <see cref="HealthResponse"/>. A host supplies the rows; it never builds a response.</summary>
public interface IVendorSession
{
    /// <summary>Everything this host states about itself: its vendor row, kinds, languages and property keys.</summary>
    VendorDeclaration Declaration { get; }

    bool IsConnected { get; }
    string Vendor { get; }
    string? ServedProjectName { get; }
    string? IdeVersion { get; }
    string? ProductName { get; }
    string? ProductVersion { get; }
    string? ProductVendor { get; }
    string? Unsupported { get; }
    string? NotServedBecause { get; }
    void Disconnect();

    /// <summary>Should this exception flip the session to degraded (a dead cross-process channel)?</summary>
    bool ShouldMarkDegraded(Exception ex);

    /// <summary>Re-establish the live binding after a transient failure (a no-op in-proc). Must not throw.</summary>
    void Recover();

    /// <summary>Run a unit of IDE work on the thread the vendor requires. Called only through the engine's bracketing.</summary>
    T MarshalToIdeThread<T>(Func<T> fn);

    /// <summary>The connectable project rows and the binding's liveness, read on the IDE thread — by the ambient health
    /// probe and right after a connect or a select. Never throws for an IDE that stopped answering: that is
    /// <see cref="ProjectProbe.NotAnswering"/>, so the rows are still published (a request-path refresh must not fail).</summary>
    ProjectProbe ProbeProjects();

    /// <summary>The floor on ambient probing for this vendor, in ms: what one row snapshot costs it.</summary>
    long HealthProbeFloorMs { get; }

    void SelectProject(ConnectRequest sel);

    /// <summary>Compile the given application roots (as <see cref="HostWalk.Applications"/> states them), or all.</summary>
    bool Build(IReadOnlyCollection<string>? applications);

    /// <summary>The last build's diagnostics as fresh objects, each named by the BARE name the vendor gave; the engine
    /// promotes them to paths through <paramref name="walk"/>.</summary>
    IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<HostWalk> walk);

    /// <summary>Every referenced library element's signature; a vendor with no library manager answers none.</summary>
    IReadOnlyList<Library.LibSignature> ExtractLibrarySignatures();
}

/// <summary>One health probe's answer. <see cref="Bound"/>: the served binding is live (the engine clears a degraded
/// session). <see cref="NotAnswering"/>: why a cross-process IDE did not answer, or null — the ambient probe then fails
/// with <c>PLC_DISCONNECTED</c> after the rows are published.</summary>
public sealed record ProjectProbe(IReadOnlyList<ProjectEntry> Rows, bool Bound, string? NotAnswering = null);

/// <summary>What a node of the vendor's tree IS to the engine.</summary>
public enum NodeRole
{
    /// <summary>A user folder: a path segment Volt creates, renames and deletes.</summary>
    Folder,
    /// <summary>A structural node (a device, an application, a PLC project): a path segment Volt descends by name and
    /// never creates.</summary>
    Container,
    /// <summary>A tracked item of <see cref="NodeClass.Kind"/>: a file.</summary>
    Item,
    /// <summary>A member of the item above it, of <see cref="NodeClass.Kind"/>.</summary>
    Member,
    /// <summary>Neither: transient or hidden; the walk passes it by.</summary>
    Skip,
}

/// <summary>A node, classified by its host. <see cref="HoldsItems"/>: an item may be created in or moved into it (always
/// true for a folder). <see cref="Takes"/>: the item kinds a DEDICATED container holds whatever its (localized) name —
/// a new item of such a kind goes into it when its folder's last segment is missing. <see cref="Noun"/>: what the IDE calls a
/// node that is no folder ("device node"), for a refusal that names it; null where the role says it.</summary>
public sealed record NodeClass(NodeRole Role, string? Kind = null, bool HoldsItems = false, IReadOnlyList<string>? Takes = null,
                               string? Noun = null)
{
    public static readonly NodeClass Folder = new(NodeRole.Folder, HoldsItems: true);
    public static readonly NodeClass Skip = new(NodeRole.Skip);
    public static NodeClass Item(string kind) => new(NodeRole.Item, kind);
    public static NodeClass Member(string kind) => new(NodeRole.Member, kind);
    public static NodeClass Container(bool holdsItems, params string[] takes) =>
        new(NodeRole.Container, null, holdsItems, takes.Length == 0 ? null : takes);

    /// <summary>Equal when every field is, the kinds a container takes by their values.</summary>
    public bool Equals(NodeClass? other) =>
        other is not null && Role == other.Role && Kind == other.Kind && HoldsItems == other.HoldsItems && Noun == other.Noun
        && (Takes ?? Array.Empty<string>()).SequenceEqual(other.Takes ?? Array.Empty<string>());

    public override int GetHashCode() => ((int)Role * 397) ^ (Kind?.GetHashCode() ?? 0) ^ (HoldsItems ? 1 : 0);
}

/// <summary>One item a walk found: its BARE name, its handle, its kind (a registered string) and its folder path.</summary>
public sealed record WalkedItem(string Name, ItemRef Item, string Kind, string Folder);

/// <summary>What a walk found, and whether it saw everything (<see cref="WalkResult"/>'s rules, with kinds as strings).</summary>
public sealed record HostWalk(
    IReadOnlyList<WalkedItem> Items,
    IReadOnlyList<string> UnwalkedFolders,
    IReadOnlyList<UnreadableObject> Unreadable,
    IReadOnlyList<string> Applications);

/// <summary>The one value a vendor may need at a create, named for what it is: the body <see cref="Language"/> of an
/// item or member with a body, the declared type (<see cref="Signature"/>) of a signature member, the vendor
/// <see cref="Class"/> the text states.</summary>
public sealed record CreateArgs(string? Language = null, string? Signature = null, string? Class = null)
{
    public static readonly CreateArgs None = new();
}

/// <summary>Navigate and shape the project tree. Pure structure; throws on real IDE failure, never a silent fallback.</summary>
public interface IVendorTree
{
    HostWalk Walk(WalkObserver? observer = null);

    /// <summary>The node every walked folder path is measured from.</summary>
    ItemRef Root { get; }

    /// <summary>The children of a node, in the IDE's order. A host answers them however its IDE allows; a child it must
    /// not open is named by throwing <see cref="UnreadableItemException"/> from <see cref="Classify"/>.</summary>
    IReadOnlyList<ItemRef> Children(ItemRef node);

    ItemRef Parent(ItemRef node);
    string Name(ItemRef node);
    NodeClass Classify(ItemRef node);

    /// <summary>Does a handle into an item survive creating or deleting one of its children?</summary>
    bool HandlesSurviveStructureChange { get; }

    ItemRef CreateFolder(ItemRef parent, string name);

    /// <summary>Create an item or a member of <paramref name="kind"/> (a registered kind). A create the IDE refuses is a
    /// <see cref="ChildRefusedException"/>, never a plain object reported created.</summary>
    ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args);

    void Delete(ItemRef parent, string name);
    void Rename(ItemRef node, string newName);
    void Move(ItemRef node, ItemRef target);
}

/// <summary>A body of a pushed item, read once by its language's <see cref="IBodyReader"/>: where it sits, its language,
/// and the model the reader made (the code itself for a plain-text language).</summary>
public sealed record PushedBody(BodySite Site, string Language, object Model);

/// <summary>Content in and out, manifests, the one writable descriptor, and the vendor's pre-flight refusals.</summary>
public interface IVendorStore
{
    Content Read(ItemRef item);

    /// <summary>Apply content in place. A null body: the item has none; an empty shown body: clear it; a hidden body:
    /// leave the IDE's alone. Each shown body arrives with its model in <paramref name="bodies"/>.</summary>
    void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies);

    /// <summary>A descriptor's canonical text; never null or empty.</summary>
    string ReadManifest(ItemRef item, string kind);

    void WriteTask(ItemRef task, TaskSettings settings);
    void ValidateTask(TaskSettings settings);

    // ── the pre-flight: each answers from the pushed text alone, before the batch's first write ──
    void ValidateSource(ItemRef? existing, IReadOnlyList<PushedBody> bodies);
    string? RefusedName(string kind, string name);
    string? RefusedMemberCreate(string memberKind, string name, CreateArgs args);
    void ValidateAccessor(string memberKind, ContentAccessor pushed);
    void ValidateProperties(string what, PropertySet pushed, bool create);
    string? RefusedLanguageChange(string site, string from, string to);
}

/// <summary>The pre-flight defaults: refuse nothing (a host without a measurement does not guess). The engine targets
/// net48 for one host, so these are a base class, not default interface members. <see cref="RefusedLanguageChange"/> has
/// no default: each host states its measured answer.</summary>
public abstract class VendorDriverBase
{
    public virtual void ValidateSource(ItemRef? existing, IReadOnlyList<PushedBody> bodies) { }
    public virtual string? RefusedName(string kind, string name) => null;
    public virtual string? RefusedMemberCreate(string memberKind, string name, CreateArgs args) => null;
    public virtual void ValidateAccessor(string memberKind, ContentAccessor pushed) { }
    public virtual void ValidateProperties(string what, PropertySet pushed, bool create) { }
    public virtual void ValidateTask(TaskSettings settings) { }
    public abstract string? RefusedLanguageChange(string site, string from, string to);
}
