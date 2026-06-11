using VoltBridge.Codesys.Adapters;
using VoltBridge.Core.Http;

var adapter = new CodesysAdapter();
adapter.Connect();
BridgeServer.Run(adapter, "VoltBridge CODESYS", 8556);
