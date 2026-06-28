## 1. Implementation (shipped)

- [x] 1.1 IDE-as-remote model (`refs/remotes/volt/ide`) reconciled by native `git merge`
- [x] 1.2 `pull`/`push` on committed HEAD + auto-commit; `status`/diff read the working tree
- [x] 1.3 `.git/volt` sidecar; port resolution; one declarative push wire (`ifVersion` guards)
- [x] 1.4 Tested mock + live (CODESYS 8556 / TwinCAT 8555)

## 2. Review + capture

- [x] 2.1 Verify the committed-HEAD + remote-branch + view-follows-working-tree contracts (D11)
- [x] 2.2 Author `specs/ide-sync/spec.md`
- [x] 2.3 `openspec validate review-ide-sync`
