using System;

namespace Volt.Engine.Sync;

/// <summary>A push refused from its ops alone, before anything is read or written — always <c>BAD_REQUEST</c>,
/// naming the op. Raised by the op-shape passes <c>PushService.Handle</c> runs first (a name that is no wire name,
/// <see cref="DutSubtypeChanges"/>), which is what makes "nothing written" true of it.</summary>
internal sealed class PushRefusal : Exception
{
    internal PushRefusal(string opName, string message) : base(message) => OpName = opName;
    internal string OpName { get; }
}
