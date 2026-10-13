using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Volt.Ide.Twincat;

/// <summary>
/// <c>VoltTwincatExplorer --ide-dir &lt;dir&gt; --xae-pid &lt;pid&gt; --plc-project &lt;name&gt;</c>: reads the PLC project's
/// Solution Explorer node of that XAE and writes it to stdout as JSON (<c>null</c> when the hierarchy has no such node).
/// <c>--check --ide-dir &lt;dir&gt;</c>: answers only whether this process can unmarshal the hierarchy interfaces, with no
/// call into XAE. Exit 0 = done; <see cref="ProxyMissing"/> = the proxy is absent for this bitness (stderr names the
/// call and its HRESULT); <see cref="Failed"/> = any other failure (stderr says what). The worker's side is
/// <c>TcHierarchy</c>, which owns the contract on both ends.
/// </summary>
internal static class ExplorerProgram
{
    private const int Ok = 0, Failed = 1, ProxyMissing = 2;

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        var ideDir = Arg(args, "--ide-dir");
        try
        {
            if (Array.IndexOf(args, "--check") >= 0)
            {
                var (hr, what) = TcSolutionExplorer.ProxyCheck(ideDir);
                if (hr == 0) return Ok;
                Console.Error.Write($"{what} failed (0x{hr:X8})");
                return TcSolutionExplorer.IsProxyMissing(hr) ? ProxyMissing : Failed;
            }
            if (!int.TryParse(Arg(args, "--xae-pid"), out var pid) || Arg(args, "--plc-project") is not { } plcProject)
            {
                Console.Error.Write("usage: VoltTwincatExplorer --ide-dir <dir> --xae-pid <pid> --plc-project <name> | --check --ide-dir <dir>");
                return Failed;
            }
            ComMessageFilter.Register();
            var dte = RotInstances.BindByPid(pid);
            if (dte is null) { Console.Error.Write($"no running TwinCAT XAE with pid {pid} in the Running Object Table"); return Failed; }
            var node = TcSolutionExplorer.ReadPlcProject(dte, plcProject, ideDir);
            var json = new StringBuilder();
            Write(json, node);
            Console.Out.Write(json.ToString());
            return Ok;
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            return ex is COMException com && TcSolutionExplorer.IsProxyMissing(com.HResult) ? ProxyMissing : Failed;
        }
    }

    private static string? Arg(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static void Write(StringBuilder s, ExplorerNode? node)
    {
        if (node is null) { s.Append("null"); return; }
        s.Append("{\"name\":"); Str(s, node.Name);
        s.Append(",\"canonical\":"); Str(s, node.Canonical);
        s.Append(",\"caption\":"); Str(s, node.Caption);
        s.Append(",\"unread\":"); Str(s, node.Unread);
        s.Append(",\"children\":[");
        for (var i = 0; i < node.Children.Count; i++)
        {
            if (i > 0) s.Append(',');
            Write(s, node.Children[i]);
        }
        s.Append("]}");
    }

    private static void Str(StringBuilder s, string? v)
    {
        if (v is null) { s.Append("null"); return; }
        s.Append('"');
        foreach (var c in v)
            switch (c)
            {
                case '"': s.Append("\\\""); break;
                case '\\': s.Append("\\\\"); break;
                default:
                    if (c < 0x20) s.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else s.Append(c);
                    break;
            }
        s.Append('"');
    }
}
