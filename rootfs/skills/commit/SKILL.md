---
name: commit
description: Create a git commit with the current changes
---

Create a git commit for the current staged changes. Follow these steps:

1. Run `git status` to see what files have changed
2. Run `git diff --staged` to review staged changes. If nothing is staged, stage relevant modified files with `git add`
3. Run `git log --oneline -5` to see recent commit message style
4. Write a concise commit message that follows the repository's style
5. Create the commit with `git commit -m "message"`
6. Show the result with `git log --oneline -1`
