## 1. Wording

- [x] 1.1 List every bridge refusal that names `volt pull`, "pull" or the workspace (start from the four in the proposal).
- [x] 1.2 Make each one say what to change in the text or do in the IDE, with no CLI step. The missing `%LANGUAGE` refusal
      says to add the line.
- [x] 1.3 If the CLI still needs its hint, add it where the CLI prints the error. Not needed: every reworded refusal now
      names an edit to the text or a step in the IDE, which a CLI user follows the same way; the CLI's own pull/push advice
      (Volt.Cli Commands.cs) was already added where it prints, from the code.
- [x] 1.4 A test that a refusal served over the bridge pipe holds no `volt ` command: `Volt.Repo.Gates`
      `BridgeRefusalsGiveNoCliAdviceTests` (every string literal under `src/` outside `Volt.Cli`: no `volt <verb>`, no
      "and pull" / "pull again" / "Pull the" / "Pull,").
