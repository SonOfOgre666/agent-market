"""Workflow executor treats {ok: false} tool envelopes as step failures."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from lib.runtime.executor import _tool_output_error, execute_workflow_steps
from lib.runtime.payload_resolve import resolve_step_payload


META_DEV_ERR = (
    'Invalid parameter — Ads creative post was created by an app that is in development mode. '
    '— subcode=1885183 — Your Meta (Facebook) app is in Development mode.'
)


class ToolOutputErrorTest(unittest.TestCase):
    def test_detects_ok_false(self):
        self.assertEqual(
            _tool_output_error({'ok': False, 'error': META_DEV_ERR}),
            META_DEV_ERR,
        )

    def test_ignores_success_without_ok(self):
        self.assertIsNone(_tool_output_error({'creative_id': '123'}))


class ExecutorAdsFailureTest(unittest.TestCase):
    @patch('lib.runtime.executor.dispatch_tool')
    def test_meta_create_creative_ok_false_fails_step(self, mock_dispatch):
        mock_dispatch.side_effect = [
            {'ok': True, 'account': {'id': 'act_1'}},
            {'ok': True, 'id': 'camp_1', 'platform_campaign_id': 'camp_1'},
            {'ok': True, 'id': 'adset_1', 'platform_ad_set_id': 'adset_1'},
            {'ok': True, 'image_hash': 'abc123'},
            {'ok': False, 'error': META_DEV_ERR},
        ]
        workflow = {
            'intent': 'ads_campaign',
            'steps': [
                {'step_id': 'step_1', 'tool_id': 'meta_get_account', 'payload': {}, 'depends_on': []},
                {'step_id': 'step_2', 'tool_id': 'meta_create_campaign', 'payload': {}, 'depends_on': ['step_1']},
                {'step_id': 'step_3', 'tool_id': 'meta_create_adset', 'payload': {}, 'depends_on': ['step_2']},
                {'step_id': 'step_4', 'tool_id': 'meta_upload_ad_image', 'payload': {}, 'depends_on': ['step_3']},
                {'step_id': 'step_5', 'tool_id': 'meta_create_creative', 'payload': {}, 'depends_on': ['step_4']},
                {
                    'step_id': 'step_6',
                    'tool_id': 'meta_create_ad',
                    'payload': {'creative_id': '$step_5.output.creative_id', 'adset_id': '$step_3.output.platform_ad_set_id'},
                    'depends_on': ['step_5', 'step_3'],
                },
            ],
        }
        out = execute_workflow_steps(workflow, approved=True, workspace_id='ws1')
        self.assertEqual(out['status'], 'failed')
        step5 = out['step_results']['step_5']
        self.assertEqual(step5['status'], 'failed')
        self.assertIn('1885183', step5['error'])
        self.assertEqual(out['step_results']['step_6']['status'], 'failed')
        self.assertIn('step_5 failed', out['step_results']['step_6']['error'])
        self.assertEqual(mock_dispatch.call_count, 5)


class PayloadResolveUpstreamFailureTest(unittest.TestCase):
    def test_surfaces_upstream_meta_error(self):
        results = {
            'step_5': {
                'status': 'failed',
                'error': META_DEV_ERR,
                'tool_id': 'meta_create_creative',
            },
        }
        with self.assertRaises(ValueError) as ctx:
            resolve_step_payload(
                {'creative_id': '$step_5.output.creative_id'},
                results,
                {},
            )
        self.assertIn('1885183', str(ctx.exception))
        self.assertIn('step_5 failed', str(ctx.exception))

    def test_resolves_draft_id_for_publish(self):
        results = {
            'step_2': {
                'status': 'completed',
                'tool_id': 'create_draft_post',
                'output': {
                    'id': '6a56514e6cadc5620ba52b07',
                    'uuid': 'EVRWlIRA0buDwZGDNRSRC',
                    'status': 0,
                    'account_ids': [],
                },
            },
        }
        resolved = resolve_step_payload(
            {'post_id': 'step_2.output.id'},
            results,
            {},
        )
        self.assertEqual(resolved['post_id'], '6a56514e6cadc5620ba52b07')


if __name__ == '__main__':
    unittest.main()
