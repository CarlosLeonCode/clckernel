# 🧪 Playbook: \`clckernel test\`

Execute the repository test suite within the native environment runner.

## Mandatory Execution Protocol

### Step 1: Detect Test Runner
1. Inspect \`.clckernel.yaml\` or project files to identify the configured test runner:
   - Node: \`npm test\` / \`vitest\` / \`jest\`
   - Python: \`pytest\`
   - Go: \`go test ./...\`
   - Ruby: \`bundle exec rspec\`
   - Rust: \`cargo test\`
   - PHP: \`vendor/bin/pest\` / \`phpunit\`

### Step 2: Run Tests
1. Execute the test command.
2. If tests fail:
   - Provide clear failure tracebacks.
   - Propose fixing through the \`clckernel fix\` protocol.
3. If tests pass:
   - Confirm green test status (exit code 0).
