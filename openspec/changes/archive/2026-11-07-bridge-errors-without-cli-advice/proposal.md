## Why

A bridge's refusal text reaches an AI that serves someone using the bridge, not the Volt CLI. Some refusals tell that
reader to run a CLI command or use a CLI concept, which they cannot do:

- `StReader.cs:1062`: "Run `volt pull` once to rewrite the workspace in the current format."
- `PushService.cs:258`, `InterfaceAccessorGuard.cs:48`, `BodyFormatGuard.cs:78`: "... in the IDE and pull."

Seen in PLC Assist production on 0.1.18312: a model created a POU with no `%LANGUAGE` line and got the `volt pull`
advice (chat 863aadc5), and a task patch was told to "Change it in the IDE and pull" (chat a2518a33). There is no pull
to run: a bridge user has no workspace, and the next read already returns the current text. For the missing `%LANGUAGE`
line the real fix is to state that line.

## What Changes

- Refusals say what is wrong with the text and what to change in the text, or what to do in the IDE. They name no CLI
  command and no workspace step unless the caller is the CLI.
- Either the wording becomes caller-neutral, or the CLI adds its own hint where it prints the error. Volt's choice.

## Impact

Refusal messages only; codes and behaviour are unchanged. Tests that match the old wording move with it, including
`packages/volt-cli/scripts/mixed-version-lib.ts:80`. PLC Assist does not rewrite these texts on its side (bridge gaps are
fixed in the bridge), and it needs a release of this to pick it up.
