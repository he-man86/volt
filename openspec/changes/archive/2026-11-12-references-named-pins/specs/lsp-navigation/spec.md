## ADDED Requirements

### Requirement: references of a global asked at its declaration
References, rename and definition at a variable's name in a global variable list's declaration SHALL resolve that
variable, never the list that declares it.

#### Scenario: a global's declaration
- **WHEN** references run at `PE1` in `Scene.gvl` declaring `PE1 : BoxPhotoEye;`
- **THEN** the result is the declaration of `PE1` and every use of `PE1` and `Scene.PE1`, and not the list `Scene`

### Requirement: a call's named pins are references of the member
References and rename of a function block's input or output SHALL include every call that names it as an argument
(`fb(In := x)`, `fb(Out => y)`) in ST and in network bodies, a marked output's name part (`Out_INVERTED => y`) and a box
output read through its call (`fb(…).Out`).

#### Scenario: an input named in a call
- **WHEN** rename runs at `Velocity` in `FUNCTION_BLOCK BoxBeltConveyor` to `Speed`, and Main has `Infeed(Velocity := 0.4);`
- **THEN** Main reads `Infeed(Speed := 0.4);`

#### Scenario: a marked output in a network
- **WHEN** rename runs at `Active` in `FUNCTION_BLOCK BoxPhotoEye` to `On`, and an LD network has `AND(PE1(Active_INVERTED => y), TRUE);`
- **THEN** the network reads `AND(PE1(On_INVERTED => y), TRUE);`

#### Scenario: a box output read through its call
- **WHEN** rename runs at `Active` to `On`, and a network has `ASSIGN(PE1().Active, Q_INVERTED => y);`
- **THEN** the network reads `ASSIGN(PE1().On, Q_INVERTED => y);`
