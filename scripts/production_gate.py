"""Permit local Production only for the clean, successful current main commit."""

import json
import re
import subprocess
from pathlib import Path

import os
import sys

ROOT = Path(__file__).resolve().parents[1]

class SecretError(Exception):
    """Fixed, credential-free release diagnostics."""

REPOSITORY = "tsilva/moviegen"
REPOSITORY_ID = 1334322845


def command(arguments):
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise SecretError("Production gate could not verify Git/GitHub; no credentials fetched.")
    return result.stdout.strip()


def api(path):
    try:
        return json.loads(command(["gh", "api", path]))
    except (ValueError, subprocess.SubprocessError):
        raise SecretError("Production GitHub verification failed; no credentials fetched.") from None


def verify_production():
    if command(["git", "branch", "--show-current"]) != "main":
        raise SecretError("Production requires the main branch; no credentials fetched.")
    if command(["git", "status", "--porcelain"]):
        raise SecretError("Production requires a clean checkout; commit reviewed changes first.")
    sha = command(["git", "rev-parse", "HEAD"])
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SecretError("Invalid Production commit; no credentials fetched.")
    repository = api("repos/" + REPOSITORY)
    if repository.get("id") != REPOSITORY_ID or repository.get("full_name") != REPOSITORY:
        raise SecretError("Production repository mismatch; no credentials fetched.")
    if api("repos/" + REPOSITORY + "/git/ref/heads/main")["object"]["sha"] != sha:
        raise SecretError("Production requires GitHub's current main commit; no credentials fetched.")
    runs = api(
        "repos/" + REPOSITORY + "/actions/workflows/ci.yml/runs?"
        + "head_sha=" + sha + "&branch=main&event=push&per_page=10"
    )["workflow_runs"]
    matching = sorted(
        [run for run in runs if run.get("head_sha") == sha
         and run.get("head_branch") == "main" and run.get("event") == "push"],
        key=lambda run: run["run_number"], reverse=True,
    )
    if not matching or matching[0].get("status") != "completed" or matching[0].get("conclusion") != "success":
        raise SecretError("Production held: this exact main commit must pass CI first.")
    # Recheck after the CI lookup so a superseding push holds this operation.
    if api("repos/" + REPOSITORY + "/git/ref/heads/main")["object"]["sha"] != sha:
        raise SecretError("Production commit was superseded; no credentials fetched.")
    return sha


def require_built_commit(sha):
    marker = ROOT / ".next" / ".production-commit"
    if not marker.exists() or marker.read_text().strip() != sha:
        raise SecretError("Build this approved commit with pnpm build:production before starting Production.")


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if arguments not in ([], ["build"], ["start", "--port", "auto"]):
        raise SecretError("Use check, build, or start --port auto; scope overrides are rejected.")
    sha = verify_production()
    if not arguments:
        print("Production CI approved: " + sha)
        return
    if arguments[0] == "build":
        subprocess.run(["pnpm", "run", "build"], cwd=ROOT, check=True)
        if verify_production() != sha:
            raise SecretError("Production changed during build; repeat the approved build.")
        (ROOT / ".next" / ".production-commit").write_text(sha + "\n")
        return
    require_built_commit(sha)
    os.chdir(ROOT)
    os.execvp("pnpm", ["pnpm", "run", "start", "--port", "auto"])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, SecretError) else "Production verification failed; details suppressed.")
        raise SystemExit(1)
