"""Ads account_id inheritance across workflow steps."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from lib.runtime.executor import execute_workflow_steps
from lib.runtime.payload_resolve import resolve_step_payload
from tools.ads._resolve import inherit_ads_account_context


class InheritAdsAccountContextTest(unittest.TestCase):
    def test_from_workflow_graph_google_account_id(self):
        out = inherit_ads_account_context(
            {'query': 'Morocco'},
            workflow={'google_account_id': 'acc-google-1'},
        )
        self.assertEqual(out['account_id'], 'acc-google-1')

    def test_from_sibling_step_payload(self):
        steps = [
            {'step_id': 'step_1', 'payload': {'account_id': 'acc-1'}},
            {'step_id': 'step_2', 'payload': {'query': 'Morocco'}},
        ]
        out = inherit_ads_account_context(
            {'query': 'Morocco'},
            steps=steps,
        )
        self.assertEqual(out['account_id'], 'acc-1')

    def test_does_not_overwrite_existing(self):
        out = inherit_ads_account_context(
            {'account_id': 'keep-me', 'query': 'Morocco'},
            workflow={'google_account_id': 'other'},
        )
        self.assertEqual(out['account_id'], 'keep-me')


class PayloadResolveAdGroupAliasTest(unittest.TestCase):
    def test_platform_ad_group_id_alias(self):
        results = {
            'step_7': {
                'status': 'completed',
                'output': {'platform_ad_set_id': '12345', 'ok': True},
            },
        }
        resolved = resolve_step_payload(
            {'platform_ad_group_id': '$step_7.output.platform_ad_group_id'},
            results,
            {},
        )
        self.assertEqual(resolved['platform_ad_group_id'], '12345')


class ExecutorInheritAccountTest(unittest.TestCase):
    @patch('lib.runtime.executor.dispatch_tool')
    def test_later_google_step_inherits_account_id(self, mock_dispatch):
        mock_dispatch.return_value = {'ok': True, 'data': []}

        workflow = {
            'intent': 'ads_campaign',
            'google_account_id': 'acc-99',
            'steps': [
                {
                    'step_id': 'step_1',
                    'tool_id': 'google_get_account',
                    'payload': {'account_id': 'acc-99'},
                    'depends_on': [],
                },
                {
                    'step_id': 'step_2',
                    'tool_id': 'google_search_geo_locations',
                    'payload': {'query': 'Morocco', 'limit': 5},
                    'depends_on': ['step_1'],
                },
            ],
        }
        execute_workflow_steps(workflow, approved=True, workspace_id='ws1')
        self.assertEqual(mock_dispatch.call_count, 2)
        step2_payload = mock_dispatch.call_args_list[1][0][1]
        self.assertEqual(step2_payload.get('account_id'), 'acc-99')


if __name__ == '__main__':
    unittest.main()
