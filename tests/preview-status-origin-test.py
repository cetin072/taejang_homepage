import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("uar", pathlib.Path(__file__).resolve().parents[1] / ".github/scripts/user_acceptance_ready.py")
uar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uar)


class PreviewOriginTest(unittest.TestCase):
    def test_entry_path_does_not_become_test_base_path(self):
        contract = {"preview": {"required": True, "status_context": "netlify/example/deploy-preview", "wait_seconds": 10}}
        env = {"GITHUB_REPOSITORY": "owner/repository", "UAR_HEAD_SHA": "exact-approved-head", "GITHUB_TOKEN": "fixture-token"}
        for suffix in ("", "/", "/app/", "/app/?from=pr#notice"):
            with self.subTest(suffix=suffix), patch.object(uar, "github_json", return_value={"statuses": [{
                "context": "netlify/example/deploy-preview", "state": "success",
                "target_url": "https://deploy-preview-491--example.netlify.app" + suffix,
            }]}) as fetch:
                self.assertEqual(uar.wait_for_preview(contract, env), "https://deploy-preview-491--example.netlify.app")
                self.assertEqual(fetch.call_args.args[0], "https://api.github.com/repos/owner/repository/commits/exact-approved-head/status")


if __name__ == "__main__":
    unittest.main()
