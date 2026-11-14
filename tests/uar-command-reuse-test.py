import importlib.util
import os
from pathlib import Path
from unittest.mock import patch
import unittest
import contextlib
import io

spec = importlib.util.spec_from_file_location('uar', Path(__file__).resolve().parents[1] / '.github/scripts/user_acceptance_ready.py')
uar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uar)


class QuietTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))


class CommandReuseTests(QuietTests):
    def test_scopes_and_environment_boundaries(self):
        for scope in ('docs', 'public', 'full', 'unknown'):
            with self.subTest(scope=scope):
                calls = []
                with patch.dict(os.environ, {'VALIDATION_SCOPE': scope, 'PREVIEW_URL': ''}), patch('sys.argv', ['uar']), patch.object(uar, 'wait_for_preview', return_value='https://preview.example') as preview, patch.object(uar, 'wait_for_public_checks') as public_checks, patch.object(uar, 'run_command', side_effect=lambda label, command, env: calls.append((command, env.get('PREVIEW_URL', '')))):
                    uar.main()
                if scope == 'docs':
                    self.assertFalse(calls or preview.called or public_checks.called)
                elif scope == 'public':
                    self.assertFalse(calls)
                    self.assertEqual(preview.call_count, 1)
                    self.assertEqual(public_checks.call_count, 1)
                else:
                    browser = [env for cmd, env in calls if cmd == 'node scripts/run-promotion-browser-gate.mjs']
                    self.assertEqual(browser, ['', 'https://preview.example'])
                    self.assertFalse(public_checks.called)

    def test_failed_command_is_never_reused(self):
        with patch.dict(os.environ, {'VALIDATION_SCOPE': 'full'}), patch('sys.argv', ['uar']), patch.object(uar, 'run_command', side_effect=SystemExit(1)) as run, patch.object(uar, 'wait_for_preview') as preview:
            with self.assertRaises(SystemExit):
                uar.main()
            self.assertEqual(run.call_count, 1)
            self.assertFalse(preview.called)

    def test_public_qa_failure_prevents_ready(self):
        with patch.dict(os.environ, {'VALIDATION_SCOPE': 'public'}), patch('sys.argv', ['uar']), patch.object(uar, 'wait_for_preview'), patch.object(uar, 'wait_for_public_checks', side_effect=SystemExit(1)):
            with self.assertRaises(SystemExit):
                uar.main()


class PublicCheckTests(QuietTests):
    env = {'GITHUB_REPOSITORY': 'example/repo', 'UAR_HEAD_SHA': 'abc', 'GITHUB_TOKEN': 'synthetic'}
    names = ['Public source and launch regression', 'Article photo and existing video slides', 'Employee app landing local and exact-head Preview']

    def checks(self):
        return [{'id': i + 1, 'name': name, 'head_sha': 'abc', 'app': {'slug': 'github-actions'}, 'status': 'completed', 'conclusion': 'success'} for i, name in enumerate(self.names)]

    def test_exact_head_success(self):
        with patch.object(uar, 'github_json', return_value={'check_runs': self.checks()}):
            uar.wait_for_public_checks(self.env)

    def test_failure_cancel_or_skip_blocks_ready(self):
        for outcome in ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out']:
            checks = self.checks()
            checks[0]['conclusion'] = outcome
            with self.subTest(outcome=outcome), patch.object(uar, 'github_json', return_value={'check_runs': checks}):
                with self.assertRaises(SystemExit):
                    uar.wait_for_public_checks(self.env)

    def test_missing_wrong_head_or_wrong_provider_times_out(self):
        for kind in ('missing', 'head', 'provider', 'in_progress'):
            checks = self.checks()
            if kind == 'missing':
                checks.pop()
            elif kind == 'head':
                checks[0]['head_sha'] = 'old'
            elif kind == 'provider':
                checks[0]['app']['slug'] = 'other'
            else:
                checks[0]['status'] = 'in_progress'
                checks[0]['conclusion'] = None
            with self.subTest(kind=kind), patch.object(uar, 'github_json', return_value={'check_runs': checks}), patch.object(uar.time, 'monotonic', side_effect=[0, 0, 1000]), patch.object(uar.time, 'sleep'):
                with self.assertRaises(SystemExit):
                    uar.wait_for_public_checks(self.env)

    def test_latest_attempt_wins(self):
        checks = self.checks()
        checks.append({**checks[0], 'id': 100, 'conclusion': 'failure'})
        with patch.object(uar, 'github_json', return_value={'check_runs': checks}):
            with self.assertRaises(SystemExit):
                uar.wait_for_public_checks(self.env)

    def test_pagination(self):
        first = [{'name': 'unrelated'}] * 100
        with patch.object(uar, 'github_json', side_effect=[{'check_runs': first}, {'check_runs': self.checks()}]) as request:
            uar.wait_for_public_checks(self.env)
            self.assertIn('page=2', request.call_args[0][0])


if __name__ == '__main__':
    unittest.main()
