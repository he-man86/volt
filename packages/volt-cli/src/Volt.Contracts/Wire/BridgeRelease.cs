using System;
using System.Diagnostics;

namespace Volt.Contracts;

/// <summary>
/// The bridge's release as <c>health.bridgeVersion</c> and the relay <c>hello</c> report it (openspec
/// ide-identity-report 2.3, design D3) — ONE reading, so the two cannot disagree.
///
/// <para>A release build is stamped by <c>build-cli.ps1</c> from <c>VOLT_VERSION</c>, and its file version is what
/// <c>volt --version</c> prints. An unstamped build keeps the SDK default <c>1.0.0.0</c> on every file, so the shared
/// number names nothing; its <c>ProductVersion</c> carries the commit the SDK appends (<c>1.0.0+&lt;commit&gt;</c>),
/// and that is what tells two dev builds apart. The six PLCAssist bundles measured on 2026-10-03 are four builds that
/// the assembly version and a bare <c>(dev)</c> would each report as one value.</para>
///
/// <para>The file read is the bridge's OWN (the caller passes its assembly's <c>Location</c>), never
/// <c>Environment.ProcessPath</c>: inside CODESYS the process is <c>CODESYS.exe</c> (DIALECT V4).</para>
/// </summary>
public static class BridgeRelease
{
    /// <summary>The release of the file at <paramref name="path"/>, or null when it cannot be read — then
    /// <paramref name="unreadable"/> names why, for the start log. A packaging fault worth seeing; never a reason to
    /// stop serving.</summary>
    public static string? Of(string? path, out string? unreadable)
    {
        unreadable = null;
        if (string.IsNullOrEmpty(path))
        {
            unreadable = "the bridge assembly has no file location";
            return null;
        }
        try
        {
            var info = FileVersionInfo.GetVersionInfo(path);
            return From(info.FileVersion, info.ProductVersion);
        }
        catch (Exception e)
        {
            unreadable = $"{path}: {e.GetType().Name}: {e.Message}";
            return null;
        }
    }

    /// <summary>D3 over the two version-info strings: the stamped file version verbatim; else <c>(dev) &lt;commit&gt;</c>
    /// from the product version's suffix after <c>+</c>; a bare <c>(dev)</c> only when it states no commit.
    /// "Stamped" is the sentinel <c>volt --version</c> uses: a file version other than <c>1.0.0.0</c> / <c>0.0.0.0</c>.</summary>
    public static string From(string? fileVersion, string? productVersion)
    {
        var file = fileVersion?.Trim();
        if (!string.IsNullOrEmpty(file) && file != "1.0.0.0" && file != "0.0.0.0") return file!;
        var plus = productVersion?.IndexOf('+') ?? -1;
        var commit = plus >= 0 ? productVersion!.Substring(plus + 1).Trim() : "";
        return commit.Length > 0 ? "(dev) " + commit : "(dev)";
    }
}
