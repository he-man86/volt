## ADDED Requirements

### Requirement: A body is written through its language's codec, never through a "graphical" branch

The write path SHALL dispatch on the body's LANGUAGE, resolved from the pushed text, and SHALL NOT
branch on any boolean meaning "is this graphical". Each language SHALL own where its element lives
inside `<body>`, how it decodes to workspace text, how it encodes back, and whether it can be written
at all. Read-only-ness and element placement SHALL remain independent properties: SFC is read-only and
a direct `<body>` child, CFC is read-only and `addData`-nested, FBD is writable and direct.

A write SHALL be refused when the pushed language differs from the one present in the IDE, or when the
one present is read-only. A body element recording no language DECISION — a blank `<ST>`, which is what
a freshly created POU carries whatever language it will hold — SHALL count as no body, so establishing
a language on it is an ordinary create rather than a mismatch. An EMPTY element of any other language
SHALL NOT count as absent.

#### Scenario: A declaration edit lands on a graphical POU
- **WHEN** a push changes the declaration of a POU whose body is FBD
- **THEN** the declaration change reaches the IDE and the diagram is unchanged

#### Scenario: Establishing a diagram on a freshly created POU is not a mismatch
- **WHEN** a POU is created (so its body is a blank `<ST>`) and the same push carries network text
- **THEN** the push is accepted and the POU becomes FBD

#### Scenario: Overwriting a diagram with ST is refused, naming both languages
- **WHEN** a push carries ST for a POU whose body in the IDE is FBD
- **THEN** the push is refused, the item is byte-identical afterwards, and the reason names FBD and ST

#### Scenario: An IL body is refused as a language mismatch
- **WHEN** a push carries ST for a POU whose body is IL
- **THEN** it is refused by the body writer with a message naming IL — not by an unrelated guard

### Requirement: Every writable kind reaches the IDE as ONE document

On a driver that writes a POU as a single PLCopen document, EVERY writable kind — program, function,
function block, interface, DUT and GVL — SHALL be written that way: one `CreateChild` for a create and
one `WriteXml` for the content, with members, accessors, declaration and body all in that document. No
per-child `CreateChild`/`WriteText` and no orphan-deletion walk SHALL run alongside it.

Where kinds differ is document SHAPE, which SHALL be read from the document itself rather than passed
in: a POU's members live in per-member `addData/data` wrappers, an interface's in `Methods`/`Properties`
containers, and a DUT/GVL has none. An interface and its members SHALL carry no `<body>`.

#### Scenario: A create costs two IDE calls for every kind
- **WHEN** an item of any writable kind is created with members
- **THEN** exactly `CreateChild` + `WriteXml` reach the IDE — no per-member calls

#### Scenario: Code pushed to a kind with no body is refused
- **WHEN** a push carries implementation text for a DUT, GVL or interface
- **THEN** it is refused; a push carrying none is accepted and writes nothing

#### Scenario: An interface property reaches the IDE
- **WHEN** an interface is pushed with a method and a GET-only property
- **THEN** both exist in the IDE afterwards, the property has a getter and no setter
