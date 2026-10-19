# Playbook: Start / Initialize CLC Kernel

Use this playbook when the user wants to initialize, start, or set up governance in a project (via `/clc start`, `/clckernel start`, or conversational request like *"inicializar el proyecto con clc"*).
It is also the playbook offered in the first session after install (AGENTS.md, "First session after install").

## Sequence

### Phase 1: Silent Discovery
1. Inspect project root files without asking. Look for signatures:
   - `package.json` -> Next.js / Astro / Node
   - `requirements.txt` / `pyproject.toml` -> FastAPI / Django
   - `go.mod` -> Go
   - `Cargo.toml` -> Rust
   - `Gemfile` -> Rails
   - `composer.json` -> Laravel
   - `Dockerfile`, `docker-compose.yml`, `redis.conf`, `celery.py` -> Secondary tech stack
2. **Rule:** Never guess the tech stack. Inspect the actual repository files.

### Phase 2: Interactive Alignment
Present detected stack and proposal clearly:
1. Summarize detected architecture and auto-provisioned safeguards (e.g., Red→Green TDD verifier on FastAPI/Django, architecture guard, N+1 heuristic, secrets scan, tech-specific guards).
2. Ask one clear question:
   - *"¿Activamos estas fases y salvaguardas estándar, o querés personalizar alguna regla o fase?"*
3. **STOP.** Wait for the user's response.

### Phase 3: Materialization
1. If the harness is not installed (no `AGENTS.md` / `tools/audit.js` / `tools/audit.py`), run
   `npx clckernel . --yes` (`--dry-run` first to show the plan). The CLI writes the guards, the
   pre-commit hook (`.githooks/pre-commit`, or `.husky/pre-commit` when Husky already runs the
   repository's hooks), the playbooks and the IDE mirrors. Never write the hook by hand.
2. `.clckernel.yaml` is optional: without it every default applies. Write keys only when the user
   chose a customization, only with the keys the README "Configuration" table lists (`rules`,
   `exclude_paths`, `mirrors`, `hitl`, `update`, `tdd`, `severities`) and only what differs from the
   defaults.
3. If the user keeps the defaults, write a `.clckernel.yaml` that holds only a comment (for example
   `# CLC Kernel: defaults accepted. Add keys only for settings that differ.`). It parses to the
   defaults and ends the first-session onboarding, so the question is not asked again.
4. Confirm completion with a concise summary.
