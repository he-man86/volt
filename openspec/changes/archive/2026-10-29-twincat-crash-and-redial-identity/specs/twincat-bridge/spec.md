## ADDED Requirements

### Requirement: a dead XAE fails the walk by name
When the TwinCAT XAE stops answering during a tree walk (RPC 0x800706BA / 0x800706BE), the walk SHALL stop at that call
and fail as `PLC_DISCONNECTED`, naming the call that failed and the last that returned.

#### Scenario: the XAE crashes mid-walk
- **WHEN** a `refs` walk meets an RPC failure on a child
- **THEN** no further COM call is made, and the op fails by name with the failing and the last returned call
