<div align="center">
  <img width="350" height="350" alt="clckernel_logo" src="https://github.com/user-attachments/assets/2898e9c1-ec7a-4c60-a6dd-e62c05a0d446" />
</div>

# 🤖 CLC Kernel (`clckernel`)

[![npm version](https://img.shields.io/npm/v/clckernel.svg)](https://www.npmjs.com/package/clckernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English](https://img.shields.io/badge/README-English-blue.svg)](./README.md)

> **El Motor Universal de Gobernanza para Agentes de IA & Orquestador AIUP.**
> Creado por [CarlosLeonCode](https://github.com/carlosleoncode).

Los agentes de IA (Claude, Cursor, Gemini, Copilot) generan código a una velocidad sin precedentes. Sin embargo, sin límites estrictos introducen degradación arquitectónica, tests de falso positivo y deuda técnica invisible. **CLC Kernel** es el arnés de desarrollo definitivo para gobernarlos.

Establece un **Proceso Unificado de IA (AIUP)**—obligando a los LLMs a operar como ingenieros de software disciplinados en cualquier lenguaje de programación (Next.js, FastAPI, Django, Astro, Rails, Go, Rust, Laravel).

---

## 🎯 1. Posicionamiento: Una Nueva Categoría — AI Agent Governance

CLC Kernel **no** es "otro framework de IA" ni una colección de prompts. Define una categoría de ingeniería propia: **Gobernanza Determinística de Agentes de IA (AI Agent Governance)**.

| Categoría de Herramienta | Qué Hace | Dónde se Queda Corta | Ventaja de CLC Kernel |
|---|---|---|---|
| **Reglas de Prompt** (`.cursorrules`, `.mdc`) | Inyecta sugerencias en markdown en el contexto del chat. | **No determinístico:** El LLM las ignora en contextos largos o pedidos rápidos. | Impone **AST Linters nativos** que bloquean físicamente commits no conformes. |
| **Herramientas de Specs** (OpenSpec, Specs en MD) | Documenta especificaciones y requerimientos. | **Estático:** No comprueba tests fallidos ni custodia cambios de código en Git. | Ciclo completo **AIUP:** Spec -> Gate Humano -> TDD Rojo-a-Verde -> AST Guard. |
| **Runtimes de Agentes** (LangGraph, CrewAI) | Construye apps de backend con agentes autónomos. | **Problema distinto:** No gobierna el desarrollo en el repositorio del programador. | **Arnés para Devs:** Se integra nativamente en el flujo diario de tu IDE. |

---

## 🏛️ 2. Pilares Conceptuales del Ecosistema

CLC Kernel se apoya en cinco fundamentos de ingeniería diseñados para erradicar los vicios del "Vibe Coding":

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AI UNIFIED PROCESS (AIUP)                             │
├─────────────┬─────────────┬─────────────┬──────────────────┬────────────────┤
│   1. SDD    │   2. HIT    │   3. TDD    │     4. AST       │   5. MIRROR    │
│ Spec-Driven │ Human-in-the│ Transición  │ Linters de Capas │ Single Source  │
│ Development │    Loop     │ Rojo-a-Verde│  Determinísticos │ of Truth Sync  │
└─────────────┴─────────────┴─────────────┴──────────────────┴────────────────┘
```

### 📝 A. Spec-Driven Development (SDD)
Los agentes sufren del *sesgo de inmediatez*—escribir código antes de entender los requerimientos. CLC Kernel prohíbe la modificación directa: el agente debe primero redactar una especificación técnica local (gitignorada en `sdds/{feature-name}/`) detallando objetivos, capas afectadas y casos borde.

### 🛑 B. Human-in-the-Loop Gate (HIT)
Antes de tocar una sola línea de código en producción, el agente debe presentar escenarios de prueba concretos al desarrollador para su validación y aprobación. **El humano es el Arquitecto/Director; la IA es el Ejecutor.**

### 🧪 C. Test-Driven Development (TDD Rojo-a-Verde)
Los agentes suelen generar "tests tautológicos" que nunca fallan ante bugs reales. CLC Kernel impone TDD genuino: el agente debe escribir un test de regresión que falle primero (Fase Roja) y demostrar el fallo antes de escribir la implementación (Fase Verde).

### 🛡️ D. Salvaguardas AST Determinísticas (Linters Nativos)
Las instrucciones en markdown se olvidan con facilidad. CLC Kernel provisiona linters basados en el Árbol de Sintaxis Abstracta (AST) en el lenguaje nativo del stack (Python `ast`, Go `ast`, RuboCop, PHPStan, TypeScript AST). Estos guardias validan físicamente los cambios y bloquean commits inválidos:
- **📱 Frontend & UX:** Breakpoints mobile-first y touch targets de 44px (`check_responsive`), metadata SEO/tags GEO/prioridad LCP (`check_seo`), accesibilidad ARIA (`check_a11y`), reutilización de primitivas UI (`check_ui_reuse`), optimización de imágenes y tree-shaking (`check_performance`), y contratos Zod (`check_api_contracts`).
- **🏛️ Backend & Arquitectura:** Aislamiento de capas Clean Architecture (`check_architecture`), prevención de queries N+1 en loops (`check_db_efficiency`), idempotencia de migraciones (`check_migrations`), y escaneo de secretos (`scan_secrets`).
- **🤖 Agent-OS & Flujos de Dominio:** Validación de symlinks espejo para IDEs (`check_symlinks`), verificador de checkpoints obligatorios Human-in-the-Loop (`check_hitl`), e integridad de esquemas y estado limpio de métricas (`check_domain_data`).
- **🎯 Proceso & Infraestructura:** Validación de alcance git diff vs SDD (`check_scope`), prueba de transición TDD Rojo-a-Verde (`verify_tdd`), y guardias de tecnologías (`docker_guard`, `celery_guard`, `redis_guard`, `postgres_guard`).

### 🔗 E. Single Source of Truth (SSOT) & Espejado Dinámico (Mirroring)
Mantener archivos de reglas separados para Cursor, Claude, Windsurf, Copilot y Gemini produce desincronización y deriva de contexto. CLC Kernel lo resuelve mediante **Espejado Dinámico**:
- `AGENTS.md` se forja como el **Single Source of Truth** (Única Fuente de Verdad).
- Symlinks multiplataforma proyectan automáticamente `AGENTS.md` hacia:
  - 🧠 `CLAUDE.md` (Claude Desktop / Windsurf)
  - 🌌 `GEMINI.md` (Gemini CLI / Project IDX)
  - 💠 `.cursorrules` & `.cursor/rules/clckernel_context.mdc` (Cursor)
  - ✈️ `.github/copilot-instructions.md` (GitHub Copilot)
  - 🛸 `.antigravity/rules.md` (Antigravity)
- *Editás una sola vez en `AGENTS.md` y todos los IDEs absorben el contexto de forma instantánea y con cero duplicación.*

---

## 💡 3. Por Qué Existe CLC Kernel

Librados a su suerte, los agentes de IA generan **Deuda de Comprensión (Comprehension Debt)**—un código que crece más rápido que la capacidad del equipo de mantener su arquitectura:

<div align="center">
  <img width="900" alt="clckernel_comparison_es" src="https://github.com/user-attachments/assets/4d2e6651-15be-46f6-ae12-c8274b6492ca" />
  <p><em>Izquierda: Agente de IA sin gobernanza — código caótico y alucinado. Derecha: Agente con CLC Kernel AIUP — estructurado, seguro y arquitectónicamente correcto.</em></p>
</div>

- ❌ **Decaimiento Arquitectónico:** Mezclar lógica de rutas con llamadas a la base de datos en lugar de respetar el aislamiento de capas.
- ❌ **Duplicación de UI:** Inventar colores hexadecimales arbitrarios y HTML crudo en lugar de reutilizar los tokens del sistema de diseño.
- ❌ **Tests de Falso Positivo:** Declarar que una feature funciona sin jamás demostrar la transición Rojo-a-Verde.
- ❌ **Fugas de Seguridad:** Commitear accidentalmente API Keys o exponer DTOs privados del backend al cliente.

---

## 🧩 4. Dependencias Deseadas del Ecosistema (Opcionales y Modulares)

CLC Kernel se enfoca estrictamente en **Gobernanza, Proceso y Salvaguardas de Calidad**. Intencionalmente **no** empaqueta un motor de grafos propietario ni una base de datos de persistencia monolítica. En su lugar, delega esas capacidades en herramientas complementarias especializadas (con degradación elegante si no se encuentran instaladas en el entorno):

| Herramienta Complementaria | Rol | Por Qué es Deseada | Comportamiento si no está |
|---|---|---|---|
| 🧠 **[Engram (MCP)](https://github.com/Gentleman-Programming/gentle-ai)** | Memoria de Largo Plazo & ADRs | Preserva el contexto arquitectónico, justificaciones de diseño y memoria entre sesiones de agentes. | Salteo elegante (la auditoría continúa sin persistencia). |
| 🕸️ **[Graphify](https://github.com/carlosleoncode/graphify)** | Grafo de Conocimiento de Código | Genera mapas topológicos y grafos de dependencias para que el agente entienda relaciones arquitectónicas. | Salteo elegante (`verify_memory_graph` pasa como advisory). |
| 🛡️ **[Gentle AI (RDD)](https://github.com/Gentleman-Programming/gentle-ai)** | Gate de Revisión Adversaria | Aplica Review-Driven Development (RDD) con inspección multi-lente antes de commitear cambios. | Salteo elegante (`verify_rdd_review_gate` pasa como advisory). |
| ⚡ **Linters Nativos por Stack** | AST & Seguridad de Tipos | `ruff` (Python), `golangci-lint` (Go), `cargo clippy` (Rust), `phpstan` (PHP), `tsc` (TypeScript). | Utiliza las herramientas CLI instaladas en el entorno local del proyecto. |

---

## 🧠 5. El Paradigma de la CLI Conversacional

CLC Kernel opera tanto en tu terminal como dentro del chat de tu IDE con IA. Al inicializarse, inyecta un **Agentic Playbook (`SKILL.md`)** en tu repositorio, convirtiendo cualquier LLM en un asistente interactivo de gobernanza:

- 🚀 **`clckernel start`**: Detecta tu stack automáticamente, propone un ciclo de gobernanza, y materializa `.clckernel.yaml`.
- 🛠️ **`clckernel create_guard`**: Escribe un linter AST personalizado en el lenguaje nativo de tu stack (`tools/guards/`).
- 🔄 **`clckernel add_phase` / `remove_guard`**: Modifica el ciclo de vida AIUP interactivamente sin editar YAML manualmente.

---

## 🌐 6. Adaptadores Polyglot por Stack

CLC Kernel cuenta con adaptadores dedicados para los principales ecosistemas:

| Ecosistema | Firma de Detección | Test Runner | Salvaguardas Aplicadas |
|---|---|---|---|
| ⚛️ **Next.js** | `next` | Vitest / Jest | Reutilización de UI, Tokens Semánticos, Reglas RSC, Zod, A11y, Responsive, SEO, Performance |
| ⚡ **FastAPI** | `fastapi` | Pytest | Pydantic V2, Idempotencia Alembic, AST Arquitectura Limpia, Eficiencia DB (N+1) |
| 💎 **Rails** | `Gemfile` | RSpec | AST RuboCop, Seguridad Brakeman, Idempotencia de Migraciones |
| 🐹 **Golang** | `go.mod` | `go test` | AST `golangci-lint`, Arquitectura Domain/UseCase |
| 🦀 **Rust** | `Cargo.toml` | `cargo test` | AST `cargo clippy`, `cargo audit`, Seguridad de Memoria Estricta |
| 🐘 **Laravel** | `artisan` | Pest / PHPUnit | AST PHPStan, Detección de N+1 Eloquent, Migraciones |
| 🎸 **Django** | `manage.py` | `pytest-django` | Idempotencia ORM Django, AST Ruff, Scope Guard, Eficiencia DB (N+1) |
| 🚀 **Astro** | `astro.config` | Playwright | Tokens Tailwind v4, Content Collection Schema, A11y, Responsive, SEO |
| 🤖 **Agent-OS** | `skills/`, `brand/`, `templates/`, `agent-os` | Playbook / Contract Test | AGENTS.md Dual, Checkpoints HITL (`check_hitl`), Symlinks IDE (`check_symlinks`), Integridad de Datos (`check_domain_data`), Secretos (`scan_secrets`) |

---

## ⚡ 7. Guía Paso a Paso (Ciclo de Vida Completo)

```
[1. Terminal]           [2. Chat del LLM]            [3. Bucle TDD]                [4. Git Commit]
npx clckernel   ───►   clckernel start   ───►   "Feature X con harness"   ───►   Hooks Pre-commit
(Bootstrap)            (Setup Interactivo)          (SDD -> HIT -> Tests)         (Guardián AST & Secretos)
```

### 1️⃣ Paso 1: Inicializar el Repositorio (Terminal)
```bash
npx clckernel
```
Detecta tu framework, genera `AGENTS.md`, crea symlinks dinámicos para todos los IDEs, provisiona hooks pre-commit (`.husky/` o `.githooks/`) y crea herramientas AST en `tools/`.

### 2️⃣ Paso 2: Abrir tu IDE con IA e Inicializar (CLI Conversacional)
Abrí Cursor, Claude Code, Gemini CLI, Windsurf o Copilot y escribí:
> `clckernel start`
El agente escanea tu código en silencio, propone un plan de gobernanza AIUP adaptado a tu stack y genera `.clckernel.yaml`.

### 3️⃣ Paso 3: Desarrollar con el Arnés AIUP
Al pedir una funcionalidad o corrección, activá el workflow:
> *"Agregá el endpoint de autenticación. **Usá el workflow / harness**."*
El agente ejecuta de forma autónoma el ciclo de 10 pasos: **SDD Spec -> Gate HIT -> TDD Rojo-a-Verde -> Implementación Limpia -> Auditoría AST**.

### 4️⃣ Paso 4: Verificación Determinística de Guards (Commit)
```bash
git add .
git commit -m "feat(auth): add user authentication endpoint"
```
Los hooks pre-commit ejecutan escáneres AST automáticos (Clean Architecture, Fuga de Secretos, Scope Guard, Idempotencia de Migraciones). Cualquier violación bloquea el commit de inmediato.

### 5️⃣ Paso 5: Auditar la Salud del Repositorio en Cualquier Momento (Terminal)
```bash
npx clckernel doctor
```
Ejecuta el **CLC Kernel Doctor** para verificar el 100% de cumplimiento en `AGENTS.md`, `sdds/`, `tools/` y hooks de Git.

