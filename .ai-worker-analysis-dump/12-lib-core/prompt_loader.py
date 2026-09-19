"""Load prompt templates from ``services/ai-worker/prompts/`` (ONBOARDING §3, §9.5).

Templates use Python ``str.format`` placeholders: ``{platform}``, ``{comment}``, etc.
Literal braces in JSON examples must be doubled: ``{{`` and ``}}``.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_PROMPTS_ROOT = Path(__file__).resolve().parents[1] / 'prompts'


@lru_cache(maxsize=64)
def _read_template(rel_path: str) -> str:
    path = (_PROMPTS_ROOT / rel_path).resolve()
    root = _PROMPTS_ROOT.resolve()
    if root not in path.parents:
        raise ValueError(f'Prompt path outside prompts root: {rel_path}')
    if not path.is_file():
        raise FileNotFoundError(f'Prompt template not found: {rel_path}')
    return path.read_text(encoding='utf-8').strip()


def load_prompt(rel_path: str, **variables: str) -> str:
    """Read ``prompts/<rel_path>`` and substitute ``{key}`` placeholders."""
    template = _read_template(rel_path)
    if not variables:
        return template
    return template.format(**variables)


def prompts_root() -> Path:
    return _PROMPTS_ROOT
