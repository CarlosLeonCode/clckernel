#!/usr/bin/env node
/**
 * CLC Kernel — Executable Binary Entry Point
 * Invokes the main controller module for CLC Kernel.
 */

const path = require('path');
const { runCli } = require('../src/index');

// Binary names from before the rename: still installed, removed in the next major.
const DEPRECATED_BIN_NAMES = new Set(['clc-forge', 'create-clc-forge']);
const invokedAs = path.basename(process.argv[1] || '').replace(/\.(js|cmd)$/i, '');
if (DEPRECATED_BIN_NAMES.has(invokedAs)) {
  process.stderr.write('"clc-forge" is deprecated; use "clckernel"\n');
}

runCli().catch((err) => {
  console.error('\n❌ Error ejecutando clckernel:', err);
  process.exit(1);
});
