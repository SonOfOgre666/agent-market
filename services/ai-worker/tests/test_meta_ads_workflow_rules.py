"""Tests for meta_ads_guide.md workflow constraint layer."""

from __future__ import annotations

import unittest

from lib.validation.meta_ads_workflow_rules import validate_meta_ads_workflow_graph


class MetaAdsWorkflowRulesTest(unittest.TestCase):
    def test_blocks_pixel_admin_tools(self):
        steps = [
            {'step_id': 'step_1', 'tool_id': 'meta_create_ad_pixel', 'payload': {'name': 'X'}, 'depends_on': []},
        ]
        with self.assertRaises(ValueError) as ctx:
            validate_meta_ads_workflow_graph(steps, intent='ads_campaign')
        self.assertIn('admin/setup', str(ctx.exception).lower())

    def test_blocks_mix_publish_and_granular(self):
        steps = [
            {'step_id': 'step_1', 'tool_id': 'meta_create_campaign', 'payload': {}, 'depends_on': []},
            {'step_id': 'step_2', 'tool_id': 'meta_publish_campaign', 'payload': {}, 'depends_on': ['step_1']},
        ]
        with self.assertRaises(ValueError) as ctx:
            validate_meta_ads_workflow_graph(steps, intent='ads_campaign')
        self.assertIn('mix meta_publish_campaign', str(ctx.exception))

    def test_sales_requires_pixel_list_before_adset(self):
        steps = [
            {
                'step_id': 'step_1',
                'tool_id': 'meta_create_adset',
                'payload': {
                    'objective': 'OUTCOME_SALES',
                    'optimization_goal': 'OFFSITE_CONVERSIONS',
                    'campaign_id': '123',
                },
                'depends_on': [],
            },
        ]
        with self.assertRaises(ValueError) as ctx:
            validate_meta_ads_workflow_graph(steps, intent='ads_campaign')
        self.assertIn('meta_list_ad_pixels', str(ctx.exception))

    def test_update_requires_read_before_literal_id(self):
        steps = [
            {
                'step_id': 'step_1',
                'tool_id': 'meta_update_campaign',
                'payload': {'campaign_id': '999888777', 'status': 'PAUSED'},
                'depends_on': [],
            },
        ]
        with self.assertRaises(ValueError) as ctx:
            validate_meta_ads_workflow_graph(steps, intent='ads_campaign')
        self.assertIn('meta_list_', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
