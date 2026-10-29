## ADDED Requirements

### Requirement: A box is a call; `.ENO` and `.NAME` state its handed-on output

Network text SHALL spell every box as one call of its toolbox name (an FB: its instance, `t1(…)`, or its type where it has none; the Execute box:
`EXECUTE`, its ST the string pin `CODE`).
Where the callee declares no `EN`, `EN :=` SHALL mean EN shown; where it declares no `ENO`, a box showing ENO SHALL
close its call with `.ENO`, also at a root. A consumed box without ENO and with several data outputs SHALL close its
call with `.NAME`, the output its consumer reads. A declared `EN` or `ENO` is an ordinary pin.

#### Scenario: an FB chains a named output
- **WHEN** a TON box whose consumer reads `Q` is pulled
- **THEN** it reads `x := AND(t1(IN := a, PT := T#1S).Q, b);`

#### Scenario: EN and ENO stated independently
- **WHEN** a MOVE box shows EN and ENO and stands at a root
- **THEN** it reads `MOVE(EN := c, 1, OUT => y).ENO;`, and the same box without ENO reads `MOVE(EN := c, 1, OUT => y);`

#### Scenario: Execute is a call, its ST a string
- **WHEN** an Execute box showing EN, its ST two lines, is pulled
- **THEN** it reads `EXECUTE(EN := c, CODE := 'IF a THEN` / `n := n + 1; END_IF');`, its line break as it stands, a `'` in
  its ST written `$'` and a `$` written `$$`; read by a consumer, `ok := EXECUTE(EN := c, CODE := '…');` (its one output,
  its ENO), and no member closes its call

### Requirement: Any other member is refused by name

A push SHALL refuse by name `.X` on a box with one data output, `.X` naming no data output, `.X` other than `.ENO` on a
box showing ENO or at a root, `.OUT` or `OUT =>` on a function declaring a `VAR_OUTPUT` named `OUT`, and, until a build
route is measured, `.NAME` on a function naming a `VAR_OUTPUT`.

#### Scenario: a member with no alternative is refused
- **WHEN** a pushed text writes `.Q` on an FB that declares one output, or `.OUT` on a function without `VAR_OUTPUT`s
- **THEN** the push refuses it by name and the network is untouched

### Requirement: An unresolved callee is refused at a push, never guessed

A push SHALL refuse by name a box whose reading needs its callee's declaration (flag or declared pin, `.NAME` required
or refused, a consumed FB's one output) when no declaration in reach states it. The post-push comparison, which holds
no project, SHALL compare both texts read as written and refuse nothing for an unresolved callee.

#### Scenario: an unresolved callee after a landed push
- **WHEN** the CLI compares a pushed body holding `w1(EN := TRUE, …).ENO` (`w1 : WSM;`) with the IDE's text of it, with
  no declaration of `WSM` in reach
- **THEN** both texts are read as written and the push is not reported as diverging

#### Scenario: an unresolved callee at a push
- **WHEN** a pushed body closes a call with `.ENO` and no declaration in reach states the callee
- **THEN** the push refuses the box by name and the network is untouched

### Requirement: A root's stored moved pin is counted when a rebuild loses it

A root box's stored `MainOutputIndex` other than its first output, which no text spells, SHALL be named by the
rebuild-loss warning when a rebuild does not give it back.

#### Scenario: an edited network holding a root moved pin
- **WHEN** a push rebuilds a network whose root box stores `MainOutputIndex` 1 and the rebuilt box does not
- **THEN** the push's rebuild-loss warning names `MainOutputIndex`
