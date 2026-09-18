# Playbook: Start / Initialize CLC Kernel

Use this playbook when the user wants to initialize, start, or set up governance in a project (via `/clc start`, `/clckernel start`, or conversational request like *"inicializar el proyecto con clc"*).

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
1. Summarize detected architecture and auto-provisioned safeguards (e.g., TDD Red/Green, AST architecture guard, DB efficiency, secrets scan, tech-specific guards).
2. Ask one clear question:
   - *"¿Activamos estas fases y salvaguardas estándar, o querés personalizar alguna regla o fase?"*
3. **STOP.** Wait for the user's response.

### Phase 3: Materialization
1. Write or update `.clckernel.yaml` at project root.
2. If hooks are configured, ensure `.githooks/pre-commit` or `.husky/pre-commit` are provisioned.
3. Confirm completion with a concise summary.
