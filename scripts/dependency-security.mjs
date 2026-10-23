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

function requirePatched(packageName, floors) {
  const versions = lockedVersions(packageName);
  assert.ok(versions.length, `missing ${packageName}`);
  for (const version of versions) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    const actual = version.split(".").map(Number);
    const floor = floors[actual[0]];
    assert.ok(floor, `unreviewed branch ${packageName}@${version}`);
    const minimum = floor.split(".").map(Number);
    const differing = actual.findIndex((value, index) => value !== minimum[index]);
    assert.ok(differing === -1 || actual[differing] > minimum[differing], `${packageName}@${version} is below ${floor}`);
  }
}

test("formerly vulnerable dependency families stay on reviewed patched branches", () => {
  const floors = {
    "@babel/core": {7: "7.29.7"},
    "brace-expansion": {1: "1.1.21", 5: "5.0.12"},
    "js-yaml": {4: "4.3.2"},
    "nanoid": {3: "3.3.18"},
    "next": {16: "16.4.1"},
    "postcss": {8: "8.5.23"},
    "sharp": {0: "0.35.5"},
    "vite": {8: "8.2.4"},
    "vitest": {4: "4.1.12"},
    "@vitest/mocker": {4: "4.1.12"},
    "zod": {4: "4.6.6"},
  };
  for (const [name, branches] of Object.entries(floors)) requirePatched(name, branches);
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
