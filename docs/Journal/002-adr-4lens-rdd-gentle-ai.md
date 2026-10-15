---
id: ADR-002
title: 4-Lens RDD Architecture, Deterministic Receipts & Gentle AI Symbiosis
date: 2026-10-15
status: accepted
lens: architecture
tags: [rdd, 4-lenses, gentle-ai, engram, receipts, governance]
---

# ADR 002: 4-Lens RDD Architecture, Deterministic Receipts & Gentle AI Symbiosis

## Status
Accepted

## Context
CLC Kernel originally executed audit scripts sequentially and emitted a flat terminal output. As projects scale and interact with multi-agent orchestration frameworks like **Gentle AI** and memory engines like **Engram**, audits need to be segmented across standard review dimensions, produce machine-readable cryptographic receipts, and allow standalone operation with seamless upgradeability.

## Decision
1. **4 Canonical RDD Lenses Taxonomy:** Categorize all 30 safeguards in `SAFEGUARD_CATALOG` (`src/catalog.js`) into the 4 Canonical Review Lenses:
   - `correctness`: TDD Red/Green, Scope authorization, contract parsing, typechecking, test coverage.
   - `security`: Secret scanning, container posture, broker & cache isolation.
   - `architecture`: Clean/Hexagonal layer boundaries, component reuse, symlinks, HITL review checkpoints, domain state integrity, migration safety.
   - `performance`: ORM N+1 query prevention, Core Web Vitals, tree-shaking, responsive breakpoints, calendar synchronization.
2. **Deterministic Audit Receipt (`audit-receipt.json`):** Both `tools/audit.js` and `tools/audit.py` generate an immutable, machine-readable audit receipt in `sdds/{active-sdd}/audit-receipt.json`.
3. **Gentle AI Graceful Handover:** Operates 100% standalone with zero dependencies. When the `gentle-ai` binary is detected, it validates the receipt and hands over to deep adversarial LLM review without re-running deterministic AST checks.
4. **Engram Knowledge Schema:** Standardize ADR frontmatter in `docs/Journal/` so Engram can ingest architectural decisions into its knowledge graph directly.

## Consequences
- Developers get instant (<10ms) deterministic feedback segmented by review lens.
- Zero external dependencies required for standalone usage.
- 100% forward-compatible with Gentle AI (RDD) and Engram (MCP).
