## ADDED Requirements

### Requirement: an empty pin value is refused in a network
The network check SHALL refuse an empty value at a box pin or EN in a network body (`t1(IN := , PT := T#1S)`,
`MOVE(EN := , 1, OUT => n)`) and an empty output binding (`ET => `) by name, with the bridge reader's wording, since an unconnected pin is left out
and the rail is `RAIL()`; an empty positional argument (`f(a, , b)`) stays an ST parse error.

#### Scenario: the editor's old rail spelling
- **WHEN** a network body holds `t1(IN := , PT := T#1S);`
- **THEN** the LSP reports a network-plain-st error on the empty value naming the forms the text has
