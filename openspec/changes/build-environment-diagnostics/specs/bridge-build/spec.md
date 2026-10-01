## ADDED Requirements

### Requirement: an environment problem is marked as one

A build diagnostic caused by the IDE environment rather than the project's code (a library that could not be opened or resolved) SHALL carry `category: "environment"`, and the build result SHALL list each such library once with its reason. Code diagnostics SHALL be unaffected.

#### Scenario: library not installed
- **WHEN** a build reports that library 'CmpOPCUAClient Implementation, 3.5.19.10' has not been installed to the system
- **THEN** that diagnostic has `category: "environment"`, the build result lists the library and reason once, and any code errors in the same build keep their own diagnostics

#### Scenario: localized IDE
- **WHEN** the same build runs in a CODESYS with a non-English UI
- **THEN** the diagnostic is still marked `environment`
