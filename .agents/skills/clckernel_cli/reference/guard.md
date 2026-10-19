# Playbook: Safeguards Management (Create & Remove)

Use this playbook when the user wants to add, modify, or delete a project guard (via `/clc create_guard`, `/clc remove_guard`, or natural language like *"creá un guard para bloquear imports prohibidos"*).

Project guards hold the rules of this project's domain; the kernel ships none. They are project code: never listed in `tools/.clckernel-managed.json`, preserved by `clckernel update`, and evaluated by the other guards like any other file. Put them in `tools/guards/` (any `*.js` / `*.py` name). A guard file at the top of `tools/` whose name starts with `check_`, `scan_` or `verify_` (or ends with `_guard`) and that the registry does not list is a project guard too — for example a kernel guard the kernel no longer ships, which `clckernel update` leaves in place.

## How project guards run

- **One discovery, two entry points:** the pre-commit hook calls `node tools/audit.js --hook` and `python3 tools/audit.py --hook` (each when installed); `clckernel audit` runs the same orchestrators without `--hook`. Both run exactly the same guards — the kernel guards and every project guard — each once, from the repository root. Adding a guard needs no `clckernel update`.
- **Which orchestrator runs which guard:** `audit.js` runs the `.js` guards and `audit.py` the `.py` ones. When a project has only one orchestrator (e.g. a Node stack without `tools/audit.py`), that one also runs the other language's guards (`python3` / `node`).
- **Audit:** the report lists them (architecture lens unless the JSON result names another). `--hook` writes no report: it prints one line per guard and the details of each failure.
- **Contract:** a non-zero exit code blocks the commit and fails the audit. Printing the standard JSON result is optional; when present the audit uses it for the report: `{ "exitCode": 0, "skipped": false, "name": "check_x", "data": { "message": "...", "violations": [{ "file": "...", "message": "..." }] } }` (optional `"lens"`: `correctness`, `security`, `architecture` or `performance`). Plain output is reported by its last line.
- **Snapshot helpers:** evaluate the commit being made, not the working copy. A JS guard imports `require('../_changes')`; a Python guard imports `_changes` after adding the parent directory to `sys.path`. Each helper exists only when the harness installed it (`tools/_changes.js` with JS guards, `tools/_changes.py` with Python guards).

## 🛠️ Create Guard

1. **Clarify Objective:** If not specified, ask what pattern, rule, or risk to intercept. **STOP.** Wait for details.
2. **Write the guard** in `tools/guards/<name>.js` (Node) or `tools/guards/<name>.py` (Python). Only these two extensions run; use the one whose snapshot helper the project has. Minimal working examples:

   ```js
   // tools/guards/check_no_draft_json.js
   const { changedFiles, readFile } = require('../_changes');

   const { mode, files } = changedFiles(process.cwd(), { extensions: ['.json'] });
   const violations = files
     .filter((file) => (readFile(process.cwd(), file, mode) || '').includes('"draft": true'))
     .map((file) => ({ file, message: 'draft data must not be committed' }));
   const exitCode = violations.length > 0 ? 1 : 0;
   console.log(JSON.stringify({ exitCode, skipped: false, name: 'check_no_draft_json', data: { message: `${violations.length} violation(s)`, violations } }));
   process.exit(exitCode);
   ```

   ```python
   # tools/guards/check_no_draft_json.py
   import json, pathlib, sys
   sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
   from _changes import changed_files, read_file

   snapshot = changed_files(".", extensions=[".json"])
   violations = [
       {"file": f, "message": "draft data must not be committed"}
       for f in snapshot["files"]
       if '"draft": true' in (read_file(".", f, snapshot["mode"]) or "")
   ]
   exit_code = 1 if violations else 0
   print(json.dumps({"exitCode": exit_code, "skipped": False, "name": "check_no_draft_json",
                     "data": {"message": f"{len(violations)} violation(s)", "violations": violations}}))
   sys.exit(exit_code)
   ```

3. **Validation:** stage a violating file and run `node tools/guards/<name>.js` (or `python3 tools/guards/<name>.py`): it must exit 1. Stage a compliant one: it must exit 0. Then run `node tools/audit.js` to see it reported.

---

## 🗑️ Remove Guard

1. Identify the target guard from user request or ask for confirmation.
2. Delete the corresponding file from `tools/guards/` (or the top of `tools/`): the hook and the audit stop running it; nothing else to update. A kernel guard listed in `tools/.clckernel-managed.json` cannot be removed by deleting it (the hook fails on a missing kernel guard); exclude it with `update.exclude` in `.clckernel.yaml` instead.
3. Confirm removal cleanly.
