# Prompt templates (`services/ai-worker/prompts/`)

ONBOARDING §3 and §9.5: **prompt text lives here**, not in Python string literals — so marketers and engineers can tune copy without redeploying task logic.

## Layout

| Path | Used by | Opcode / task |
|------|---------|----------------|
| `planner/system.md` | Agent planner | workflow planning |
| `agent/result_summary.md` | `lib/planner/result_narrator.py` | post-execution user reply |
| `social/generate_post.md` | `lib/llm/prompts.py` | `generate_post` |
| `social/image_script.md` | `lib/llm/prompts.py` | image script step |
| `social/video_script.md` | `lib/llm/prompts.py` | `generate_video_script` |
| `social/analyze_comment.md` | `lib/llm/prompts.py` | `analyze_comment` |
| `ads/campaign_brief.md` | `lib/llm/prompts.py` | campaign generation |
| `ads/landing_page_copy.md` | `lib/ads_marketing_content.py` | `landing_page_copy` |

## Loader

```python
from lib.prompt_loader import load_prompt

text = load_prompt('social/generate_post.md', platform_cap='Instagram', prompt='...')
```

Placeholders use Python `str.format`: `{platform}`, `{comment}`, etc.  
JSON examples in templates need doubled braces: `{{` → `{` in output.

## Adding a prompt

1. Add `prompts/<domain>/<name>.md`
2. Call `load_prompt()` from the task or `lib/llm/prompts.py` builder
3. Keep secrets and API keys out of this folder
