"""Agent-path import_account_metrics: sync + DB snapshot fallback."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from tasks.imports.account_metrics_sync import run_import_account_metrics


ACCOUNT_ID = '6a44dc6710fb807e698638d0'


class RunImportAccountMetricsTest(unittest.TestCase):
    def test_requires_account_id(self):
        with self.assertRaises(ValueError):
            run_import_account_metrics({})

    @patch('tasks.imports.account_metrics_sync.worker_api.configured', return_value=True)
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_worker_context')
    @patch('tasks.imports.account_metrics_sync.sync_followers')
    @patch('tasks.imports.account_metrics_sync.sync_insights')
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_metrics_snapshot')
    def test_live_sync_success_returns_counts(
        self,
        mock_snapshot,
        mock_insights,
        mock_followers,
        mock_account,
        _configured,
    ):
        mock_account.return_value = {
            'provider': 'facebook',
            'name': 'My Page',
            'username': 'mypage',
            'authorized': True,
            'provider_id': '123',
            'access_token': {'token': 't'},
        }
        mock_followers.return_value = {'ok': True, 'followers_count': 1500}
        mock_insights.return_value = {'ok': True, 'rows': 2}
        mock_snapshot.return_value = {
            'followers_count': 1500,
            'followers_as_of': '2026-07-22',
            'metrics_totals': {},
            'facebook_insight_totals': {'page_post_engagements': 40},
            'period_days': 30,
        }

        out = run_import_account_metrics({'account_id': ACCOUNT_ID})
        self.assertTrue(out['ok'])
        self.assertTrue(out['sync_ok'])
        self.assertFalse(out['stale'])
        self.assertEqual(out['followers_count'], 1500)
        self.assertEqual(out['name'], 'My Page')
        self.assertIn('followers_count', out['available_fields'])
        self.assertNotIn('dispatched', out)

    @patch('tasks.imports.account_metrics_sync.worker_api.configured', return_value=True)
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_worker_context')
    @patch('tasks.imports.account_metrics_sync.sync_followers')
    @patch('tasks.imports.account_metrics_sync.sync_insights')
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_metrics_snapshot')
    def test_graph_fail_falls_back_to_stale_db(
        self,
        mock_snapshot,
        mock_insights,
        mock_followers,
        mock_account,
        _configured,
    ):
        mock_account.return_value = {
            'provider': 'instagram',
            'name': 'IG Shop',
            'username': 'igshop',
            'authorized': True,
            'provider_id': '456',
            'access_token': {'token': 't'},
        }
        mock_followers.return_value = {'ok': False, 'error': 'rate_limited', 'rate_limited': True}
        mock_insights.return_value = {'ok': False, 'error': 'rate_limited', 'rate_limited': True}
        mock_snapshot.return_value = {
            'followers_count': 900,
            'followers_as_of': '2026-07-20',
            'metrics_totals': {'reach': 100},
            'facebook_insight_totals': {},
            'period_days': 30,
        }

        out = run_import_account_metrics({'account_id': ACCOUNT_ID})
        self.assertTrue(out['ok'])
        self.assertFalse(out['sync_ok'])
        self.assertTrue(out['stale'])
        self.assertEqual(out['followers_count'], 900)

    @patch('tasks.imports.account_metrics_sync.worker_api.configured', return_value=True)
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_worker_context')
    @patch('tasks.imports.account_metrics_sync.sync_followers')
    @patch('tasks.imports.account_metrics_sync.sync_insights')
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_metrics_snapshot')
    def test_empty_when_no_sync_and_no_db(
        self,
        mock_snapshot,
        mock_insights,
        mock_followers,
        mock_account,
        _configured,
    ):
        mock_account.return_value = {
            'provider': 'facebook',
            'name': 'Empty',
            'username': '',
            'authorized': True,
            'provider_id': '1',
            'access_token': {'token': 't'},
        }
        mock_followers.return_value = {'ok': False, 'error': 'unauthorized', 'unauthorized': True}
        mock_insights.return_value = {'ok': False, 'error': 'unauthorized', 'unauthorized': True}
        mock_snapshot.return_value = {
            'followers_count': None,
            'followers_as_of': None,
            'metrics_totals': {},
            'facebook_insight_totals': {},
            'period_days': 30,
        }

        out = run_import_account_metrics({'account_id': ACCOUNT_ID})
        self.assertFalse(out['ok'])
        self.assertFalse(out['stale'])
        self.assertTrue(out['reconnect_hint'])
        self.assertEqual(out['available_fields'], [])

    @patch('tasks.imports.account_metrics_sync.worker_api.configured', return_value=True)
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_worker_context')
    @patch('tasks.imports.account_metrics_sync.sync_followers')
    @patch('tasks.imports.account_metrics_sync.sync_insights')
    @patch('tasks.imports.account_metrics_sync.worker_api.get_account_metrics_snapshot')
    def test_partial_followers_ok_insights_fail(
        self,
        mock_snapshot,
        mock_insights,
        mock_followers,
        mock_account,
        _configured,
    ):
        mock_account.return_value = {
            'provider': 'facebook',
            'name': 'Partial',
            'username': 'p',
            'authorized': True,
            'provider_id': '1',
            'access_token': {'token': 't'},
        }
        mock_followers.return_value = {'ok': True, 'followers_count': 42}
        mock_insights.return_value = {'ok': False, 'error': 'graph_error'}
        mock_snapshot.return_value = {
            'followers_count': 42,
            'followers_as_of': '2026-07-22',
            'metrics_totals': {},
            'facebook_insight_totals': {},
            'period_days': 30,
        }

        out = run_import_account_metrics({'account_id': ACCOUNT_ID})
        self.assertTrue(out['ok'])
        self.assertTrue(out['sync_ok'])
        self.assertEqual(out['followers_count'], 42)
        self.assertTrue(any(e.startswith('insights:') for e in out['sync_errors']))


class DispatcherImportMetricsTest(unittest.TestCase):
    @patch('tasks.imports.account_metrics_sync.run_import_account_metrics')
    @patch('lib.dispatch.dispatcher.resolve_dispatch')
    @patch('lib.dispatch.dispatcher.get_tool')
    def test_dispatcher_calls_sync_runner_not_celery(self, mock_get_tool, mock_resolve, mock_run):
        from lib.dispatch.dispatcher import dispatch_tool

        mock_resolve.return_value = {'task': 'tasks.imports.import_account'}
        mock_get_tool.return_value = {'tool_id': 'import_account_metrics'}
        mock_run.return_value = {'ok': True, 'followers_count': 10, 'dispatched': None}

        with patch('lib.dispatch.dispatcher.celery_app.send_task') as send_task:
            out = dispatch_tool('import_account_metrics', {'account_id': ACCOUNT_ID})
            send_task.assert_not_called()
            mock_run.assert_called_once_with({'account_id': ACCOUNT_ID})
            self.assertEqual(out['followers_count'], 10)


if __name__ == '__main__':
    unittest.main()
