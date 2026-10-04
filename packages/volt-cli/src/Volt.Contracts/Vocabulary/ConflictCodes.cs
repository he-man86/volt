namespace Volt.Contracts;

/// <summary>
/// The codes that travel on <c>PushConflict.Code</c> — the SECOND wire vocabulary, and until now the
/// undocumented one.
///
/// <para>A push answers a refusal as a conflict rather than an error frame, so the code a refusal computed
/// arrives here. Two families share the field and cannot collide:</para>
/// <list type="bullet">
/// <item><b><see cref="BridgeErrorCodes"/> values</b> — everything the push itself refuses: a shape the
/// vendor cannot write, an item that is not there, a name already taken, an op the engine cannot route, a
/// body the ST reader rejects.</item>
/// <item><b>The <c>NETWORK_*</c> family below</b> — a graphical body the FBD/LD format refuses. These carry a
/// 1-based <c>line</c> as well.</item>
/// </list>
///
/// <para><b>Why the NETWORK family lives here and not in the Engine that raises it.</b> Clients observe these
/// strings today and had nowhere to read them: they were literals inside <c>NetworkTextReader</c>, absent
/// from Contracts and from the generated docs, and <c>NetworkTextException</c>'s constructor even defaulted
/// to one as a magic string. That absence has already produced a phantom: a DTO comment cited
/// <c>NETWORK_NESTED_EXPR</c>, a code that exists nowhere in the repo, and it was the only place in Contracts
/// that named the family at all — so it was exactly what a client author would have read.</para>
///
/// <para>Contracts holds no Engine reference, so the Engine cannot import these — the gate in
/// <c>DocDataTests</c> checks the other way instead: every <c>NETWORK_*</c> literal the Engine raises must be
/// one of these, so the two cannot drift.</para>
/// </summary>
public static class ConflictCodes
{
    // ── the graphical body format (see docs/network-text.html#diagnostics) ──────────────────────────

    /// <summary>Any other structural parse failure: a statement before any network, an unexpected
    /// <c>END_NETWORK</c>, a statement without its <c>;</c>, and network text v1 (<c>LET</c>,
    /// <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c>), which is refused with a "re-pull" message.</summary>
    public const string NetworkParse = "NETWORK_PARSE";

    /// <summary>A <c>NETWORK</c> block with no <c>END_NETWORK</c>.</summary>
    public const string NetworkNotClosed = "NETWORK_NOT_CLOSED";

    /// <summary>A wire declared or defined twice in one network, or named like a name in scope (case-insensitively).
    /// (<c>NETWORK_DUPLICATE_NETWORK</c>, one v1 network index used twice, went with the order number: network
    /// text v2 headers carry none.)</summary>
    public const string NetworkDuplicateName = "NETWORK_DUPLICATE_NAME";

    /// <summary>A malformed operator group — partial parens, mixed operators in one group, or an operator
    /// with no right-hand operand.</summary>
    public const string NetworkBadExpression = "NETWORK_BAD_EXPRESSION";

    /// <summary>An operator symbol that is not in the FBD/LD operator table.</summary>
    public const string NetworkUnknownOperator = "NETWORK_UNKNOWN_OPERATOR";

    /// <summary>A body shape network text has no spelling for, refused by name — raised by the reader (a flag
    /// on a wire reference, nested edges, a POU named like a construct) and by the gate when the WRITER has no
    /// spelling for a fact of the model the text reads to.</summary>
    public const string NetworkUnsupported = "NETWORK_UNSUPPORTED";

    /// <summary>The whole <c>NETWORK_*</c> family, for a client that wants to branch on "is this a graphical
    /// body problem" without listing them.</summary>
    public static readonly string[] Network =
    {
        NetworkParse, NetworkNotClosed,
        NetworkDuplicateName, NetworkBadExpression, NetworkUnknownOperator, NetworkUnsupported,
    };

    // ── the optimistic-concurrency gate ────────────────────────────────────────────────────────────

    /// <summary>The push's LEASE is stale: the project moved between the fetch that produced
    /// <c>expectedProjectVersion</c> and this push. Nothing was applied. Carried on the synthetic
    /// <see cref="ProjectName"/> row.
    ///
    /// <para>Remedy: pull, then push again.</para></summary>
    public const string StaleProjectVersion = "STALE_PROJECT_VERSION";

    /// <summary>The item moved since the client read its version — the ordinary edit-collision. Remedy: pull
    /// that item, merge, push again.</summary>
    public const string StaleItemVersion = "STALE_ITEM_VERSION";

    /// <summary>A CREATE (<c>ifVersion: null</c>) landed on a name the IDE already holds. Remedy: fetch the
    /// item's version and push it as an update, or pick another name — NOT "pull and retry", which is what the
    /// stale-version codes mean and what a caller reading only the prose could not tell this apart from.</summary>
    public const string ItemExists = "ITEM_EXISTS";

    /// <summary>The client quoted a version for an item that is no longer there. Distinct from
    /// <see cref="StaleItemVersion"/> because the remedy differs: there is nothing to merge with.
    ///
    /// <para>Only ever answered from a COMPLETE walk — see <see cref="ItemUnverified"/>.</para></summary>
    public const string ItemMissing = "ITEM_MISSING";

    /// <summary>The push could not READ the item, so it will not touch it: the pre-apply walk skipped the
    /// folder it lives in, and absence from a partial walk means nothing.
    ///
    /// <para>Split from <see cref="ItemMissing"/> because the two are opposite news. "The item is gone" invites
    /// the client to recreate it; here the item is almost certainly still there and the BRIDGE is the thing
    /// that is impaired. Recreating it would be the wrong move, and under <c>force</c> it is the move the
    /// client would make. The remedy is to fix whatever stops the IDE enumerating that folder.</para>
    ///
    /// <para><b>The same code from the apply.</b> TwinCAT reads a folder only when its Solution Explorer hierarchy
    /// vouches for every child (DIALECT C2i: opening a POU the IDE does not parse kills TcXaeShell). A walk takes a
    /// folder it does not vouch for into <c>unwalked</c> — the gate above; a push's apply-time lookup meets the same
    /// refusal and answers it with this code too, the message naming the folder and what the hierarchy did not vouch
    /// for. Two children of one name in such a folder (DIALECT D34) is a project fact with the same remedy, and the same
    /// code. A hierarchy that cannot vouch for the PLC project ITSELF stops the walk before anything is read, so it
    /// reaches <c>refs</c>/<c>fetch</c>/<c>push</c> as an error frame with this code — the one place a
    /// <see cref="ConflictCodes"/> value is a frame (openspec <c>bridge-refusal-review</c> 7.1). It was
    /// <c>INTERNAL_ERROR</c>, which blamed Volt for an IDE state.</para>
    ///
    /// <para><b>On an op whose own item was read.</b> Resolving a body's names reads every declaration of the project,
    /// so such a folder ANYWHERE refuses that op too — with this code (the remedy is the folder's) and a message that
    /// says the refusal is the folder's, not the item's (review of <c>bridge-refusal-review</c> 7).</para></summary>
    public const string ItemUnverified = "ITEM_UNVERIFIED";

    // ── the apply loop's outcome ───────────────────────────────────────────────────────────────────

    /// <summary>The op was NOT APPLIED because the push stopped before reaching it: the live IDE refused an earlier op
    /// (in apply order) after other ops had landed. Appears only on an ACCEPTED push — the one whose conflicts name
    /// every op that did not land (openspec <c>push-keeps-what-landed</c>): the refused op with its own code, and each
    /// op after it with this one. Nothing of this op was written, so re-sending it unchanged is the remedy.
    ///
    /// <para>Not a gate code and never an error frame: it says what the push did, not what was wrong with the op.</para></summary>
    public const string NotAttempted = "NOT_ATTEMPTED";

    /// <summary>The name the project-level lease conflict is reported under. It is not an item and never
    /// collides with one: a wire name is `name.kind` and `&lt;` cannot appear in an IEC identifier.
    ///
    /// <para>A constant because it was a bare literal in two files. Nothing branches on the NAME — the CLI
    /// tells a stale lease apart by its CODE (`Commands.cs`, `c.Code == StaleProjectVersion`).</para></summary>
    public const string ProjectName = "<project>";

    /// <summary>The gate family, for a client that wants "is this the optimistic gate" without listing them.</summary>
    public static readonly string[] Gate =
    {
        StaleProjectVersion, StaleItemVersion, ItemExists, ItemMissing, ItemUnverified,
    };

    /// <summary>The <see cref="BridgeErrorCodes"/> values that reach a client as a CONFLICT rather than as an
    /// error frame, because the push catches them. Listing them is what makes the enum honest: without this,
    /// six of the ten codes are published by no op and look unreachable. <c>INVALID_CODE_HEADER</c> is gone from the
    /// vocabulary: a push no longer reads a top-level item's header (openspec <c>push-without-header-check</c>).</summary>
    public static readonly string[] FromBridge =
    {
        BridgeErrorCodes.IdeLostItem, BridgeErrorCodes.Unsupported, BridgeErrorCodes.DuplicateChild,
        BridgeErrorCodes.BadRequest, BridgeErrorCodes.InvalidSt, BridgeErrorCodes.Unreadable,
    };
}
