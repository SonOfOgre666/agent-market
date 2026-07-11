"""Ensure planner workflow tools are registered for execution."""

from __future__ import annotations

from lib.dispatch.registry import get_tool

# Tools referenced by Google/Meta campaign execute graphs but easy to forget in tools.json.
_WORKFLOW_GEO_TOOLS = (
    'google_resolve_geo_targeting',
    'meta_resolve_geo_targeting',
)


def test_workflow_geo_tools_registered():
    for tool_id in _WORKFLOW_GEO_TOOLS:
        tool = get_tool(tool_id)
        assert tool is not None, f'{tool_id} missing from registry/tools.json'
        assert tool.get('task') == 'tasks.ads.execute_ads_tool'
