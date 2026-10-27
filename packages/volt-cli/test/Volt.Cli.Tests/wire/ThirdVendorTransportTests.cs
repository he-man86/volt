using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Volt.Engine.Host;
using Volt.Engine.Seam;
using Volt.Engine.Sync;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// THE THIRD TEST VENDOR OVER THE PIPE (openspec <c>volt-cli-rework</c> design step 4, spec "a new vendor is one IDE
/// host"): <see cref="Fakeco"/> — outside the CODESYS family, no NWL, no numeric kind code, its own kinds, language,
/// property keys and file layout — implements ONLY the new contract, and the existing transport (refs / fetch / push /
/// build over a named pipe, the way <see cref="FakeIde"/> is driven) serves it as itself (<see cref="HostLink.Of(IVendorDriver)"/>).
/// </summary>
public class ThirdVendorTransportTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    private const string MotorPath = "Station1/Blocks/Motor.blk";
    private const string SpeedPath = "Station1/Types/Speed.typ";
    private const string StationPath = "Station1/Station1.stn";
    private const string MotorText = "BLOCK Motor\nIN start\nOUT lamp\n%LANGUAGE FKL\nlamp = start\n";

    private static (Fakeco Ide, BridgePipeHost Host, PipeClient Client) Serve()
    {
        var ide = new Fakeco();
        var pipe = Pipe();
        var link = HostLink.Of(ide);
        link.RefreshHealth();   // what a host's start does, on its IDE thread right after its connect
        var host = new BridgePipeHost(link, pipe);
        host.Start();
        return (ide, host, new PipeClient(pipe));
    }

    private static Dictionary<string, string> Items(JsonElement response) =>
        response.GetProperty("items").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!);

    private static object Push(string projectVersion, params Dictionary<string, object?>[] ops) => new
    {
        expectedPlatform = Fakeco.Id,
        expectedProjectName = "Plant",
        expectedProjectVersion = projectVersion,
        ops,
    };

    private static Dictionary<string, object?> Set(string name, string? ifVersion, string text) =>
        new() { ["op"] = "set", ["name"] = name, ["ifVersion"] = ifVersion, ["sourceText"] = text };

    [Fact]
    public void Refs_lists_the_vendors_own_kinds_by_path_and_its_application()
    {
        var (_, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");

            Assert.Equal(new[] { MotorPath, StationPath, SpeedPath }, Items(refs).Keys.OrderBy(k => k, StringComparer.Ordinal));
            Assert.Equal(new[] { "Station1" }, refs.GetProperty("applications").EnumerateArray().Select(a => a.GetString()));
        }
    }

    [Fact]
    public void Fetch_answers_each_item_in_its_vendors_own_file_layout()
    {
        var (_, host, client) = Serve();
        using (host)
        {
            var fetch = client.Call("fetch", new { knownItems = new Dictionary<string, string>(), knownApplications = Array.Empty<string>() });
            var texts = fetch.GetProperty("changed").EnumerateArray()
                .ToDictionary(c => c.GetProperty("name").GetString()!, c => c.GetProperty("sourceText").GetString()!);

            Assert.Equal(MotorText, texts[MotorPath]);
            Assert.Equal("TYPE Speed\nFIELD rpm\n", texts[SpeedPath]);
            Assert.Equal("station Station1\ncycle 10ms\n", texts[StationPath]);
        }
    }

    /// <summary>F4 (design "Step 4 findings"): a key the vendor DECLARED crosses the engine both ways — pushed, it reaches
    /// the host as that property; fetched, the file spells it again.</summary>
    [Fact]
    public void A_declared_property_key_crosses_the_pipe_both_ways()
    {
        var (ide, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");
            const string retained = "%RETAIN\n%NOTE 'main drive'\nBLOCK Motor\nIN start\nOUT lamp\n%LANGUAGE FKL\nlamp = start\n";

            var result = client.Call("push", Push(refs.GetProperty("projectVersion").GetString()!,
                Set(MotorPath, Items(refs)[MotorPath], retained)));

            Assert.True(result.TryGetProperty("newProjectVersion", out _) && result.GetProperty("conflicts").GetArrayLength() == 0, result.ToString());
            Assert.Equal(new[] { "%RETAIN", "%NOTE 'main drive'" }, ide.At("Station1/Blocks/Motor")!.Properties.Items.Select(p => p.ToString()));
            var fetch = client.Call("fetch", new { knownItems = new Dictionary<string, string>(), knownApplications = Array.Empty<string>() });
            Assert.Equal(retained, fetch.GetProperty("changed").EnumerateArray()
                .Single(c => c.GetProperty("name").GetString() == MotorPath).GetProperty("sourceText").GetString());
        }
    }

    [Fact]
    public void Push_updates_creates_into_a_new_folder_and_deletes_through_the_new_contract()
    {
        var (ide, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");
            var items = Items(refs);
            const string edited = "BLOCK Motor\nIN start\nOUT lamp\n%LANGUAGE FKL\nlamp = start AND NOT stop\n";
            const string created = "BLOCK Pump\nIN run\n%LANGUAGE FKL\nrun = run\n";

            var result = client.Call("push", Push(refs.GetProperty("projectVersion").GetString()!,
                Set(MotorPath, items[MotorPath], edited),
                Set("Station1/Blocks/Aux/Pump.blk", null, created),
                new Dictionary<string, object?> { ["op"] = "deleteItem", ["name"] = SpeedPath, ["ifVersion"] = items[SpeedPath] }));

            Assert.True(result.TryGetProperty("newProjectVersion", out _) && result.GetProperty("conflicts").GetArrayLength() == 0, result.ToString());
            Assert.Equal("lamp = start AND NOT stop\n", ide.At("Station1/Blocks/Motor")!.Body!.Code);
            Assert.Equal(Fakeco.Fkl, ide.At("Station1/Blocks/Aux/Pump")!.Body!.Language);
            Assert.Equal(NodeRole.Folder, ide.At("Station1/Blocks/Aux")!.Class.Role);
            Assert.Null(ide.At("Station1/Types/Speed"));

            var after = client.Call("fetch", new { knownItems = new Dictionary<string, string>(), knownApplications = Array.Empty<string>() });
            var texts = after.GetProperty("changed").EnumerateArray()
                .ToDictionary(c => c.GetProperty("name").GetString()!, c => c.GetProperty("sourceText").GetString()!);
            Assert.Equal(edited, texts[MotorPath]);
            Assert.Equal(created, texts["Station1/Blocks/Aux/Pump.blk"]);
            Assert.False(texts.ContainsKey(SpeedPath));
            // The receipt names what the push did: the two items it wrote at their new versions, the one it deleted.
            var now = Items(after);
            Assert.Equal(new[] { MotorPath, "Station1/Blocks/Aux/Pump.blk" }.ToDictionary(p => p, p => now[p]),
                         result.GetProperty("newItems").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString()!));
            Assert.Equal(new[] { SpeedPath }, result.GetProperty("removed").EnumerateArray().Select(r => r.GetString()));
        }
    }

    [Fact]
    public void A_body_in_a_language_the_vendor_does_not_show_is_refused_by_name_before_any_write()
    {
        var (ide, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");
            var result = client.Call("push", Push(refs.GetProperty("projectVersion").GetString()!,
                Set(MotorPath, Items(refs)[MotorPath], "BLOCK Motor\n%LANGUAGE ST\nlamp := start;\n")));

            Assert.False(result.TryGetProperty("newProjectVersion", out _), result.ToString());   // nothing landed
            var conflict = Assert.Single(result.GetProperty("conflicts").EnumerateArray().ToList());
            Assert.Equal("INVALID_ST", conflict.GetProperty("code").GetString());
            Assert.Contains("shows no ST body (it shows FKL)", conflict.GetProperty("reason").GetString());
            Assert.Equal("lamp = start\n", ide.At("Station1/Blocks/Motor")!.Body!.Code);
        }
    }

    [Fact]
    public void An_extension_no_host_registered_is_a_BAD_REQUEST_naming_it()
    {
        var (_, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");
            var result = client.Call("push", Push(refs.GetProperty("projectVersion").GetString()!,
                Set("Station1/Blocks/Valve.xyz", null, "x")));

            Assert.False(result.TryGetProperty("newProjectVersion", out _), result.ToString());   // nothing landed
            var conflict = Assert.Single(result.GetProperty("conflicts").EnumerateArray().ToList());
            Assert.Equal("BAD_REQUEST", conflict.GetProperty("code").GetString());
            Assert.Contains("Valve.xyz", conflict.GetProperty("reason").GetString());
        }
    }

    /// <summary>A CODESYS-family extension pushed to a non-family bridge names no kind THIS bridge declared, so it is the
    /// same BAD_REQUEST as any unknown extension. Red today: the old engine's kind table is process-wide and hardcoded, so
    /// <c>.pou</c> reaches the IEC reader and the host (design "Step 4 findings", F3); step 5 builds the process's
    /// catalog from its host's declaration alone.</summary>
    [Fact]
    public void A_family_extension_is_a_BAD_REQUEST_on_a_bridge_that_did_not_declare_it()
    {
        var (_, host, client) = Serve();
        using (host)
        {
            var refs = client.Call("refs");
            var result = client.Call("push", Push(refs.GetProperty("projectVersion").GetString()!,
                Set("Station1/Blocks/Valve.pou", null, "FUNCTION_BLOCK Valve\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n")));

            var conflict = Assert.Single(result.GetProperty("conflicts").EnumerateArray().ToList());
            Assert.Equal("BAD_REQUEST", conflict.GetProperty("code").GetString());
        }
    }

    [Fact]
    public void Build_names_a_diagnostic_by_the_items_path()
    {
        var (ide, host, client) = Serve();
        using (host)
        {
            ide.At("Station1/Blocks/Motor")!.Body = BodyText.Shown(Fakeco.Fkl, "lamp = start\nlamp = ??\n");

            var build = client.Call("build", new { expectedPlatform = Fakeco.Id, expectedProjectName = "Plant" });

            Assert.False(build.GetProperty("success").GetBoolean());
            var d = Assert.Single(build.GetProperty("diagnostics").EnumerateArray().ToList());
            Assert.Equal(MotorPath, d.GetProperty("name").GetString());
            // The line of the item's fetched text that holds the fault (wire-final-shape 3.6b), not the vendor's count.
            var text = client.Call("fetch", new { onlyItems = new[] { MotorPath } }).GetProperty("changed")[0].GetProperty("sourceText").GetString()!;
            Assert.Equal(Array.IndexOf(text.Split('\n'), "lamp = ??") + 1, d.GetProperty("line").GetInt32());
        }
    }

    [Fact]
    public void Health_reports_the_vendors_own_row()
    {
        var (_, host, client) = Serve();
        using (host)
        {
            var row = Assert.Single(client.Call("health").GetProperty("projects").EnumerateArray().ToList());
            Assert.Equal(Fakeco.Id, row.GetProperty("vendor").GetString());
            Assert.Equal("Plant", row.GetProperty("project").GetString());
        }
    }
}
