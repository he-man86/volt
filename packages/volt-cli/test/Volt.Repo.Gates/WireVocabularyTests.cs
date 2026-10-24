using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// ONE SITUATION PER CODE, EVERY CODE RAISED AND DOCUMENTED (openspec <c>bridge-refusal-review</c> V.4).
///
/// <para>A client reacts to a refusal by its CODE, so a code is only worth its name if it means one situation and the
/// remedy that goes with it. Three codes had drifted onto several: <c>BAD_REQUEST</c> (a request shape, and a stale item
/// version), <c>INTERNAL_ERROR</c> (Volt's own invariant, and IDE states — a refused child read, a refused save, a broken
/// post-condition), <c>UNSUPPORTED</c> (a vendor limit, and Volt's own wire rules); and <c>NO_SIDECAR</c> named a cache no
/// client sees. This gate holds the vocabulary to its meaning.</para>
///
/// <para><b>The census.</b> Every reference to a code constant (<c>BridgeErrorCodes.X</c> / <c>ConflictCodes.X</c>) in
/// the toolchain's code — comments stripped, <c>Volt.Contracts</c> (the definitions) and <c>Volt.Cli</c> (the client,
/// which MATCHES codes) excluded — is a raise site, counted per file. Each <see cref="Situation"/> below names one
/// situation, its remedy and the ONE code it is answered with, and lists the files that raise it with their exact count.
/// So: a new raise site fails until someone classifies it under a situation; a code classified under a second situation
/// fails (one situation per code — re-code the site instead); a code no situation raises fails (dead vocabulary); and
/// every code must have its row — <c>docs/wire.html</c> for the frame and gate codes, <c>docs/network-text.html</c> for
/// <c>NETWORK_*</c>. Rejected: a hand-written review list (drifts) and inferring the situation from the message text
/// (the content scan D9 removed).</para>
/// </summary>
public class WireVocabularyTests
{
    /// <summary>One situation: what happened, what the client does about it, the code it is answered with, and every
    /// file that raises it with its exact count of references.</summary>
    private sealed record Situation(string Name, string Means, string Code, Dictionary<string, int> Sites);

    private static Dictionary<string, int> At(params (string File, int Count)[] sites) =>
        sites.ToDictionary(s => s.File, s => s.Count, StringComparer.Ordinal);

    private static readonly Situation[] Situations =
    {
        // ── the frame codes ────────────────────────────────────────────────────────────────────────────────────
        new("no IDE project is served", "no project bound, or the bridge paused: send connect", "PLC_DISCONNECTED", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1),
            ("Volt.Engine/Sync/ComposedSession.cs", 1),   // the ambient probe of a host whose IDE did not answer (volt-cli-rework step 6: it was BeckhoffDriver's TriggerAsyncProbe)
            ("Volt.Engine/BridgeException.cs", 2),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Build.cs", 1),   // -1 the save Volt no longer makes (D45)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1))),   // a delete with no IDE attached, before its member documents are closed (D45)
        new("another project is served", "the bound project is not the one named: rebind, never merge", "WRONG_PROJECT", At(
            ("Volt.Engine/BridgeException.cs", 1))),
        new("the IDE process lacks what the bridge needs (a capability, so it serves nothing; or the type, member or overload one call needs — wire-final-shape 3c), or Volt's assemblies loaded twice, or this worker cannot unmarshal its Solution Explorer",
            "the IDE has to change (upgraded, or restarted), not the call",
            "IDE_UNSUPPORTED", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1),
            ("Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs", 2),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Build.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Classes.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 3),   // wire-final-shape 3c: coded at the throw; -1 a node without a facet is that node's, UNSUPPORTED (3c review 8)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 6),   // wire-final-shape 3c: coded at the throw; -1 no usable move is a binder failure (SurfaceMismatchException, 3c review 4)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Reflection.cs", 1),   // wire-final-shape 3c: coded at the throw; -1 InvokeMethod's missing method is a binder failure (SurfaceMismatchException)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Scripting.cs", 5),   // wire-final-shape 3c: coded at the throw; -2 the overload searches are binder failures (SurfaceMismatchException)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 4),   // wire-final-shape 3c: coded at the throw; -1 no get_name at all is a binder failure (SurfaceMismatchException)
            ("Volt.Ide.Codesys/Ide/NwlInterop.cs", 3),   // wire-final-shape 3c: coded at the throw; -1 Call catches the binder failure by its type
            ("Volt.Ide.Codesys/Ide/SurfaceMismatchException.cs", 1))),   // the binder failures (Reflection.Overload, InvokeMethod, the overload searches, move): fail a walk (3c review 4)
        new("another push or build holds the IDE", "wait for it to answer, then try once: nothing was applied",
            "IDE_BUSY", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 1))),
        new("the request states no protocol, or another than the bridge's", "update the older of client and bridge",
            "PROTOCOL_MISMATCH", At(
            ("Volt.Wire/PipeServer.cs", 1))),   // wire-final-shape §1: refused before the body is read
        new("the request breaks the wire's own rules", "change the REQUEST", "BAD_REQUEST", At(
            ("Volt.Engine.Host/BridgePipeHost.cs", 2),
            ("Volt.Engine/Format/Task/TaskDescriptorFormat.cs", 1),
            ("Volt.Engine/Seam/KindRegistry.cs", 2),   // the new contract (volt-cli-rework step 3): an extension no host registered, a wire name with no extension
            ("Volt.Engine/Sync/BuildService.cs", 2),   // build-selects-application: an `applications` root the project does not hold, an empty list
            ("Volt.Engine/Sync/FetchService.cs", 1),
            ("Volt.Engine/Sync/GrepService.cs", 4),   // grep-item-sources: a limit out of range, an empty pattern, one that does not compile, one that times out on a line
            ("Volt.Engine/Sync/OpGuard.cs", 1),   // push-requires-project-identity: a write without its project's identity
            ("Volt.Engine/Sync/PushService.cs", 10),   // +1 a sourceText that starts with U+FEFF (wire-final-shape 4.3b); +1 a set's `to` of another kind (volt-cli-rework 2.4); `ops: null` is the strict body read's (WireJson.Request, volt-cli-rework 2.4), no longer PushService's; +1 a move into another application; +1 a task moved out of its container (multi-application-tree); -2 the base-type op dispatch: PushOp is abstract, an op with no discriminator is refused by the strict body read (refuse-unknown-request-members)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 1),
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 2),   // bridge-one-to-one §3: a TwinCAT member label, a bare `Watchdog: off`
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Nodes.cs", 1),   // a write into the solution's own structure, above a PLC project (multi-application-tree)
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 4),
            ("Volt.Relay/RelayTunnel.cs", 1),
            ("Volt.Wire/PipeServer.cs", 3))),   // +1 a request frame that is JSON null, no envelope (wire-final-shape 4.1); +1 a request frame over MaxFrameBytes (volt-cli-rework 1.0 bug b)
        new("the IDE, or a documented Volt limit on a vendor shape, will not take it", "change the TEXT, or do it in the IDE",
            "UNSUPPORTED", At(
            ("Volt.Engine/Format/Body/BodyFormatGuard.cs", 12),
            ("Volt.Engine/Ide/ExcludedFolder.cs", 2),   // wire-final-shape §4: an unreadable entry's code — an excluded folder, and each item under it
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Tree.cs", 3),   // wire-final-shape §4: an unreadable entry's code — a container holding what no text spells, the library manager's unspelled content  // abstract-member-parity: the NONE/ABSTRACT refusals as named builders (NONE off a member site, NONE without ABSTRACT, ABSTRACT dropped over NONE, statements under ABSTRACT) + a body over NONE at an item site, over a slotless concrete member, and a comment over NONE
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/St/FamilyContent.cs", 1),   // volt-cli-rework step 5: a %-key the IEC layout's object record has no field for
            ("Volt.Engine/Format/St/IecFormat.cs", 4),   // moved from Materializer (volt-cli-rework step 5): what a pull must not write
            ("Volt.Engine/Format/St/ImplementationMarker.cs", 3),
            ("Volt.Engine/Format/St/StReader.cs", 3),
            ("Volt.Engine/Format/St/PropertyLines.cs", 1),   // gate review of step 3, finding 8: a %NETVAR value the line cannot carry
            ("Volt.Engine/Format/St/StWriter.cs", 3),
            ("Volt.Engine/Ide/InterfaceAccessorGuard.cs", 2),
            ("Volt.Engine/Ide/MemberSites.cs", 1),   // bridge-one-to-one §3: a transition, refused by name
            ("Volt.Engine/Item/ItemKind.cs", 1),
            ("Volt.Engine/Library/LibraryFetch.cs", 1),
            ("Volt.Engine/Sync/GrepService.cs", 1),   // wire-final-shape 3.7: a notSearched entry's code — a body that reads IMPLEMENTATION <LANG> UNSUPPORTED
            ("Volt.Engine/Sync/PushService.cs", 9),
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 4),   // +1: a body site whose type declares no Implementation (abstract-member-push); +1 a create carrying %NETVAR / %PARAMETER_LIST (gate review of step 3, 7c); +1 a create of %CLASS PERSISTENT / NVL (second review of step 3, finding 5)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs", 3),   // +1 a device member that is not there (gate review of step 3, 10); +1 a node without the facet a read or create needs (3c review 8)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 4),   // +1 a reference answering no namespace, no name and no placeholder name has no identity: the manager is refused (volt-cli-rework 3.1b)   // -1 a reference flag off its measured value (every flag is a manifest line now, C37b)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 13),   // bridge-one-to-one §3: a property the bridge cannot read or write, by name; +2 a measured constant off its value, a %NETVAR value the line cannot carry (gate review of step 3, 2 / 8); +2 an archive member absent where it is no version fact, and one read where the platform lacks it with no measured meaning for its absence (environment-dependency-audit 2.0, DIALECT V7) — the item refused by name, as the rest
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 11),   // +2 a task member or a call stored with surrounding blanks (gate review of step 3, 8); +1 a task facet with no call list (volt-cli-rework 3.1, C5)
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 4),
            ("Volt.Ide.Codesys/Ide/CodesysTypeMap.cs", 1),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 11),   // +1 a member's %EXCLUDE_FROM_BUILD inside a POU that carries it too (C39); +1 an interface accessor storing another declaration (gate review of step 3, 5); +1 a reference flag property unanswered / neither True nor False (two sites for the one flag property, C37b)
            ("Volt.Ide.Twincat/Ide/TcItemArchive.cs", 2),   // a member renamed since the save, and a CFC/SFC body edited since it, which TwinCAT's archive does not carry (D45)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Properties.cs", 3),   // an Exclude write the IDE took and did not apply, read back (C39); +1 the same for LinkAlways / External / CompilerDefines (C40); +1 an AdditionalAllocation other than 0, a build property with no line (C40)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs", 4),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1),   // -2 the PLCopen import that built nothing (deleted with the import, twincat-inproc-host)
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 8),   // +1 a TaskDef member none of the 13 measured (gate review of step 3, 6)
            ("Volt.Engine/UnsupportedException.cs", 1),   // wire-final-shape 3c: the code the type states, for the catches that route on a vendor "cannot"
            ("Volt.Ide.Codesys/Driver/CodesysDriver.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs", 7),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Reflection.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcArchive.cs", 2),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcArchiveBuilder.cs", 4),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcArchiveWriter.cs", 6),   // wire-final-shape 3c: coded at the throw; +2 rule 6 on the parse side, a blank line and stray text (3c review 3)
            ("Volt.Ide.Twincat/Ide/TcNetworkWriter.cs", 3),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcUnmeasured.cs", 2))),   // wire-final-shape 3c: coded at the throw
        new("Volt's own broken invariant, or a refusal nobody coded", "report a bug; code the refusal", "INTERNAL_ERROR", At(
            ("Volt.Engine/Format/St/FamilyContent.cs", 2),   // volt-cli-rework step 5: a body with no stated language, or one its stated language does not spell back
            ("Volt.Engine/Item/ItemKind.cs", 1),
            ("Volt.Engine/Sync/ProjectSnapshot.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 8),   // +1 ConflictFor logs a Volt bug whole (3c review 7); -1 PouKindToCode's default arm (gone: a create names the host's kind); +1 a kind the host declared with no shape (volt-cli-rework step 5)
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 1),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 3),   // +1 a project-settings read of a node that is no PLC project's settings item (multi-application-tree)
            ("Volt.Relay/RelayTunnel.cs", 1),
            ("Volt.Wire/PipeServer.cs", 1),
            ("Volt.Engine/Sync/Versioning.cs", 1))),   // a Volt bug during one item's read fails the op, never an unreadable entry (3c review 6)
        new("the IDE no longer holds what Volt just wrote or read", "pull to see what landed, then push again",
            "IDE_LOST_ITEM", At(
            ("Volt.Engine/Sync/PushService.cs", 6),
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs", 1),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 4),
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs", 3),
            ("Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Classes.cs", 2),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcItemArchive.cs", 3),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 1))),   // wire-final-shape 3c: coded at the throw
        new("a create collided with a child already there", "rename, or update instead", "DUPLICATE_CHILD", At(
            ("Volt.Engine/Sync/PushService.cs", 1))),
        new("the text cannot be split into what the push writes", "fix the body", "INVALID_ST", At(
            ("Volt.Engine/Format/St/PropertyLines.cs", 1),   // bridge-one-to-one §3: the %-line grammar (one Refuse builder)
            ("Volt.Engine/Format/St/StReader.cs", 20),   // +1: code under IMPLEMENTATION NONE (abstract-member-push)
            // The new contract (volt-cli-rework step 3): the one IMPLEMENTATION line grammar (no line, no language, a
            // language the vendor does not show) and the declared %-keys (no %-line, an undeclared key, a value its grammar
            // refuses, a key stated twice) — the layout code, as vendor-neutrality W6 names it.
            ("Volt.Engine/Seam/ItemFormat.cs", 3),
            ("Volt.Engine/Seam/PropertyKeyRegistry.cs", 4))),
        new("the IDE holds the item and Volt cannot read it whole",
            "fix it in the IDE, or push with force — or, for an item the IDE does not return, delete then create", "UNREADABLE", At(
            ("Volt.Engine/Ide/MemberWithoutDeclarationException.cs", 1),   // a member with no declaration (MemberSites, both drivers): its own type carries the push's delete-then-create advice (3c review 2)
            ("Volt.Engine/Sync/TreeLookup.cs", 2),   // moved from Ide/ItemLookup (volt-cli-rework step 5); +1 Read maps a driver's UNREADABLE to the folder's ITEM_UNVERIFIED (3c review 1)
            ("Volt.Engine/Sync/Versioning.cs", 1),   // the code an `unreadable` entry carries when its materialize failed uncoded (wire-final-shape §4)
            ("Volt.Ide.Codesys/Driver/CodesysDriver.Tree.cs", 4),   // wire-final-shape §4: an unreadable entry's code — a kind, a folder's properties, the library manager, a library reference the IDE did not answer
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs", 4),   // wire-final-shape §4: an unreadable entry's code — an item C2i must not open, a kind, a folder's Exclude property, an inherited exclusion
            ("Volt.Engine/Sync/PushConflicts.cs", 2),
            ("Volt.Engine/Sync/PushService.cs", 3),   // -1 ReadLive routes on MemberWithoutDeclarationException, not on the code (3c review 2); -1 ApplyToUnopened: an op of another kind no longer reaches it (resolved by path, unreadable-name-carries-kind 1.7)
            ("Volt.Ide.Codesys/Ide/CodesysNetworkReader.cs", 1),   // an archived SymbolComment that is not text (ld-fbd-coverage gate 1b-3)
            ("Volt.Ide.Twincat/Ide/TcDeviceDescriptor.cs", 1),   // a device whose ProduceXml does not parse (volt-cli-rework 2.2, review B6)
            ("Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs", 2),   // -1 the member declaration (MemberSites, volt-cli-rework step 6); +1 an item read as excluded by a folder the walk did not see (C39); +1 an interface accessor the saved file does not hold (gate review of step 3, 5)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.Properties.cs", 12),   // +3 the live Exclude property: no item XML, none published, neither True nor False (C39); +4 the live LinkAlways / External / CompilerDefines: no item XML, none published, read-only, neither True nor False (C40); +4 no item XML, no FullPath, a saved file / .plcproj not on disk (gate review of step 3, 6)
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 3),   // bridge-one-to-one §3: a declaration or implementation that reads null
            ("Volt.Ide.Twincat/Ide/TcTaskSchedule.cs", 3),   // a TaskDef that carries no measured member (gate review of step 3, 6)   // bridge-one-to-one §3: a declaration or implementation that reads null
            ("Volt.Ide.Codesys/Driver/CodesysDriver.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 6),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 1),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Codesys/Ide/CodesysObjectModel.cs", 5),   // wire-final-shape 3c: coded at the throw; +1 a name the IDE answers null (3c review 5)
            ("Volt.Ide.Twincat/Ide/TcItemArchive.cs", 4),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcLibrarySignatures.cs", 3),   // wire-final-shape 3c: coded at the throw
            ("Volt.Ide.Twincat/Ide/TcProjectSettings.cs", 6))),   // wire-final-shape 3c: coded at the throw

        // ── the optimistic gate and the apply loop ─────────────────────────────────────────────────────────────
        new("the lease is stale", "pull, then push again", "STALE_PROJECT_VERSION", At(
            ("Volt.Engine/Sync/PushService.cs", 1))),   // an error frame, the request's (wire-final-shape §5): no conflict row in PushConflicts
        new("the item moved since its version was read", "pull that item, merge, push again", "STALE_ITEM_VERSION", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 1))),
        new("a set landed on a path the IDE holds (a create, or a rename or move's to)",
            "a create: push an update or pick another name; a to: pick another or free it first", "ITEM_EXISTS", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            ("Volt.Engine/Sync/PushService.cs", 2))),   // move-onto-existing-path-refused: a held `to`, a held name (C38)
        new("a quoted item is gone (complete walk)", "create it, or drop the op", "ITEM_MISSING", At(
            ("Volt.Engine/Sync/PushConflicts.cs", 1))),
        new("the push could not read where the item lives", "fix what stops the IDE enumerating that place",
            "ITEM_UNVERIFIED", At(
            ("Volt.Engine/Sync/TreeLookup.cs", 1),   // TreeLookup.Read: a folder's children, a child, a child's name unreadable — the path descent's and the hosts' walk of every item (Ide/ItemLookup) alike (volt-cli-rework 3.1)
            ("Volt.Engine/Ide/ProjectDeclarations.cs", 1),
            ("Volt.Engine/Sync/PushConflicts.cs", 1),
            // -1 PushService: a forced replace's folder came from the walk; it is the op's path now (multi-application-tree)
            ("Volt.Ide.Twincat/Ide/ExplorerSnapshot.cs", 2),
            ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 6))),
        new("the push stopped before this op", "re-send it unchanged", "NOT_ATTEMPTED", At(
            ("Volt.Engine/Sync/PushService.cs", 2))),   // +1 every op a refusal before the first write did not reach (wire-final-shape §5)

        // ── the graphical body format ──────────────────────────────────────────────────────────────────────────
        new("network text that does not parse", "fix the text at the line", "NETWORK_PARSE", At(
            ("Volt.Engine/Format/Network/NetworkLexer.cs", 8),   // 2R.6b: a bad escape in a comment, title or backtick, and text after EXECUTE on its line
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 26))),   // 2R.6b (v2-spec): the old spellings that fail as no parse, each naming the new one; -1 the v1 detector (volt-cli-rework 3.1)
        new("a NETWORK block with no END_NETWORK", "close the block", "NETWORK_NOT_CLOSED", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1))),
        new("a wire declared twice, or named like a name in scope", "rename the wire", "NETWORK_DUPLICATE_NAME", At(
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1))),   // 2R.6b: a split defined twice (X17), checked once over the model
        new("a malformed operator group", "fix the expression", "NETWORK_BAD_EXPRESSION", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 59),   // 2R.6b (v2-spec): the indentation check ("missing `;`?"), the bracket rules, one tree one text (a redundant bracket, the call form where a word holds it), ENO without EN, `.name` misuse, the split's type, the old symbols
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1))),   // 2R.6b: a split read and defined nowhere (X17)
        new("an operator outside the FBD/LD table", "use an operator of the table", "NETWORK_UNKNOWN_OPERATOR", At(
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1))),
        new("a body shape network text has no spelling for", "draw it in the IDE", "NETWORK_UNSUPPORTED", At(
            ("Volt.Engine/Format/Network/NetworkText.cs", 1),
            ("Volt.Engine/Format/Network/NetworkValidator.cs", 1),   // 2R.6b: the shape refusals (X3–X17, the MEASURE shapes), checked once over the model
            ("Volt.Engine/Format/Network/NetworkTextWriter.cs", 1),   // 2R.6b: the validator's refusals (X3–X17, the MEASURE shapes) raised as one exception, by the code each names
            ("Volt.Engine/Format/Network/NetworkPairing.cs", 3),   // a pushed UNSUPPORTED line no live network pairs with (1b.4); +2 a removal that would erase what the text does not show — beside an insertion, or beside a network showing the same text (gate 1b-4)
            ("Volt.Engine/Format/Network/NetworkTextReader.cs", 8),   // 2R.6b: the reader keeps only what the grammar itself refuses (an UNSUPPORTED line beside other statements, a function read by `.name`, …); the shape refusals moved to the shared validator (NetworkValidator), raised through NetworkTextWriter
            // A shape the native builder has no TwinCAT form for (PARALLEL, a pin flag, an enabled bit operator,
            // a consumed call with no slot for its consumer) — it replaced the PLCopen import's refusals (twincat-inproc-host).
            ("Volt.Ide.Twincat/Ide/TcArchiveBuilder.cs", 1),
            // The 2R.5 shapes no TwinCAT build has measured (TcUnmeasured.RefuseUnbuilt).
            ("Volt.Ide.Twincat/Ide/TcUnmeasured.cs", 1))),
    };

    // ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_code_means_one_situation_is_raised_where_the_census_says_and_is_documented()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var cli = Path.Combine(root, "packages", "volt-cli");
        var contracts = Path.Combine(cli, "src", "Volt.Contracts", "Vocabulary");
        var codes = Consts(File.ReadAllText(Path.Combine(contracts, "BridgeErrorCodes.cs")), "BridgeErrorCodes")
            .Concat(Consts(File.ReadAllText(Path.Combine(contracts, "ConflictCodes.cs")), "ConflictCodes"))
            .ToList();
        Assert.True(codes.Count >= 20, $"only {codes.Count} code constant(s) read — the gate is not reading Contracts.");

        var findings = Findings(codes, Situations, Census(Path.Combine(cli, "src"), codes),
                                File.ReadAllText(Path.Combine(cli, "docs", "wire.html")),
                                File.ReadAllText(Path.Combine(cli, "docs", "network-text.html")));

        Assert.True(findings.Count == 0,
            "The wire's error vocabulary (openspec bridge-refusal-review V.4) — one situation per code, raised and " +
            "documented:\n  " + string.Join("\n  ", findings));
    }

    // ── the gate's own teeth ─────────────────────────────────────────────────────────────────────────────────────

    private static readonly (string Const, string Code)[] TwoCodes = { ("BridgeErrorCodes.BadRequest", "BAD_REQUEST"), ("ConflictCodes.NetworkParse", "NETWORK_PARSE") };
    private const string Pages = "<td class=\"name\">BAD_REQUEST</td>";
    private const string NetworkPage = "<td class=\"name\">NETWORK_PARSE</td>";

    private static Situation S(string code, params (string, int)[] sites) => new("s", "m", code, At(sites));

    private static Dictionary<(string Code, string File), int> Actual(params (string, string, int)[] rows) =>
        rows.ToDictionary(r => (r.Item1, r.Item2), r => r.Item3);

    [Fact]
    public void A_matching_census_is_no_finding() =>
        Assert.Empty(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 2)), S("NETWORK_PARSE", ("B.cs", 1)) },
                              Actual(("BAD_REQUEST", "A.cs", 2), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage));

    [Fact]
    public void A_new_raise_site_fails_until_it_is_classified() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 2)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                 Actual(("BAD_REQUEST", "A.cs", 3), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("BAD_REQUEST") && f.Contains("A.cs") && f.Contains("found 3"));

    [Fact]
    public void A_code_under_two_situations_fails() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("BAD_REQUEST", ("C.cs", 1)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                 Actual(("BAD_REQUEST", "A.cs", 1), ("BAD_REQUEST", "C.cs", 1), ("NETWORK_PARSE", "B.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("BAD_REQUEST") && f.Contains("2 situations"));

    [Fact]
    public void A_code_nothing_raises_fails() =>
        Assert.Contains(Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("NETWORK_PARSE") },
                                 Actual(("BAD_REQUEST", "A.cs", 1)), Pages, NetworkPage),
                        f => f.Contains("NETWORK_PARSE") && f.Contains("raised nowhere"));

    [Fact]
    public void An_undocumented_code_fails()
    {
        var findings = Findings(TwoCodes, new[] { S("BAD_REQUEST", ("A.cs", 1)), S("NETWORK_PARSE", ("B.cs", 1)) },
                                Actual(("BAD_REQUEST", "A.cs", 1), ("NETWORK_PARSE", "B.cs", 1)), "", "");
        Assert.Contains(findings, f => f.Contains("BAD_REQUEST") && f.Contains("wire.html"));
        Assert.Contains(findings, f => f.Contains("NETWORK_PARSE") && f.Contains("network-text.html"));
    }

    [Fact]
    public void A_reference_in_a_comment_is_no_raise_site() =>
        Assert.Empty(Hits(NoCodeCheckLeftTests.StripComments("// BridgeErrorCodes.BadRequest was here\nvar x = 1;"), TwoCodes));

    // ── the checks ───────────────────────────────────────────────────────────────────────────────────────────────

    private static List<string> Findings(IReadOnlyList<(string Const, string Code)> codes, IReadOnlyList<Situation> situations,
                                         Dictionary<(string Code, string File), int> actual, string wirePage, string networkPage)
    {
        var findings = new List<string>();
        var known = codes.Select(c => c.Code).ToHashSet(StringComparer.Ordinal);

        foreach (var s in situations.Where(s => !known.Contains(s.Code)))
            findings.Add($"situation '{s.Name}' answers {s.Code}, which is no code constant in Contracts.");

        foreach (var code in known.OrderBy(c => c, StringComparer.Ordinal))
        {
            var mine = situations.Where(s => s.Code == code).ToList();
            if (mine.Count == 0) findings.Add($"{code}: no situation names it — classify it, or delete the code.");
            if (mine.Count > 1)
                findings.Add($"{code}: answers {mine.Count} situations ({string.Join("; ", mine.Select(s => s.Name))}) — one " +
                             "situation per code: re-code the sites of the other situation.");

            var declared = mine.SelectMany(s => s.Sites).GroupBy(kv => kv.Key)
                .ToDictionary(g => g.Key, g => g.Sum(kv => kv.Value), StringComparer.Ordinal);
            var found = actual.Where(kv => kv.Key.Code == code)
                .ToDictionary(kv => kv.Key.File, kv => kv.Value, StringComparer.Ordinal);
            if (found.Count == 0)
                findings.Add($"{code}: raised nowhere in the toolchain's code — a code no client can observe is a lie in the vocabulary.");
            foreach (var file in declared.Keys.Union(found.Keys).OrderBy(f => f, StringComparer.Ordinal))
            {
                declared.TryGetValue(file, out var want);
                found.TryGetValue(file, out var got);
                if (want != got)
                    findings.Add($"{code} in {file}: census {want}, found {got} — " +
                                 (got > want ? "a new raise site: classify it (its situation must be this code's, or re-code it)"
                                             : "a site is gone: lower the count") +
                                 $". Census line: (\"{file}\", {got})");
            }

            var network = code.StartsWith("NETWORK_", StringComparison.Ordinal);
            var page = network ? networkPage : wirePage;
            if (!page.Contains($"class=\"name\">{code}<", StringComparison.Ordinal))
                findings.Add($"{code}: no row in docs/{(network ? "network-text.html" : "wire.html")} naming its situation.");
        }
        return findings;
    }

    /// <summary>The <c>public const string X = "Y";</c> of a vocabulary class, as (X, Y) — read as text, since this gate
    /// references no package. A const whose value is no code (<c>ProjectName = "&lt;project&gt;"</c>) is not one.</summary>
    internal static IEnumerable<(string Const, string Code)> Consts(string source, string type) =>
        Regex.Matches(NoCodeCheckLeftTests.StripComments(source), @"public\s+const\s+string\s+(\w+)\s*=\s*""([A-Z_]+)""\s*;")
            .Select(m => ($"{type}.{m.Groups[1].Value}", m.Groups[2].Value));

    /// <summary>Every (code, file) → count of references to a code constant under <paramref name="src"/>, comments
    /// stripped, outside Contracts and the CLI client.</summary>
    private static Dictionary<(string Code, string File), int> Census(string src, IReadOnlyList<(string Const, string Code)> codes)
    {
        var census = new Dictionary<(string, string), int>();
        foreach (var path in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, path).Replace('\\', '/');
            if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.StartsWith("Volt.Contracts/", StringComparison.Ordinal)
                || rel.StartsWith("Volt.Cli/", StringComparison.Ordinal)) continue;
            foreach (var code in Hits(NoCodeCheckLeftTests.StripComments(File.ReadAllText(path)), codes))
                census[(code, rel)] = census.TryGetValue((code, rel), out var n) ? n + 1 : 1;
        }
        return census;
    }

    /// <summary>The code of every reference to a code constant in comment-free <paramref name="code"/>.</summary>
    private static IEnumerable<string> Hits(string code, IReadOnlyList<(string Const, string Code)> codes)
    {
        var byConst = codes.ToDictionary(c => c.Const, c => c.Code, StringComparer.Ordinal);
        foreach (Match m in Regex.Matches(code, @"\b((?:BridgeErrorCodes|ConflictCodes)\.\w+)\b"))
            if (byConst.TryGetValue(m.Groups[1].Value, out var c)) yield return c;
        // An UnsupportedException states UNSUPPORTED by its type — the one coded type a catch routes on (wire-final-shape
        // step 3c) — so each one constructed is a raise site like a spelled constant.
        if (byConst.ContainsValue("UNSUPPORTED"))
            foreach (Match _ in Regex.Matches(code, @"\bnew\s+UnsupportedException\s*\(|\bUnsupportedException\s+\w+\s*\([^)]*\)\s*=>\s*new\s*\("))
                yield return "UNSUPPORTED";
    }

    // ── every throw states its class ─────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// EVERY THROW STATES ITS CLASS AT THE THROW (openspec <c>wire-final-shape</c> step 3c). The census above sees a code
    /// only where it is SPELLED, and an exception of a type Volt does not own carries none: it reached a client as
    /// <c>INTERNAL_ERROR</c> — "Volt bug" — whatever the situation, an IDE refusal and a request rule included. So the
    /// toolchain's code CONSTRUCTS — throws, or returns from a factory — only exceptions of its OWN types (a class declared
    /// under <c>src/</c>): a coded refusal (a <c>BridgeException</c> with its situation's code, an
    /// <c>UnsupportedException</c> where a catch routes on the vendor "cannot"), Volt's own broken invariant
    /// (<c>VoltInvariantException</c>, counted below), or a named type a named catch turns into a coded answer before any
    /// client sees it. The rule is over every type Volt does not declare, not a list of BCL names: a list let
    /// <c>FormatException</c> through (gate 3c review, finding 3). <c>ArgumentException</c> and its kind are not counted:
    /// a parameter guard is a caller's broken invariant by definition. The transport below the wire is pinned apart
    /// (<see cref="BelowTheWire"/>).
    /// </summary>
    private static readonly Regex Construction = new(
        @"\bnew\s+(?:\w+\.)*(\w*Exception)\s*\(|\b(?:\w+\.)*(\w*Exception)\s+\w+\s*\([^)]*\)\s*=>\s*new\s*\(",
        RegexOptions.Compiled);

    private static readonly Regex DeclaredException = new(@"\bclass\s+(\w+Exception)\b", RegexOptions.Compiled);

    private static string Src() => Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src");

    /// <summary>Every exception type the toolchain declares — Volt's own, so each states its class.</summary>
    private static HashSet<string> VoltTypes() =>
        Directory.EnumerateFiles(Src(), "*.cs", SearchOption.AllDirectories)
            .Where(p => !p.Replace('\\', '/').Contains("/bin/") && !p.Replace('\\', '/').Contains("/obj/"))
            .SelectMany(p => DeclaredException.Matches(File.ReadAllText(p)).Select(m => m.Groups[1].Value))
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>The constructions in <paramref name="code"/> of a type Volt does not declare.</summary>
    private static int Uncoded(string code, ISet<string> volt) =>
        Construction.Matches(code).Count(m =>
        {
            var type = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
            return !volt.Contains(type) && !type.StartsWith("Argument", StringComparison.Ordinal);
        });

    /// <summary>
    /// BELOW THE WIRE, PER FILE: the OS's own exception types where the transport binds a pipe or reads a token
    /// (<c>Win32Exception</c>, <c>UnauthorizedAccessException</c> — the host that starts the server, or the connector,
    /// reads them; never a request) and the relay's stalled send (<c>TimeoutException</c>, caught by every send caller
    /// with its other send failures). No frame carries one. Pinned like the invariants: a rise fails.
    /// </summary>
    private static readonly Dictionary<string, int> BelowTheWire = At(
        ("Volt.Wire/PipeAcl.cs", 6),             // the security descriptor, the bind, the token, the SID read and spelled (Win32Exception ×5), the name held by another user
        ("Volt.Wire/ProcessElevation.cs", 1),    // this process's own token elevation (the connector, the CLI)
        ("Volt.Relay/RelayTunnel.cs", 1));       // a frame that did not go out within the silence limit

    [Fact]
    public void No_throw_is_uncoded()
    {
        var volt = VoltTypes();
        var found = CensusOf(Src(), code => Uncoded(code, volt));
        var findings = found.Where(kv => kv.Value > (BelowTheWire.TryGetValue(kv.Key, out var pinned) ? pinned : 0))
                            .Select(kv => $"{kv.Key}: {kv.Value}").ToList();
        Assert.True(findings.Count == 0,
            "An exception of a type Volt does not declare carries no code and reaches a client as INTERNAL_ERROR (Volt's " +
            "bug) whatever the situation — code it with its situation's code (BridgeException, or UnsupportedException " +
            "where a catch routes on the vendor's \"cannot\"), raise it as a VoltInvariantException when it is Volt's own " +
            "broken invariant, or give it a named type that a named catch turns into a coded answer (openspec " +
            "wire-final-shape step 3c):\n  " + string.Join("\n  ", findings));
    }

    [Theory]
    [InlineData("throw new InvalidOperationException(\"CODESYS refused X\");", true)]
    [InlineData("throw new System.NotSupportedException(\"x\");", true)]
    [InlineData("throw new Exception(\"x\");", true)]
    [InlineData("throw new COMException(\"x\", 1);", true)]
    [InlineData("throw new FormatException(\"x\");", true)]
    [InlineData("throw new System.Xml.XmlException(\"x\");", true)]
    [InlineData("throw new KeyNotFoundException(\"x\");", true)]
    [InlineData("throw new InvalidDataException(\"x\");", true)]
    [InlineData("throw new Win32Exception(5);", true)]
    [InlineData("var other => new InvalidOperationException(\"x\"),", true)]
    [InlineData("private static NotSupportedException Refuse(string what) =>\n        new(\"x\");", true)]
    [InlineData("private static FormatException Refuse(string what) =>\n        new(\"x\");", true)]
    [InlineData("throw new BridgeException(BridgeErrorCodes.Unsupported, \"x\");", false)]
    [InlineData("throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported, \"x\");", false)]
    [InlineData("throw new UnsupportedException(\"x\");", false)]
    [InlineData("throw new VoltInvariantException(\"x\");", false)]
    [InlineData("throw new UnrepresentableBodyException(\"x\");", false)]
    [InlineData("throw new TaskDescriptorException(\"x\");", false)]
    [InlineData("throw new ArgumentNullException(nameof(x));", false)]
    [InlineData("throw new System.ArgumentOutOfRangeException(nameof(x));", false)]
    [InlineData("catch (InvalidOperationException) { }", false)]
    [InlineData("catch (FormatException) { }", false)]
    public void An_uncoded_throw_is_an_exception_of_a_type_Volt_does_not_declare(string line, bool counted) =>
        Assert.Equal(counted, Uncoded(line, VoltTypes()) > 0);

    // ── the invariants: a ratchet ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// VOLT'S OWN BROKEN INVARIANTS, PER FILE — the one situation <c>INTERNAL_ERROR</c> names by intent. Each is a state
    /// Volt's code guarantees cannot happen, so the line only goes DOWN: a new invariant fails until someone shows it is
    /// one (raise the count here, with why); a removed one passes, and its line is lowered with it. A request, an IDE state
    /// or a vendor limit is never one of these — it is coded with its own situation's code.
    /// </summary>
    private static readonly Dictionary<string, int> Invariants = At(
        ("Volt.Engine/Format/Body/BodyFormatGuard.cs", 1),       // a body with text and no stated language from its reader
        ("Volt.Engine/Format/Network/NetworkMembers.cs", 1),     // a stored member value read as a list of strings it is not
        ("Volt.Engine/Format/Network/NetworkTextGate.cs", 2),    // the writer refused a node, or a network, the reader did not mark
        ("Volt.Engine/Format/Network/NetworkTextReader.cs", 1),  // a language word LanguageOf found and LanguageNamed does not name
        ("Volt.Engine/Format/St/PropertyLines.cs", 2),           // a line no key opens, or a key with no reader, handed to Read
        ("Volt.Engine/Format/St/StReader.cs", 2),                // a boundary line stating no language; a U+FEFF StTrivia classed impossibly
        ("Volt.Engine/Format/Task/TaskDescriptorFormat.cs", 1),  // call comments not index-aligned with the calls
        ("Volt.Engine/Ide/SourceScopes.cs", 1),                  // a network body written with no validated model
        ("Volt.Engine/Seam/KindRegistry.cs", 1),                 // the registries refuse a conflicting host declaration, at start
        ("Volt.Engine/Seam/LanguageRegistry.cs", 2),
        ("Volt.Engine/Seam/PropertyKeyRegistry.cs", 2),
        ("Volt.Engine/Seam/VendorRegistry.cs", 3),
        ("Volt.Engine/Sync/Materializer.cs", 1),                 // a hidden body read without its reason, or a shown one with one
        ("Volt.Engine/Sync/PushService.cs", 2),                  // a PushOp with no apply arm (PushOp is abstract, two members)
        ("Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs", 7),     // the model's guarantees: an FB call's instance, a box's ENO and slots, a known node type, no RESET at the flag write, a body the guard let through
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs", 2),  // a create of a kind with no arm; a delete of a child the push saw
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs", 1), // a class change the push refuses first
        ("Volt.Ide.Codesys/Ide/CodesysObjectModel.Task.cs", 1),  // call comments not index-aligned with the calls
        ("Volt.Ide.Twincat/Ide/TcArchive.cs", 1),                // a RESET at the generic flag write
        ("Volt.Ide.Twincat/Ide/TcArchiveBuilder.cs", 3),         // an FB call's instance, a box's ENO and slots
        ("Volt.Ide.Twincat/Ide/TcNetworkWriter.cs", 3),          // an in-place write with no archive, or no builder for an insertion; a body the guard let through
        ("Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs", 1),       // SysTaskPatch let through a member it refuses
        ("Volt.Ide.Twincat/Ide/TcObjectModel.cs", 1),            // a relative path asked of a node outside its root
        ("Volt.Relay/RelayTunnel.cs", 1));                       // a tunnel started twice

    private static readonly Regex InvariantThrow = new(
        @"\bnew\s+VoltInvariantException\s*\(|\bVoltInvariantException\s+\w+\s*\([^)]*\)\s*=>\s*new\s*\(", RegexOptions.Compiled);

    [Fact]
    public void Invariants_only_go_down()
    {
        var findings = InvariantFindings(Invariants,
            Census(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src"), InvariantThrow));
        Assert.True(findings.Count == 0,
            "INTERNAL_ERROR means Volt's own broken invariant (openspec wire-final-shape step 3c):\n  " + string.Join("\n  ", findings));
    }

    [Fact]
    public void A_new_invariant_fails_and_a_removed_one_passes()
    {
        Assert.Contains(InvariantFindings(At(("A.cs", 1)), new Dictionary<string, int> { ["A.cs"] = 2 }),
                        f => f.Contains("A.cs") && f.Contains("found 2") && f.Contains("a new one"));
        Assert.Contains(InvariantFindings(At(("A.cs", 1)), new Dictionary<string, int> { ["B.cs"] = 1 }),
                        f => f.Contains("B.cs") && f.Contains("found 1"));
        Assert.Empty(InvariantFindings(At(("A.cs", 2)), new Dictionary<string, int> { ["A.cs"] = 1 }));
        Assert.Empty(InvariantFindings(At(("A.cs", 1)), new Dictionary<string, int>()));
    }

    [Theory]
    [InlineData("throw new VoltInvariantException(\"x\");", true)]
    [InlineData("private static VoltInvariantException Conflict(string vendor, string what) =>\n        new($\"x\");", true)]
    [InlineData("catch (VoltInvariantException) { }", false)]
    [InlineData("if (ex is VoltInvariantException)", false)]
    public void An_invariant_is_a_constructed_VoltInvariantException(string line, bool counted) =>
        Assert.Equal(counted, InvariantThrow.IsMatch(line));

    /// <summary>A rise fails as a new invariant (design: the ratchet fails on a rise only; a fall lowers the line).</summary>
    private static List<string> InvariantFindings(Dictionary<string, int> declared, Dictionary<string, int> found)
    {
        var findings = new List<string>();
        foreach (var file in declared.Keys.Union(found.Keys).OrderBy(f => f, StringComparer.Ordinal))
        {
            declared.TryGetValue(file, out var want);
            found.TryGetValue(file, out var got);
            if (got > want)
                findings.Add($"invariants in {file}: census {want}, found {got} — a new one: code it with its situation's code, " +
                             $"or show it is Volt's own guarantee and raise the line: (\"{file}\", {got}),");
        }
        return findings;
    }

    /// <summary>File → count of <paramref name="pattern"/> under <paramref name="src"/>, comments stripped, outside
    /// Contracts and the CLI client (the same scope as the raise-site census).</summary>
    private static Dictionary<string, int> Census(string src, Regex pattern) => CensusOf(src, code => pattern.Matches(code).Count);

    private static Dictionary<string, int> CensusOf(string src, Func<string, int> count)
    {
        var census = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var path in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, path).Replace('\\', '/');
            if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.StartsWith("Volt.Contracts/", StringComparison.Ordinal)
                || rel.StartsWith("Volt.Cli/", StringComparison.Ordinal)) continue;
            var n = count(NoCodeCheckLeftTests.StripComments(File.ReadAllText(path)));
            if (n > 0) census[rel] = n;
        }
        return census;
    }
}
