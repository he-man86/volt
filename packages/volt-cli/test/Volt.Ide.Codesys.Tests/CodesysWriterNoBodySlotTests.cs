using System;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A GRAPHICAL BODY AT AN OBJECT WITH NO IMPLEMENTATION ASPECT IS A NAMED UNSUPPORTED, NOT A VOLT BUG (openspec
/// <c>bridge-refusal-review</c> 2.21).
///
/// <para>The object the IDE hands out has no <c>Implementation</c>: it holds no body, so there is nowhere to write the
/// networks. That is a fact about the target, not a broken invariant of Volt's — it answered
/// <c>InvalidOperationException</c>, which the push reports as <c>INTERNAL_ERROR</c>. It is a
/// <see cref="NotSupportedException"/> now, which the push reports as <c>UNSUPPORTED</c>.</para>
/// </summary>
public class CodesysWriterNoBodySlotTests
{
    [Fact]
    public void A_graphical_body_at_an_object_with_no_Implementation_is_unsupported()
    {
        var body = new NetworkBody(BodyLanguage.Fbd, Array.Empty<Network>());

        var ex = Assert.Throws<NotSupportedException>(() => CodesysNetworkWriter.Write(new object(), body, NetworkScope.Empty));

        Assert.Contains("Implementation", ex.Message);
        Assert.Contains("graphical body", ex.Message);
    }
}
