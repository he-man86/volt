## ADDED Requirements

### Requirement: Library signatures materialize under the Library Manager, not a separate tree

Referenced-library public signatures SHALL materialize INTO the mirrored CODESYS tree — each element under
its owning library's folder in the Library Manager (`…/Library Manager/<LibraryName>/<Element>.<kind>`),
co-located with that library's `.library` stub — NOT into a separate `libs/` tree. Files SHALL use the same
kind-based extensions as project source (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`)
and contain declarations/signatures only (no implementation bodies). They SHALL be **read-only**: never a
push target, never reconciled to the IDE. They are committed and change only when a referenced library is
added, removed, or version-bumped.

#### Scenario: A library element is a kind-named signature file in its library's folder
- **WHEN** the `L_MC4P` library exposes a struct `AxesGroup`
- **THEN** it materializes at `…/Library Manager/L_MC4P_MotionControlCam/AxesGroup.struct` (beside `L_MC4P_MotionControlCam.library`), containing only its declaration, and is not editable or pushable

#### Scenario: Library signatures are never pushed
- **WHEN** a push is computed
- **THEN** no library signature file is included — they are a read-only library mirror, not project source
