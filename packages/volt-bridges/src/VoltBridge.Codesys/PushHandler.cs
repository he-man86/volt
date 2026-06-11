using VoltBridge.Core;
using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Codesys;

public static class PushHandler
{
    public static PushResponse Handle(Adapters.CodesysAdapter adapter, PushRequest request)
    {
        if (!adapter.IsConnected) throw ErrorResponse.PlcDisconnectedException();
        return PushResponse.RejectedResult(
            new List<PushConflict> { new PushConflict { Name = "<project>", Reason = "not yet implemented" } },
            "");
    }
}
