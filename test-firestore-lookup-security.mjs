import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rules = await readFile(new URL("./firestore.rules", import.meta.url), "utf8");

function matchBlock(collectionName) {
  const pattern = new RegExp(
    `match\\s+\\/${collectionName}\\/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
    "m"
  );
  return rules.match(pattern)?.[1] || "";
}

test("admission-number lookup documents are server-only", () => {
  const block = matchBlock("admissionNumbers");
  assert.ok(block, "admissionNumbers rule block should exist");
  assert.match(block, /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/);
  assert.doesNotMatch(block, /allow\s+get\s*:\s*if\s+true/);
  assert.doesNotMatch(block, /allow\s+create\s*:/);
});

test("phone lookup documents are server-only", () => {
  const block = matchBlock("phones");
  assert.ok(block, "phones rule block should exist");
  assert.match(block, /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/);
  assert.doesNotMatch(block, /allow\s+get\s*:\s*if\s+true/);
  assert.doesNotMatch(block, /allow\s+create\s*:/);
});

test("existing user and test-attempt protections remain present", () => {
  assert.match(rules, /match\s+\/users\/\{userId\}/);
  assert.match(rules, /allow\s+read\s*:\s*if\s+isOwner\(userId\)/);
  assert.match(rules, /match\s+\/testAttempts\/\{attemptId\}/);
  assert.match(rules, /validAttemptControlUpdate\(\)/);
  assert.match(rules, /validAttemptSessionMigration\(\)/);
});
