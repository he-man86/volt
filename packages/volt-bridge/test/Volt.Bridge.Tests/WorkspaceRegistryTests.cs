using System;
using System.IO;
using System.Text.Json;
using Volt.Bridge.Core;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>The connector-side reader of the reverse workspace registry. Feeds it the EXACT JSON
/// `volt-git/src/config/registry.ts` writes, so a shape drift between the TS writer and this C# reader fails
/// here. (Parallelism is disabled assembly-wide, so the process-wide VOLT_REGISTRY_DIR override is safe.)</summary>
public class WorkspaceRegistryTests
{
    [Fact]
    public void Resolves_the_most_recent_workspace_for_a_port_from_the_TS_shape()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-reg-" + Guid.NewGuid().ToString("N"));
        var a = Directory.CreateDirectory(Path.Combine(dir, "a")).FullName;
        var b = Directory.CreateDirectory(Path.Combine(dir, "b")).FullName;
        Environment.SetEnvironmentVariable("VOLT_REGISTRY_DIR", dir);
        try
        {
            File.WriteAllText(Path.Combine(dir, "workspaces.json"), $@"[
              {{ ""root"": {J(a)}, ""port"": 8556, ""platform"": ""codesys"", ""projectName"": ""Old"", ""lastSeen"": ""2026-07-12T10:00:00Z"" }},
              {{ ""root"": {J(b)}, ""port"": 8556, ""platform"": ""codesys"", ""projectName"": ""New"", ""lastSeen"": ""2026-07-12T12:00:00Z"" }}
            ]");
            Assert.Equal(b, WorkspaceRegistry.Resolve(8556));        // most recently seen on the port
            Assert.Equal(a, WorkspaceRegistry.Resolve(8556, "Old")); // project-filtered
            Assert.Null(WorkspaceRegistry.Resolve(8555));            // wrong port
        }
        finally
        {
            Environment.SetEnvironmentVariable("VOLT_REGISTRY_DIR", null);
            try { Directory.Delete(dir, true); } catch { }
        }
    }

    [Fact]
    public void A_missing_or_dead_entry_is_never_resolved()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-reg-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        Environment.SetEnvironmentVariable("VOLT_REGISTRY_DIR", dir);
        try
        {
            // a registry pointing at a workspace that doesn't exist on disk
            File.WriteAllText(Path.Combine(dir, "workspaces.json"),
                $@"[{{ ""root"": {J(Path.Combine(dir, "gone"))}, ""port"": 8556, ""platform"": ""codesys"", ""projectName"": ""X"", ""lastSeen"": ""2026-07-12T10:00:00Z"" }}]");
            Assert.Null(WorkspaceRegistry.Resolve(8556)); // root missing → skipped
            Assert.Empty(WorkspaceRegistry.Known());
        }
        finally
        {
            Environment.SetEnvironmentVariable("VOLT_REGISTRY_DIR", null);
            try { Directory.Delete(dir, true); } catch { }
        }
    }

    private static string J(string s) => JsonSerializer.Serialize(s); // JSON-escape (Windows backslashes)
}
