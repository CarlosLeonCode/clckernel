---
change: decision-log
date: 2026-11-06T18:58:00Z
---

# decision-log

## Context
The reasons behind each change lived in the change's SDD folder, which is gitignored, and in the
local memory of the agent that did the work. Another machine, person or agent cloning the repository
had no record of why the code is the way it is. Install and update already create `docs/Journal/`,
which held only two numbered ADRs.

## Decision
- One short Markdown entry per audited SDD change, committed with it:
  `docs/Journal/<YYYY>/<YYYYMMDDTHHMMZ>-<change>.md` (UTC), frontmatter `change` and `date`, and the
  sections Context, Decision, Alternatives and Consequences, at most `journal.max_lines` (80) lines.
- `clckernel journal <change> [targetDir]` creates the entry from a template. The change name follows
  the `audit --change` rule; a change that already has an entry is refused.
- The optional `check_journal` guard (JS only, `since: 2.3.0`, adopted with
  `update --add-guards check_journal`) blocks a commit when a receipt of `audit --change` names the
  current HEAD and that change has no entry in the index or in HEAD. Receipts of other commits are
  ignored, so adopting it asks nothing for past changes. It validates the staged entries under the
  year folders and leaves the numbered ADRs alone.
- The `journal` key of `.clckernel.yaml` (`dir`, `max_lines`) is validated by the JS and Python
  config readers alike.
- The feature, fix and commit playbooks tell the agent to read the year's entries during research
  and to create and commit the entry after the audit.

## Alternatives
- A committed index of entries: rejected, every branch would edit it and conflict on merge.
- Guessing the active change from the newest SDD folder, as the scope guard does: rejected as fragile;
  the receipt's commit hash names the change being committed.
- Generating the entry from the spec: rejected, specs are free text; the human or the agent writes it.
- Enforcing it in CI: not possible, the receipts are local; without the SDD folder the guard skips.

## Consequences
- An audited change cannot be committed without its entry where the guard is installed; the record is
  in the repository, readable by any agent that lists the year folder.
- The guard is local only: a commit made without an audit, or on a machine without the SDD folder, is
  not checked.
- A catalog `since` may now be the next minor of the package version, so `update` lists a guard as new
  before its release.
