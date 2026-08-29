// Minimal test runner for npx tsx compatibility
// Run with: npx tsx --tsconfig tsconfig.json <test-file.ts>

import assert from "node:assert/strict";

export { assert };

let _passed = 0;
let _failed = 0;
let _suiteName = "";

export function suite(name: string): void {
  _suiteName = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}\n`);
}

export function test(name: string, fn: () => void | Promise<void>): void {
  const label = _suiteName ? `${_suiteName} › ${name}` : name;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          _passed++;
          console.log(`  ✅  ${name}`);
        })
        .catch((err: unknown) => {
          _failed++;
          console.error(`  ❌  ${name}`);
          console.error(`       ${String(err)}`);
        });
    } else {
      _passed++;
      console.log(`  ✅  ${name}`);
    }
  } catch (err) {
    _failed++;
    console.error(`  ❌  ${name}`);
    console.error(`       ${String(err)}`);
  }
  void label;
}

process.on("exit", () => {
  const total = _passed + _failed;
  console.log(`\n${"─".repeat(60)}`);
  if (_failed === 0) {
    console.log(`✅  ${_passed}/${total} tests passed`);
  } else {
    console.error(`❌  ${_failed} test(s) failed  (${_passed}/${total} passed)`);
    process.exitCode = 1;
  }
});
