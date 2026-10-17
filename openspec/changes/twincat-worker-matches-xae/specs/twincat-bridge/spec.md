## ADDED Requirements

### Requirement: the TwinCAT worker has the XAE's bitness
The connector SHALL launch the TwinCAT worker of the attached XAE's bitness, which reads the Solution Explorer in-process
with no helper process.

#### Scenario: a 32-bit TcXaeShell
- **WHEN** the connector attaches to TcXaeShell 4024 on a machine without Visual Studio
- **THEN** it launches the x86 worker, and refs, fetch, push and build succeed with no `VoltTwincatExplorer.exe`
