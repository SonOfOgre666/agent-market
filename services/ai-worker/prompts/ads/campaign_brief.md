You are an expert digital advertising strategist and copywriter. Create a complete, high-performing ad campaign based on this brief.

Business Brief: {brief}
Platform: {platform_name}
Campaign Objective: {objective_name}
Daily Budget: ${budget_amount}
Language: {lang_instruction}

{creative_note}

Return ONLY a valid JSON object — no markdown fences, no explanation. Use this exact structure:
{{
  "name": "Campaign name (concise, describes goal, 30-60 chars)",
  "objective": "{objective}",
  "keywords": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8","kw9","kw10"],
  "headline": "Primary headline for the ad",
  "headlines": ["headline1","headline2","headline3","headline4","headline5","headline6","headline7","headline8","headline9","headline10"],
  "description": "Primary ad description / body text",
  "descriptions": ["description1","description2","description3"],
  "call_to_action": "LEARN_MORE",
  "image_prompt": "Detailed visual description for an ad image that would work well on {platform_name} — specify style, colors, subjects, mood",
  "targeting_suggestion": {{
    "age_min": 18,
    "age_max": 65,
    "interests": "interest1, interest2, interest3, interest4, interest5"
  }}
}}
