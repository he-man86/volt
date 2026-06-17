using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace Volt.Bridge.Connector
{
    /// <summary>A PLC project inside a TwinCAT solution (mirrors the bridge wire shape).</summary>
    public sealed record TcProjectDto(string Project, List<string> PlcProjects);

    /// <summary>A running TwinCAT instance the bridge could attach to.</summary>
    public sealed record TcInstanceDto(string InstanceId, string? IdeName, string? IdeVersion, string? Solution, List<TcProjectDto> Projects);

    /// <summary>Which instance/project the user picked. Pushed to the worker as VOLT_TC_* env.</summary>
    public sealed record TcTarget(string? Instance, string? Project, string? PlcProject);

    /// <summary>Reads the bridge's <c>GET /instances</c> over HTTP — the connector stays
    /// COM-free; the bridge does the ROT enumeration.</summary>
    internal static class InstanceProbe
    {
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(2) };

        public static async Task<List<TcInstanceDto>> FetchAsync(int port)
        {
            try
            {
                var json = await Http.GetStringAsync($"http://127.0.0.1:{port}/instances").ConfigureAwait(false);
                var env = JsonSerializer.Deserialize<Envelope>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return env?.Instances ?? new List<TcInstanceDto>();
            }
            catch { return new List<TcInstanceDto>(); }
        }

        private sealed class Envelope { public List<TcInstanceDto>? Instances { get; set; } }
    }
}
