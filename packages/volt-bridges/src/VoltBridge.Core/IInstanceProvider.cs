namespace VoltBridge.Core
{
    /// <summary>
    /// Optional capability: an adapter that can enumerate the IDE instances/projects
    /// it could attach to (e.g. TwinCAT's running DTE instances via the ROT). Served
    /// at <c>GET /instances</c>; adapters that don't implement it report no instances.
    /// Returns a JSON-serializable shape (the server serializes the runtime type), so
    /// Core need not know each vendor's instance model.
    /// </summary>
    public interface IInstanceProvider
    {
        object ListInstances();
    }
}
