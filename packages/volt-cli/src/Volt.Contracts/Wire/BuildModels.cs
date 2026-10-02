using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary><c>build</c> takes nothing but the bound identity — so `volt build` reports diagnostics for the
/// project the workspace is bound to, not whatever happens to be open.</summary>
public class BuildRequest : BoundRequest
{
}

/// <summary>The wire's diagnostic severity vocabulary — <c>error</c> / <c>warning</c> / <c>info</c>, and the one
/// mapping from whatever a vendor calls it.
/// <para>Both drivers did this themselves and neither was tested: CODESYS matched substrings of a .NET enum name
/// (<c>Error</c>/<c>Fatal</c>/<c>Exception</c> → error), TwinCAT special-cased the single word its output-window
/// regex could produce (<c>message</c> → info). One function covers both inputs, and it matters that it is one:
/// <c>BuildService</c> COUNTS on these exact strings to report "N errors, M warnings", so a vendor whose word
/// fell through to a different spelling would be silently counted as info.</para>
/// <para>What is NOT unified is where a build's success comes from. CODESYS derives it from the diagnostics
/// (no error-severity message); TwinCAT reads <c>SolutionBuild.LastBuildInfo</c>, the IDE's own count of failed
/// projects. Those are two different vendor SIGNALS, not two copies of one rule, and picking one would either
/// discard TwinCAT's authoritative answer or change CODESYS's.</para></summary>
public static class Severity
{
    public const string Error = "error";
    public const string Warning = "warning";
    public const string Info = "info";

    /// <summary>A vendor's severity word (an enum name, an output-window token) → the wire's vocabulary.
    /// Substring-matched and case-insensitive because the inputs are not a closed set: CODESYS's enum has
    /// spellings this has never seen, and anything unrecognised is INFO — the safe direction, since inventing an
    /// error would fail a build that passed.</summary>
    public static string Of(string? vendorSeverity)
    {
        var s = vendorSeverity ?? "";
        if (Has(s, "Error") || Has(s, "Fatal") || Has(s, "Exception")) return Error;
        if (Has(s, "Warning")) return Warning;
        return Info;
    }

    private static bool Has(string haystack, string needle) =>
        haystack.IndexOf(needle, System.StringComparison.OrdinalIgnoreCase) >= 0;
}

public class BridgeDiagnostic
{
    /// <summary>The FULL wire name of the item this diagnostic is about (`FB_Motor.pou`) — null when the vendor
    /// did not say which, or when it said something this bridge could not resolve to exactly one item.
    ///
    /// <para>Without it a diagnostic carries a <see cref="Line"/> anchored to nothing: a client has a line
    /// number and no file to put it in, so `volt build` can only print prose and an editor cannot place a
    /// squiggle. BOTH vendors identified the item and both threw it away — CODESYS on `IMessage.ObjectGuid`,
    /// TwinCAT in the `file(line,col)` its own regex already captured.</para>
    ///
    /// <para>FULL or null, never bare: the wire's names are full names (`Versioning.VersionedItem.Identity`),
    /// and a field that is sometimes one spelling and sometimes the other is worse than an absent one. A bare
    /// name that matches two items across kinds — `CM_Carrier.pou` and `CM_Carrier.visualization` both exist in
    /// real projects — resolves to null rather than to a guess.</para></summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>The CHILD of <see cref="Name"/> the diagnostic is inside — a method, property, action or transition
    /// (`Execute`) — or null when it is about the item itself.
    ///
    /// <para>A method, property accessor or action is not an item on this wire: it travels inside its parent's file,
    /// so <see cref="Name"/> is the parent and is the file a client opens. But CODESYS reports the error against the
    /// CHILD object, and an FB with twelve methods is still a hunt without it (openspec
    /// <c>codesys-diagnostic-child-names</c>, field case <c>c802b74d</c>: five <c>C0578</c>s in METHOD bodies,
    /// published with no name at all). A property accessor's diagnostic names the PROPERTY: GET/SET are read with
    /// their property, not beside it.</para>
    ///
    /// <para>Bare and unpromoted: a member is named inside its parent's file, not on the wire's item map, so
    /// <c>BuildService.PromoteNames</c> leaves its spelling exactly as the driver gave it. But it is never present
    /// without <see cref="Name"/>: a name that resolves to nothing takes the member with it, because a child of
    /// nothing tells a client nothing.</para>
    ///
    /// <para><b>It is also the frame of <see cref="Line"/>.</b> A vendor counts a child's line inside the CHILD
    /// object (TwinCAT, DIALECT D36), not in the wire file, so `name:line` alone points at the wrong line of the right
    /// file. A client that prints a position prints the member with it - `FB_Motor.pou(Execute):6`, as `volt build`
    /// does.</para></summary>
    [JsonPropertyName("member")]
    public string? Member { get; set; }

    /// <summary>The vendor's own diagnostic number as the IDE renders it (`C0032`) — null when it has none.
    ///
    /// <para>Not a <see cref="BridgeErrorCodes"/> value and not comparable to one: those are VOLT's codes for
    /// why an op was refused, this is the COMPILER's code for what is wrong with the engineer's code. It is the
    /// only stable handle on a diagnostic — the message text is localized and rewritten between versions, which
    /// is exactly why the LSP conformance suite matches CODESYS diagnostics by prose today.</para></summary>
    [JsonPropertyName("code")]
    public string? Code { get; set; }

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = Volt.Contracts.Severity.Info;

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    /// <summary>The vendor's line, as the IDE gave it - 0 when it gave none (every CODESYS diagnostic: its position
    /// is an opaque id, DIALECT C27).
    ///
    /// <para>Counted in the VENDOR'S object, not in the wire file: when <see cref="Member"/> is set it is a line of
    /// that member (TwinCAT, DIALECT D36), so it is only a position together with the member.</para></summary>
    [JsonPropertyName("line")]
    public int Line { get; set; }

    [JsonPropertyName("column")]
    public int Column { get; set; }
}

public class BuildResponse
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("duration")]
    public double Duration { get; set; }

    [JsonPropertyName("diagnostics")]
    public List<BridgeDiagnostic> Diagnostics { get; set; } = new();
}
