"""Fetch the fixed self-hosted production environment through the human login."""
import subprocess
from common import Infisical, ROOT, SecretError, cli_environment
PROJECT = 'b29843a7-f375-45ad-a905-51aa2e132cc0'

class Production(Infisical):
    def __init__(self):
        super().__init__(ROOT)
        self.project = PROJECT
        if self.domain != "https://app.infisical.com":
            raise SecretError("The production project is pinned to the US cloud.")

    def command(self, args, value=None):
        result = subprocess.run(["infisical", *args, "--projectId", self.project,
                                 "--domain", self.domain, "--env", "prod", "--path", "/",
                                 "--silent", "--telemetry=false"],
                                cwd=ROOT, env=cli_environment(), input=value,
                                capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise SecretError("Production fetch failed; details suppressed.")
        return result.stdout
