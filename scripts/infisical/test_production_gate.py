import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import production_gate as gate
from common import SecretError


class ProductionGateTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.repo = {"id": gate.REPOSITORY_ID, "full_name": gate.REPOSITORY}
        self.ref = {"object": {"sha": self.sha}}
        self.run = {"head_sha": self.sha, "head_branch": "main", "event": "push",
                    "run_number": 10, "status": "completed", "conclusion": "success"}

    def responses(self, runs=None):
        return [self.repo, self.ref, {"workflow_runs": runs or [self.run]}, self.ref]

    def test_clean_current_successful_main_is_approved(self):
        with patch.object(gate, "command", side_effect=["main", "", self.sha]), patch.object(gate, "api", side_effect=self.responses()):
            self.assertEqual(gate.verify_production(), self.sha)

    def test_dirty_or_other_branch_fails_before_github(self):
        for values in [["feature"], ["main", " M app.ts"]]:
            with self.subTest(values=values), patch.object(gate, "command", side_effect=values), patch.object(gate, "api") as api:
                with self.assertRaises(SecretError): gate.verify_production()
                api.assert_not_called()

    def test_wrong_repository_or_old_main_cannot_approve(self):
        for responses in [[self.repo | {"id": 999}], [self.repo, {"object": {"sha": "b" * 40}}]]:
            with self.subTest(responses=responses), patch.object(gate, "command", side_effect=["main", "", self.sha]), patch.object(gate, "api", side_effect=responses):
                with self.assertRaises(SecretError): gate.verify_production()

    def test_ci_failure_pending_other_sha_or_other_event_holds_production(self):
        for change in [{"conclusion": "failure"}, {"status": "in_progress"}, {"head_sha": "b" * 40}, {"event": "pull_request"}, {"head_branch": "feature"}]:
            with self.subTest(change=change), patch.object(gate, "command", side_effect=["main", "", self.sha]), patch.object(gate, "api", side_effect=self.responses([self.run | change])):
                with self.assertRaises(SecretError): gate.verify_production()

    def test_newer_failed_run_takes_precedence_over_older_success(self):
        runs = [self.run, self.run | {"run_number": 11, "conclusion": "failure"}]
        with patch.object(gate, "command", side_effect=["main", "", self.sha]), patch.object(gate, "api", side_effect=self.responses(runs)):
            with self.assertRaises(SecretError): gate.verify_production()

    def test_main_advancing_during_check_holds_production(self):
        responses = self.responses()[:-1] + [{"object": {"sha": "b" * 40}}]
        with patch.object(gate, "command", side_effect=["main", "", self.sha]), patch.object(gate, "api", side_effect=responses):
            with self.assertRaises(SecretError): gate.verify_production()

    def test_start_requires_matching_production_build(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gate, "ROOT", Path(directory)):
            with self.assertRaises(SecretError): gate.require_built_commit(self.sha)
            marker = Path(directory) / ".next" / ".production-commit"
            marker.parent.mkdir()
            marker.write_text("b" * 40)
            with self.assertRaises(SecretError): gate.require_built_commit(self.sha)
            marker.write_text(self.sha + "\n")
            gate.require_built_commit(self.sha)


if __name__ == "__main__":
    unittest.main()
