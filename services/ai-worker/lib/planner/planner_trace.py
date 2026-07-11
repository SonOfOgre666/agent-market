"""Accumulate planning-time LLM + tool activity for the agent UI."""

from __future__ import annotations

from typing import Any


class PlannerTrace:
    def __init__(self) -> None:
        self._entries: list[dict[str, str]] = []

    def log_llm(self, label: str, *, feature: str = 'Planner', source: str = '') -> None:
        self._entries.append({
            'kind': 'llm',
            'label': label,
            'feature': feature,
            'source': source or label,
        })

    def log_tool(self, tool_id: str, *, label: str | None = None) -> None:
        self._entries.append({
            'kind': 'tool',
            'tool_id': tool_id,
            'label': label or tool_id,
        })

    def entries(self) -> list[dict[str, str]]:
        return list(self._entries)

    def attach(self, graph: dict[str, Any]) -> dict[str, Any]:
        if self._entries:
            graph['activity_log'] = self.entries()
        return graph


def tool_ids_from_steps(steps: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for step in steps:
        tid = str(step.get('tool_id') or '').strip()
        if tid and tid not in seen:
            seen.add(tid)
            out.append(tid)
    return out
