"""Tests for planner intent routing and catalog filtering."""

from __future__ import annotations

import unittest

from lib.dispatch.registry import tool_catalog_for_planner
from lib.planner.intent_router import message_mentions_ads, route_planner_intent


class IntentRouterTest(unittest.TestCase):
    def test_meta_advertising_setup_detected(self):
        msg = (
            'Create a Meta advertising setup for a business selling fitness supplements '
            'online targeting Morocco.'
        )
        self.assertTrue(message_mentions_ads(msg))
        route = route_planner_intent(msg, {'ads_accounts': [{'provider': 'meta_ads', 'id': 'a1'}]})
        self.assertEqual(route, 'meta_ads_campaign')

    def test_marrakech_meta_ad_detected(self):
        msg = 'I want to create an ad about traveling to Marrakech on meta ads'
        self.assertTrue(message_mentions_ads(msg))
        route = route_planner_intent(msg, {'ads_accounts': [{'provider': 'meta_ads', 'id': 'a1'}]})
        self.assertEqual(route, 'meta_ads_campaign')

    def test_meta_campaign_catalog_smaller_than_full(self):
        full = tool_catalog_for_planner('general')
        meta = tool_catalog_for_planner('meta_ads_campaign')
        social = tool_catalog_for_planner('social_content')
        self.assertLess(len(meta), len(full))
        self.assertLess(len(social), len(full))
        self.assertTrue(all(t['tool_id'].startswith('meta_') for t in meta))
        self.assertTrue(all(t['tool_id'] in {
            'generate_social_post', 'analyze_social_comment', 'generate_video_script',
            'generate_image_script', 'generate_image', 'generate_video', 'create_draft_post',
            'schedule_post', 'publish_post',
        } for t in social))


class AdsAccountPickTest(unittest.TestCase):
    def test_picks_graph_ad_account_when_multiple_meta_rows(self):
        from lib.planner.ads_helpers import _pick_ads_account_id

        ctx = {
            'ads_accounts': [
                {'id': 'user_conn', 'provider': 'meta_ads', 'name': 'Meta user', 'username': '12345'},
                {
                    'id': 'act_conn',
                    'provider': 'meta_ads',
                    'name': 'My ad account',
                    'username': 'act_999',
                    'ad_account_id': 'act_999',
                },
            ],
        }
        picked = _pick_ads_account_id('meta_ads', ctx)
        self.assertEqual(picked, 'act_conn')


if __name__ == '__main__':
    unittest.main()
