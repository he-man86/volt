namespace Volt.Tests.Shared;

/// <summary>
/// THE READ-ONLY PHASE OF PLAIN-ST NETWORK TEXT (openspec <c>network-text-st</c> 2.1): a pull shows an LD/FBD body as plain
/// ST, and a push of one is refused by name (<c>NetworkBodyReader.ReadOnlyReason</c>) until section 3 reads plain ST back.
/// A test whose subject is a push carrying an LD/FBD body cannot run in this phase; it is skipped with this reason, and
/// task 3.1 restores each one, its text re-written in plain ST. Nothing else may use it.
/// </summary>
public static class ReadOnlyNetworkPush
{
    public const string Skip =
        "network-text-st read-only phase (2.1): an LD/FBD body's push is refused by name until 3.1 reads plain ST; 3.1 restores this test in plain ST";
}
