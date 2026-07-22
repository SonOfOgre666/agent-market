"""Planner uses full tool catalog — keyword route filters are not on the live path."""

from __future__ import annotations

import inspect
import unittest

from lib.dispatch.registry import tool_catalog_for_planner


class PlannerCatalogTest(unittest.TestCase):
    def test_general_catalog_includes_ads_report_and_social_tools(self):
        catalog = tool_catalog_for_planner('general')
        ids = {t['tool_id'] for t in catalog}
        self.assertIn('meta_report_insights', ids)
        self.assertIn('google_report_performance', ids)
        self.assertIn('google_report_account_summary', ids)
        self.assertIn('generate_social_post', ids)
        self.assertIn('run_budget_pacing', ids)

    def test_planner_module_does_not_call_route_planner_intent(self):
        import agents.planner as planner_mod

        source = inspect.getsource(planner_mod)
        self.assertNotIn('route_planner_intent', source)
        self.assertIn("tool_catalog_for_planner('general')", source)


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
