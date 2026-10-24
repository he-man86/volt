using System;
using Volt.Contracts;

namespace Volt.Engine;

/// <summary>An <see cref="BridgeErrorCodes.Unsupported"/> refusal that is also a <see cref="NotSupportedException"/>: the
/// IDE, or a documented Volt limit on a vendor shape, will not take what was sent.
///
/// <para>Most refusals are a <see cref="BridgeException"/>. This one exists for the code paths that ROUTE on a vendor
/// "cannot" — the TwinCAT in-place network write falls back to the native builder on one, and a body the strict writer
/// cannot spell reads as "changed" — so the refusal keeps the <see cref="NotSupportedException"/> those catches name,
/// and carries its code itself: the code comes from the throw, never from the type at the wire (openspec
/// <c>wire-final-shape</c> step 3c). <c>UnrepresentableBodyException</c> and <c>ChildRefusedException</c> are of this
/// family.</para></summary>
public class UnsupportedException : NotSupportedException, ICodedError
{
    public UnsupportedException(string message, Exception? inner = null) : base(message, inner) { }

    public string ErrorCode => BridgeErrorCodes.Unsupported;

    public object? ErrorData => null;
}
