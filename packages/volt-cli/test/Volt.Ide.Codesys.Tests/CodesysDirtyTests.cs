using System.Linq;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// <c>dirty</c> IS WHAT <c>ScriptProject.dirty</c> ANSWERS, AND NOTHING WHEN IT ANSWERS NOTHING (openspec
    /// <c>wire-final-shape</c> 3.3, measured in 2.5): the row's <c>dirty</c> was <c>false</c> whenever the primary project
    /// had no such member (<c>is bool b &amp;&amp; b</c>), so a client read "saved" from a project the IDE said nothing
    /// about. Absent now, never filled.
    /// </summary>
    public class CodesysDirtyTests
    {
        public sealed class Projects { public Projects(object primary) => this.primary = primary; public object primary { get; } }

        public sealed class SavedState
        {
            public SavedState(bool dirty) => this.dirty = dirty;
            public string path => @"C:\p\Line.project";
            public bool dirty { get; }
        }

        /// <summary>A primary project whose object states no <c>dirty</c> member.</summary>
        public sealed class NoDirtyMember
        {
            public string path => @"C:\p\Line.project";
        }

        private static Volt.Contracts.ProjectEntry Row(object primary) =>
            Assert.Single(new CodesysDriver(new Projects(primary)).ProbeProjects().Rows);

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void The_row_states_dirty_as_the_project_answers(bool dirty)
        {
            var row = Row(new SavedState(dirty));
            Assert.Equal("Line", row.Project);
            Assert.Equal(dirty, row.Dirty);
        }

        [Fact]
        public void A_project_that_states_no_dirty_member_gives_the_row_none() =>
            Assert.Null(Row(new NoDirtyMember()).Dirty);
    }
}
