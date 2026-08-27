using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

public class BuildRequest
{
    /// <summary>The project this workspace is bound to. The op refuses (WRONG_PROJECT) unless the live bridge is
    /// serving it — so `volt build` reports diagnostics for the bound project, not whatever happens to be open.
    /// Null = no identity check (older client).</summary>
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
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
    [JsonPropertyName("severity")]
    public string Severity { get; set; } = Volt.Contracts.Severity.Info;

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

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
