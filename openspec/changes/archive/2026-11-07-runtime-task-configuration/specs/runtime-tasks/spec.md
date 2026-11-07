## ADDED Requirements

### Requirement: the TypeScript `.task` format matches the C# format byte for byte
`readTask` and `writeTask` SHALL accept and produce exactly what C# `TaskDescriptorFormat` accepts and produces, and SHALL refuse what it refuses, naming the line.

#### Scenario: corpus round trip
- **WHEN** every `.task` file in `test-corpus` is read and written back in TypeScript
- **THEN** the bytes equal the input and equal what the C# writer gives for the same settings

#### Scenario: an unknown field
- **WHEN** a `.task` holds `Intervall: t#10ms`
- **THEN** `readTask` refuses it naming line and label, as the C# reader does

### Requirement: a task runs its calls through one entry
The transpiled application SHALL expose one entry per task that runs the task's `Calls:` PROGRAMs in the stated order, on shared globals, once per call.

#### Scenario: two tasks
- **WHEN** `Fast.task` calls `A` and `Slow.task` calls `B, C`, and the host calls `runTask("Slow")`
- **THEN** `B` runs, then `C`, and `A` does not run

#### Scenario: no task configuration
- **WHEN** a project holds no `.task`
- **THEN** one implicit task calls the main program, and the runtime behaves as before this change

### Requirement: task configuration errors are diagnostics
The build SHALL report an error for a `Calls:` name that is not a PROGRAM and for an interval that is not a TIME, and a warning for a PROGRAM called by two tasks.

#### Scenario: a missing program
- **WHEN** `MainTask.task` says `Calls: Mian`
- **THEN** the build reports an error on that `.task` naming `Mian`
