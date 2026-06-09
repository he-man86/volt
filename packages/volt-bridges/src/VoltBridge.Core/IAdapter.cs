namespace VoltBridge.Core;

public interface IAdapter
{
    string ReadDeclaration(dynamic item);
    string ReadImplementation(dynamic item);
    int GetItemType(dynamic item);
    int GetChildCount(dynamic item);
    dynamic GetChildAt(dynamic parent, int index);
    string? ExportItemBodyAsXml(dynamic item, string itemName);
    string ComputeItemVersion(dynamic item, string folderPath);
}
