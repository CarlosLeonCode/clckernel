# Playbook: Safeguards Management (Create & Remove)

Use this playbook when the user wants to add, modify, or delete custom architecture/security guards (via `/clc create_guard`, `/clc remove_guard`, or natural language like *"creá un guard para bloquear imports prohibidos"*).

## 🛠️ Create Guard

1. **Clarify Objective:** If not specified, ask what AST node, pattern, or security risk to intercept. **STOP.** Wait for details.
2. **Native Language Implementation:** Write the guard script in the native stack language:
   - Python projects -> Python `ast` script in `tools/guards/<name>_guard.py`
   - Node / TS projects -> JS/TS script in `tools/guards/<name>_guard.js`
   - Go projects -> Go `go/parser` / `ast` script
   - Ruby projects -> Ruby `parser` gem script
3. **Register in Config:** Add the guard definition under `custom_safeguards` or `tools` in `.clckernel.yaml`.
4. **Validation:** Run the script against test fixtures to confirm it flags violations and exits cleanly on compliant code.

---

## 🗑️ Remove Guard

1. Identify the target guard from user request or ask for confirmation.
2. Update `.clckernel.yaml` removing the guard entry.
3. If requested, delete the corresponding file from `tools/guards/`.
4. Confirm removal cleanly.
