using VoltBridge.Codesys.Adapters;
using VoltBridge.Codesys.Http;

var adapter = new CodesysAdapter();
adapter.Connect();
BridgeServer.Run(adapter, "VoltBridge CODESYS", 8556);
