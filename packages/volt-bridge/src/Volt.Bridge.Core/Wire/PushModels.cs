using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Bridge.Core.Wire;

public class PushRequest
{
    [JsonPropertyName("ops")]
    public List<PushOp> Ops { get; set; } = new();

    [JsonPropertyName("expectedProjectVersion")]
    public string? ExpectedProjectVersion { get; set; }
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "op")]
[JsonDerivedType(typeof(PushItemOp), "pushItem")]
[JsonDerivedType(typeof(DeleteItemOp), "deleteItem")]
[JsonDerivedType(typeof(RenameItemOp), "renameItem")]
[JsonDerivedType(typeof(MoveItemOp), "moveItem")]
public class PushOp
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("ifVersion")]
    public string? IfVersion { get; set; }
}

public class PushItemOp : PushOp
{
    [JsonPropertyName("folder")]
    public string? Folder { get; set; }

    [JsonPropertyName("sourceText")]
    public string? SourceText { get; set; }
}

public class DeleteItemOp : PushOp
{
}

public class RenameItemOp : PushOp
{
    [JsonPropertyName("newName")]
    public string? NewName { get; set; }
}

public class MoveItemOp : PushOp
{
    [JsonPropertyName("newFolder")]
    public string? NewFolder { get; set; }
}

public class PushConflict
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("yourVersion")]
    public string? YourVersion { get; set; }

    [JsonPropertyName("currentVersion")]
    public string? CurrentVersion { get; set; }

    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";
}

public class PushResponse
{
    [JsonPropertyName("accepted")]
    public bool Accepted { get; set; }

    [JsonPropertyName("newProjectVersion")]
    public string? NewProjectVersion { get; set; }

    [JsonPropertyName("newItems")]
    public Dictionary<string, string>? NewItems { get; set; }

    [JsonPropertyName("conflicts")]
    public List<PushConflict>? Conflicts { get; set; }

    [JsonPropertyName("currentProjectVersion")]
    public string? CurrentProjectVersion { get; set; }

    public static PushResponse AcceptedResult(string newProjectVersion, Dictionary<string, string> newItems) =>
        new() { Accepted = true, NewProjectVersion = newProjectVersion, NewItems = newItems };

    public static PushResponse RejectedResult(List<PushConflict> conflicts, string currentProjectVersion) =>
        new() { Accepted = false, Conflicts = conflicts, CurrentProjectVersion = currentProjectVersion };
}
