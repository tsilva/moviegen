"""Fetch development secrets in memory, then replace this process with the app."""

import os
import subprocess
import sys

from common import Infisical, ROOT, SecretError, application_environment
from production import Production
from production_gate import require_built_commit, verify_production

COMMANDS = {
    "dev": ["pnpm", "run", "dev:app", "--port", "auto"],
    "build": ["pnpm", "run", "build"],
    "start": ["pnpm", "run", "start:app", "--port", "auto"],
    "check": ["node", "scripts/check-infisical-secrets.mjs"],
}


def selected_command(arguments):
    if not arguments or arguments[0] not in COMMANDS:
        raise SecretError(
            "Usage: python3 scripts/infisical/run.py <dev|build|start|check>"
        )
    if arguments[1:] and not (
        arguments[0] in ("dev", "start")
        and arguments[1:] in (["--port", "auto"], ["--port=auto"])
    ):
        raise SecretError(
            "Only --port auto is supported for development/start; project and environment overrides are rejected."
        )
    return COMMANDS[arguments[0]]


def main():
    command = selected_command(sys.argv[1:])
    production_sha = None
    if sys.argv[1] in ("build", "start"):
        production_sha = verify_production()
        if sys.argv[1] == "start":
            require_built_commit(production_sha)
    client = Production() if sys.argv[1] in ("build", "start") else Infisical()
    environment = application_environment(client.read())
    if sys.argv[1] == "dev":
        environment["NEXT_DEV_OUTPUT_DIR"] = f".next-dev-{os.getpid()}"
    os.chdir(ROOT)
    if sys.argv[1] == "build":
        result = subprocess.run(command, env=environment)
        if result.returncode:
            raise SystemExit(result.returncode)
        # Never let a build produced from a changed checkout authorize start.
        if verify_production() != production_sha:
            raise SecretError("Production changed during build; rebuild after CI passes.")
        marker = ROOT / ".next" / ".production-commit"
        marker.write_text(production_sha + "\n")
        return
    os.execvpe(command[0], command, environment)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except SecretError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(
            "Could not launch the application; credential details suppressed.",
            file=sys.stderr,
        )
        sys.exit(1)
