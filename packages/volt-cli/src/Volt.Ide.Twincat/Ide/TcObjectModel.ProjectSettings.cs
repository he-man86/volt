using System.IO;
using Volt.Engine.Format.Settings;

namespace Volt.Ide.Twincat;

internal sealed partial class TcObjectModel
{
    /// <summary>The PLC project's compiler settings (openspec <c>twincat-project-settings</c>), read afresh on every
    /// call: the NestedProject's <c>ProduceXml()</c> for the three live rows, and the <c>.plcproj</c> — found through the
    /// PLC project item's own <c>PlcProjectDef/ProjectPath</c> — for the disabled warnings, which nothing on the
    /// automation interface exposes (DIALECT D37, D38). The translation is <see cref="TcProjectSettings"/>.
    ///
    /// <para>No catch: an unreadable <c>.plcproj</c> or a faulting COM call fails this item's read, which the walk's
    /// consumers turn into one named unreadable item — never into a descriptor with the warnings row missing, which
    /// would make the LSP report every disabled warning again.</para></summary>
    public ProjectSettings ReadProjectSettings()
    {
        var nested = ProduceXml(PlcRoot());          // EnsurePlc: _plcNode is the PLC project item (TIPC^<plc>)
        var path = TcProjectSettings.ProjectPath(ProduceXml(_plcNode!));
        return TcProjectSettings.Read(File.ReadAllText(path), nested);
    }
}

/// <summary>The handle of the synthesized <c>Project Settings</c> item. TwinCAT has no tree node for the compiler
/// settings (they live on the PLC project's property pages), so the walk names one the way the CODESYS walk finds its
/// <c>IWorkspaceObject</c> node, and this marker routes its kind, name and manifest; it is never handed to COM.</summary>
internal sealed class TcProjectSettingsNode
{
    public static readonly TcProjectSettingsNode Instance = new();
    private TcProjectSettingsNode() { }
    public override string ToString() => ProjectSettingsFormat.ItemName;
}
