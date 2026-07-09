using System.Collections.Generic;

namespace Volt.Bridge.Connector
{
    /// <summary>A PLC project inside a TwinCAT solution (mirrors the bridge wire shape).</summary>
    public sealed record TcProjectDto(string Project, List<string> PlcProjects);

    /// <summary>A running TwinCAT instance the bridge could attach to.</summary>
    public sealed record TcInstanceDto(string InstanceId, string? IdeName, string? IdeVersion, string? Solution, List<TcProjectDto> Projects);

    /// <summary>Which instance/project the user picked. Pushed to the worker as VOLT_TC_* env.</summary>
    public sealed record TcTarget(string? Instance, string? Project, string? PlcProject);
}
