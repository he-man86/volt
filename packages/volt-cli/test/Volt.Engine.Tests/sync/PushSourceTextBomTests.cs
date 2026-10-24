using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// AN ITEM'S TEXT IS UTF-8 TEXT, AND A BYTE-ORDER MARK IS NONE OF IT (wire-final-shape 4.3b, PLC Assist's read/edit suite
/// 2026-10-24): a <c>sourceText</c> that starts with U+FEFF is an encoding artifact of the client's file, and it was
/// stored into the IDE as the declaration's first character on both vendors (measured live, CODESYS 3.5.22.40). It is
/// refused BAD_REQUEST in the pre-flight, naming the op, as a request frame that starts with a BOM is — the client strips
/// it — and nothing of the push lands.
/// </summary>
public class PushSourceTextBomTests
{
    private const string Fb = "FUNCTION_BLOCK Motor\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n";

    [Theory]
    [InlineData(true)]    // a create
    [InlineData(false)]   // an update
    public void A_source_text_starting_with_a_BOM_is_refused_BAD_REQUEST_and_nothing_lands(bool create)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Motor", "FUNCTION_BLOCK Motor\nVAR\n\tx : INT;\nEND_VAR", "x := 0;"));
        var refs = RefsService.Handle(ide);
        var name = create ? "Other.pou" : "Motor.pou";
        var text = "﻿" + (create ? Fb.Replace("Motor", "Other") : Fb);

        var r = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = name, IfVersion = create ? null : refs.Items[name], SourceText = text },
            },
        });

        var conflict = Assert.Single(r.Conflicts);
        Assert.Equal((name, BridgeErrorCodes.BadRequest), (conflict.Name, conflict.Code));
        Assert.Contains("U+FEFF", conflict.Reason);
        Assert.Null(r.NewProjectVersion);
        Assert.Equal(refs.Items, RefsService.Handle(ide).Items);
    }
}
