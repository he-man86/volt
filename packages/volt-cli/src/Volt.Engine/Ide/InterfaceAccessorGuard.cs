using Volt.Contracts;

namespace Volt.Engine.Ide;

/// <summary>
/// The refusal that protects an INTERFACE property's GET/SET from being written (DIALECT D21).
///
/// <para>An interface property's accessors are bodiless stubs: they carry the fact that they EXIST and nothing
/// else. Writing one can hard-crash TcXaeShell, so neither driver does — but refusing is only half the job, and
/// the half that was missing cost more than the crash would have.</para>
///
/// <para><b>Returning silently is the "accepted but landed nothing" failure.</b> The pull materializes an
/// editable <c>GET … END_GET</c> in the <c>.itf</c> file. An engineer edits it. <c>StReader</c> re-kinds it,
/// <c>PushService.Same</c> marks it changed, <c>BodyFormatGuard</c> passes it, and the receipt bakes the pushed
/// text into the client's baseline — so the edit is discarded and <c>volt status</c> then reports in sync. The
/// engineer has no way to find out. So a real CHANGE must be refused LOUDLY, while an unchanged restatement
/// stays the ordinary no-op that keeps the enclosing item pushable at all.</para>
///
/// <para><b>It lives here because the message is the contract.</b> Both drivers refuse, each detecting the
/// change its own way — CODESYS reads the live accessor back, TwinCAT knows by construction that
/// <c>ReadMember</c> built it as <c>new Accessor(null, null)</c> — but the sentence the engineer reads has to be
/// one sentence. It was written out twice, verbatim, in two assemblies, which is precisely the shape this repo
/// has already lost data to (the TwinCAT body write diverging from the CODESYS one). The DETECTION stays with
/// each driver, because it is genuinely vendor work; the DECISION and the wording are here.</para>
/// </summary>
public static class InterfaceAccessorGuard
{
    /// <summary>Refuse when the pushed accessor differs from the one the project holds.
    ///
    /// <para>Whitespace-insensitive on both halves: a reformat is not an edit, and refusing one would block a
    /// push over a trailing newline the materializer itself introduced.</para></summary>
    /// <param name="liveDeclaration">The accessor's declaration as the project holds it, or null if it has none.</param>
    /// <param name="liveBody">The accessor's body as the project holds it, or null if it has none.</param>
    /// <param name="pushedDeclaration">What the pushed source declares.</param>
    /// <param name="pushedBody">What the pushed source's body says.</param>
    public static void RefuseIfChanged(string? liveDeclaration, string? liveBody,
                                       string? pushedDeclaration, string? pushedBody)
    {
        if (Same(liveDeclaration, pushedDeclaration) && Same(liveBody, pushedBody)) return;

        throw new BridgeException(BridgeErrorCodes.Unsupported,
            "an interface property's GET/SET carries only the fact that it exists — its declaration and " +
            "body are not writable, and writing them can crash the IDE. Remove the edit, or make the " +
            "change in the IDE and pull.");
    }

    private static bool Same(string? a, string? b) => (a ?? "").Trim() == (b ?? "").Trim();
}
