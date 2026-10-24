using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary><c>build</c> takes the bound identity — so `volt build` reports diagnostics for the project the workspace is
/// bound to, not whatever happens to be open — and, optionally, the applications to compile.</summary>
public class BuildRequest : BoundRequest
{
    /// <summary>The roots of the applications to compile, as <c>refs</c>/<c>fetch</c> publish them in
    /// <see cref="ReadResponse.Applications"/>; only their diagnostics are reported. Absent: every application. A root
    /// the project does not hold, or an empty list, is refused with <c>BAD_REQUEST</c> before anything is built.</summary>
    [JsonPropertyName("applications")]
    public List<string>? Applications { get; set; }
}

/// <summary>The wire's diagnostic severity vocabulary — <c>error</c> / <c>warning</c> / <c>info</c>.
/// <para>Each host maps its vendor's own value onto these words through a table it declares (CODESYS: the numeric
/// <c>IMessage.Severity</c>; TwinCAT: the Output-pane token). A value a host's table does not hold is no word here: the
/// diagnostic carries no <c>severity</c>, never a guessed one. <c>BuildService</c> counts on these exact strings.</para>
/// <para>What is NOT unified is where a build's success comes from. CODESYS derives it from the diagnostics
/// (no error-severity message); TwinCAT reads <c>SolutionBuild.LastBuildInfo</c>, the IDE's own count of failed
/// projects. Those are two different vendor SIGNALS, not two copies of one rule.</para></summary>
public static class Severity
{
    public const string Error = "error";
    public const string Warning = "warning";
    public const string Info = "info";
}

public class BridgeDiagnostic
{
    /// <summary>The PATH of the item this diagnostic is about (`Device/Plc Logic/Application/FB_Motor.pou`) — null when
    /// the vendor did not say which, or when it said something this bridge could not resolve to exactly one item. A path,
    /// so the same message in two applications is two diagnostics, each on its own application's item.
    ///
    /// <para>Without it a diagnostic carries a <see cref="Line"/> anchored to nothing: a client has a line
    /// number and no file to put it in, so `volt build` can only print prose and an editor cannot place a
    /// squiggle. BOTH vendors identified the item and both threw it away — CODESYS on `IMessage.ObjectGuid`,
    /// TwinCAT in the `file(line,col)` its own regex already captured.</para>
    ///
    /// <para>A path or null, never a bare name: the wire's identities are paths (`Versioning.VersionedItem.Identity`),
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
    /// <para><b>It does not frame <see cref="Line"/>.</b> A vendor counts a child's line inside the CHILD object (TwinCAT,
    /// DIALECT D36); the bridge places that line in the item's fetched text (wire-final-shape 3.6b), so <c>name:line</c>
    /// is the position, and the member says which child it is in.</para></summary>
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

    /// <summary>The vendor's severity in the wire's words (<see cref="Volt.Contracts.Severity"/>) — absent when the vendor's
    /// value is not in its host's declared table: not classified, never guessed.</summary>
    [JsonPropertyName("severity")]
    public string? Severity { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    /// <summary>A line of the ITEM'S FETCHED TEXT, 1-based — the coordinates <c>grep</c> and a network-text conflict use,
    /// never the vendor's own count (wire-final-shape 3.6b). A vendor counts its line inside the object it names (TwinCAT:
    /// the declaration's lines, then the code's, inside the member when there is one, DIALECT D36), and the bridge places
    /// it in the text. Absent when the vendor gave none (every CODESYS diagnostic: its position is an opaque id, DIALECT
    /// C27; a TwinCAT line with no <c>file(line)</c> shape) or when the bridge cannot place it with certainty (a property
    /// accessor's line, a network or hidden body, a diagnostic naming no item).</summary>
    [JsonPropertyName("line")]
    public int? Line { get; set; }

    /// <summary>The vendor's column on <see cref="Line"/>, 1-based — absent when it gave none (CODESYS never; TwinCAT
    /// 3.1.4024 writes <c>(line)</c> without one), and whenever <see cref="Line"/> is.</summary>
    [JsonPropertyName("column")]
    public int? Column { get; set; }
}

public class BuildResponse
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    /// <summary>How long the build took, in milliseconds of wall-clock time on the bridge.</summary>
    [JsonPropertyName("durationMs")]
    public long DurationMs { get; set; }

    [JsonPropertyName("diagnostics")]
    public List<BridgeDiagnostic> Diagnostics { get; set; } = new();
}
