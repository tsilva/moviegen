import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockfile = readFileSync("pnpm-lock.yaml", "utf8");

function lockedVersions(packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^  ['"]?${escaped}@([^:\\s('"\\)]+)(?:\\([^)]*\\))?['"]?:`,
    "gm",
  );
  return [...new Set([...lockfile.matchAll(pattern)].map((match) => match[1]))].sort();
}

test("formerly vulnerable dependency families stay on patched releases", () => {
  assert.deepEqual(lockedVersions("@babel/core"), ["7.29.7"]);
  assert.deepEqual(lockedVersions("brace-expansion"), ["1.1.21", "5.0.12"]);
  assert.deepEqual(lockedVersions("js-yaml"), ["4.3.2"]);
  assert.deepEqual(lockedVersions("nanoid"), ["3.3.18", "3.3.19"]);
  assert.deepEqual(lockedVersions("next"), ["16.3.6"]);
  assert.deepEqual(lockedVersions("postcss"), ["8.5.23", "8.5.26"]);
  assert.deepEqual(lockedVersions("sharp"), ["0.35.5"]);
  assert.deepEqual(lockedVersions("vite"), ["8.2.1"]);
});

test("the complete dependency graph has no known vulnerabilities", () => {
  const audit = JSON.parse(
    execFileSync("pnpm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }),
  );

  assert.deepEqual(audit.metadata.vulnerabilities, {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  });
});

test("dependency sources are registry-only and age protected", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
    for (const specifier of Object.values(dependencies ?? {})) {
      assert.doesNotMatch(specifier, /^(?:git(?:\+|:)|https?:|file:|link:|workspace:)/i);
    }
  }

  const importers = lockfile.slice(lockfile.indexOf("importers:"), lockfile.indexOf("packages:"));
  assert.doesNotMatch(importers, /specifier:\s*(?:git\+|github:|https?:|file:|link:|workspace:)/);

  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  assert.match(workspace, /^minimumReleaseAge: 10080$/m);
  assert.match(workspace, /^blockExoticSubdeps: true$/m);

  const npmrc = readFileSync(".npmrc", "utf8");
  assert.match(npmrc, /^minimum-release-age=10080$/m);
  assert.match(npmrc, /^block-exotic-subdeps=true$/m);
  assert.match(npmrc, /^ignore-scripts=true$/m);
});
