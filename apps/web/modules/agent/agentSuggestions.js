/** Starter prompts for AI Agent — real planner intents. */
export const AGENT_SUGGESTIONS = [
  {
    id: 'social-create-post',
    label: 'Create a Facebook post',
    prompt: 'Create a draft Facebook post promoting our product launch. Generate caption and image, then save it as a draft for Facebook.',
    needs: 'Facebook',
  },
  {
    id: 'google-create-search',
    label: 'Create Google Search campaign',
    prompt: 'Create a Google Search campaign called "Spring SaaS" with US targeting',
    needs: 'Google Ads',
  },
  {
    id: 'meta-draft',
    label: 'Draft Meta ads campaign',
    prompt: 'Draft a Meta ads campaign for a SaaS launch. Collect any missing details before creating anything.',
    needs: 'Meta Ads',
  },
]
