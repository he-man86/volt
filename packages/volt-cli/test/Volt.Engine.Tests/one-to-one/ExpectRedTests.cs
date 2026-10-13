using System;
using Volt.Engine.Format.Task;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// The red mark itself (<see cref="ExpectRed"/>): red only for the reason a red body states — an assertion that does not
/// hold yet, or the one product exception the mark names — so a body that breaks for ANY other reason (a slip in the
/// test, an index past the end, a NullReference) fails the suite instead of passing as "still red" forever.
/// </summary>
public class ExpectRedTests
{
    [Fact]
    public void An_assertion_that_does_not_hold_is_the_red()
    {
        ExpectRed.Until("x", "an assertion", () => Assert.Equal(1, 2));
        Assert.IsAssignableFrom<Xunit.Sdk.XunitException>(ExpectRed.LastRed);
    }

    [Fact]
    public void Any_other_exception_is_not_the_red_and_fails_the_test()
    {
        Assert.Throws<NullReferenceException>(() =>
            ExpectRed.Until("x", "a slip in the test", () => throw new NullReferenceException()));
        Assert.Throws<IndexOutOfRangeException>(() =>
            ExpectRed.Until("x", "a slip in the test", () => { var a = new int[0]; _ = a[1]; }));
    }

    [Fact]
    public void A_mark_may_name_the_product_exception_that_is_its_red()
    {
        ExpectRed.Until<TaskDescriptorException>("x", "a parse the format does not take yet",
            "'External event' is not a task field",
            () => throw new TaskDescriptorException("line 4: 'External event' is not a task field."));
        Assert.Throws<InvalidOperationException>(() =>
            ExpectRed.Until<TaskDescriptorException>("x", "another failure", "'Core' is not a task field",
                () => throw new InvalidOperationException()));
    }

    /// <summary>Review fix (gate step 2): the named product exception is the red only for the REASON the finding names —
    /// the same exception type thrown for another reason (a label written twice, a missing <c>Type:</c>, another unknown
    /// label) propagates, so a mark cannot stay red for a reason its finding does not name.</summary>
    [Fact]
    public void The_named_exception_is_the_red_only_for_the_reason_the_mark_names()
    {
        Assert.Throws<TaskDescriptorException>(() =>
            ExpectRed.Until<TaskDescriptorException>("3.1", "finding 4: 'Core' has no label", "'Core' is not a task field",
                () => throw new TaskDescriptorException("line 2: 'Type' is written twice (first on line 1)")));
        Assert.Throws<TaskDescriptorException>(() =>
            ExpectRed.Until<TaskDescriptorException>("3.1", "finding 4: 'Core' has no label", "'Core' is not a task field",
                () => throw new TaskDescriptorException("line 5: 'Core2' is not a task field.")));
    }

    /// <summary>Review fix (environment-dependency-audit gate 1): an assertion is the red only for the reason the mark
    /// names, when it names one — a CLI test red because git is missing must not stay red once git is there and the
    /// verb fails for another reason.</summary>
    [Fact]
    public void An_assertion_is_the_red_only_for_the_reason_the_mark_names()
    {
        ExpectRed.Until("2.1", "no git", "start process 'git'",
            () => Assert.True(false, "volt pull exit 1: An error occurred trying to start process 'git' …"));
        Assert.Throws<Xunit.Sdk.TrueException>(() =>
            ExpectRed.Until("2.1", "no git", "start process 'git'",
                () => Assert.True(false, "volt pull exit 2: the pipe 'volt.bridge.x' is not there")));
        Assert.Throws<StaleRedMarkException>(() => ExpectRed.Until("2.1", "fixed", "anything", () => { }));
    }

    [Fact]
    public void A_body_that_passes_fails_the_mark()
    {
        Assert.Throws<StaleRedMarkException>(() => ExpectRed.Until("x", "fixed", () => { }));
        Assert.Throws<StaleRedMarkException>(() =>
            ExpectRed.Until<TaskDescriptorException>("x", "fixed", "anything", () => { }));
    }
}
