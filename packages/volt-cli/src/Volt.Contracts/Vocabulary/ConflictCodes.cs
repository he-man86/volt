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

    /// <summary>It parses, but is not the canonical form — it would drift on the next pull. The message
    /// carries the exact text to paste, and <c>line</c> the first difference.</summary>
    public const string NetworkNotCanonical = "NETWORK_NOT_CANONICAL";

    /// <summary>Any other structural parse failure: a statement before any network, an unexpected
    /// <c>END_NETWORK</c>, a leftover legacy <c>VAR_TEMP</c> line, a jump label written as a statement.</summary>
    public const string NetworkParse = "NETWORK_PARSE";

    /// <summary>A <c>NETWORK</c> block with no <c>END_NETWORK</c>.</summary>
    public const string NetworkNotClosed = "NETWORK_NOT_CLOSED";

    /// <summary>One network index used twice — their ids would collide in the IDE.</summary>
    public const string NetworkDuplicateNetwork = "NETWORK_DUPLICATE_NETWORK";

    /// <summary>A wire, result or instance name defined twice in one network.</summary>
    public const string NetworkDuplicateName = "NETWORK_DUPLICATE_NAME";

    /// <summary>A malformed operator group — partial parens, mixed operators in one group, or an operator
    /// with no right-hand operand.</summary>
    public const string NetworkBadExpression = "NETWORK_BAD_EXPRESSION";

    /// <summary>An operator symbol that is not in the FBD/LD operator table.</summary>
    public const string NetworkUnknownOperator = "NETWORK_UNKNOWN_OPERATOR";

    /// <summary>Raised by the WRITER, not the parser: a body shape network text has no spelling for — an
    /// operator box naming an output pin, or a box with two unnamed output pins.</summary>
    public const string NetworkUnsupported = "NETWORK_UNSUPPORTED";

    /// <summary>The whole <c>NETWORK_*</c> family, for a client that wants to branch on "is this a graphical
    /// body problem" without listing them.</summary>
    public static readonly string[] Network =
    {
        NetworkNotCanonical, NetworkParse, NetworkNotClosed, NetworkDuplicateNetwork,
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
    /// <see cref="StaleItemVersion"/> because the remedy differs: there is nothing to merge with.</summary>
    public const string ItemMissing = "ITEM_MISSING";

    /// <summary>The name the project-level lease conflict is reported under. It is not an item and never
    /// collides with one: a wire name is `name.kind` and `&lt;` cannot appear in an IEC identifier.
    ///
    /// <para>A constant because the CLI branches on it. It was a bare literal in two files, which is one
    /// rename away from a `volt push` that stops explaining the single most common refusal it gets.</para></summary>
    public const string ProjectName = "<project>";

    /// <summary>The gate family, for a client that wants "is this the optimistic gate" without listing them.</summary>
    public static readonly string[] Gate =
    {
        StaleProjectVersion, StaleItemVersion, ItemExists, ItemMissing,
    };

    /// <summary>The <see cref="BridgeErrorCodes"/> values that reach a client as a CONFLICT rather than as an
    /// error frame, because the push catches them. Listing them is what makes the enum honest: without this,
    /// six of the ten codes are published by no op and look unreachable.</summary>
    public static readonly string[] FromBridge =
    {
        BridgeErrorCodes.NotFound, BridgeErrorCodes.Unsupported, BridgeErrorCodes.DuplicateChild,
        BridgeErrorCodes.BadRequest, BridgeErrorCodes.InvalidSt, BridgeErrorCodes.InvalidCodeHeader,
        BridgeErrorCodes.Unreadable,
    };
}
