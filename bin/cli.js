#!/usr/bin/env node
/**
 * CLC Kernel — Executable Binary Entry Point
 * Invokes the main controller module for CLC Kernel.
 */

const { runCli } = require('../src/index');

runCli().catch((err) => {
  console.error('\n❌ Error ejecutando clckernel:', err);
  process.exit(1);
});
