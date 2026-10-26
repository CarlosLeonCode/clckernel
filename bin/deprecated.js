#!/usr/bin/env node
/**
 * CLC Kernel — entry point for the legacy binary names (clc-forge,
 * create-clc-forge). Prints the deprecation notice, then runs the CLI.
 *
 * It is a separate file on purpose: when every bin points to the same file,
 * npx runs the first bin key, and the registry stores the keys sorted, so
 * `npx clckernel` would run as "clc-forge". With distinct targets npx picks
 * the bin named like the package.
 */

process.stderr.write('"clc-forge" is deprecated; use "clckernel"\n');
require('./cli.js');
