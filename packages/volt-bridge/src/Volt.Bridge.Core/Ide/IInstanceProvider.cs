namespace Volt.Bridge.Core.Ide;

/// <summary>Optional driver capability: enumerate attachable IDE instances/projects for the connector's
/// picker (TwinCAT's running-object table). Returned as <see cref="object"/> so Core needn't know the
/// vendor's instance DTO. Drivers without multi-instance attach simply don't implement it.</summary>
public interface IInstanceProvider
{
    object ListInstances();
}
