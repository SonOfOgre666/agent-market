const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-flash-latest'
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp-image-generation'
const IMAGE_MODEL_CANDIDATES = [
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  'gemini-2.5-flash',
  'gemini-flash-latest',
]


const geminiUrl = (model, action = 'generateContent') => {
  return `${BASE}/${model}:${action}`
}
const geminiListModelsUrl = () => `${BASE}`
const geminiHeaders = () => ({
  'Content-Type': 'application/json',
  'X-goog-api-key': GEMINI_API_KEY,
})

const normalizeModelName = (name = '') => name.replace(/^models\//, '')

const modelErrorMessage = (data) => `${data?.error?.message || ''}`.toLowerCase()

const isModelUnavailableError = (status, data) => {
  const message = modelErrorMessage(data)
  return (
    status === 404
    || message.includes('is not found')
    || message.includes('not supported for generatecontent')
    || message.includes('model not found')
  )
}

const isImageGenerationUnsupportedError = (status, data) => {
  const message = modelErrorMessage(data)
  return (
    isModelUnavailableError(status, data)
    || message.includes('responsemodalities')
    || message.includes('response modalities')
    || message.includes('image') && message.includes('not supported')
    || message.includes('does not support') && message.includes('image')
  )
}

async function requestGeminiGenerate(model, payload) {
  const res = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: geminiHeaders(),
    body: JSON.stringify(payload),
  })

  let data = {}
  try {
    data = await res.json()
  } catch {
    data = { error: { message: 'Invalid JSON response from Gemini API' } }
  }

  return { res, data, model }
}

async function discoverFallbackModels(fastify, { excludedModels = [], preferImage = false } = {}) {
  try {
    const res = await fetch(geminiListModelsUrl(), { headers: geminiHeaders() })
    const data = await res.json()

    if (!res.ok) {
      fastify.log.warn({ status: res.status, gemini: data }, 'Gemini listModels failed')
      return []
    }

    const available = (data.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => normalizeModelName(m.name))
      .filter(Boolean)
      .filter(name => !excludedModels.includes(name))

    const imageFirst = preferImage
      ? available.filter(name => name.includes('image') || name.includes('vision'))
      : []

    const flashNext = available.filter(name => name.includes('flash'))
    const ranked = [...imageFirst, ...flashNext, ...available]

    return [...new Set(ranked)]
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Gemini listModels network error')
    return []
  }
}

async function discoverFallbackTextModel(fastify, excludedModels = []) {
  const models = await discoverFallbackModels(fastify, { excludedModels, preferImage: false })
  return models[0] || null
}

async function discoverFallbackImageModels(fastify, excludedModels = []) {
  const discovered = await discoverFallbackModels(fastify, { excludedModels, preferImage: true })
  const merged = [...IMAGE_MODEL_CANDIDATES, ...discovered]
  return [...new Set(merged)].filter(name => !excludedModels.includes(name))
}
const PLATFORM_RULES = {
  instagram: 'Visual-focused, emojis encouraged, max 2200 chars, hashtags are critical',
  linkedin: 'Professional tone, thought leadership, max 3000 chars, minimal hashtags (3-5)',
  twitter: 'Punchy and concise, MUST be under 280 chars for caption, max 5 hashtags',
  facebook: 'Conversational, community-oriented, can be longer form, native video preferred',
  tiktok: 'Casual and trendy, short caption, heavy hashtags, hook in first sentence',
}

const TONE_MAP = {
  professional: 'authoritative, polished, and credible',
  friendly: 'warm, approachable, and conversational',
  funny: 'humorous, witty, and entertaining',
  marketing: 'persuasive, benefit-driven, and action-oriented',
}

const GOAL_MAP = {
  engagement: 'maximize likes, comments, and shares by encouraging interaction',
  sales: 'drive conversions and purchases with strong selling points',
  awareness: 'build brand recognition and reach new audiences',
  traffic: 'drive clicks to a website or landing page',
}

const POST_TYPE_MAP = {
  image: 'image post',
  video: 'video post',
  thread: 'thread/carousel post',
  ad: 'sponsored/ad post',
}

export default async function aiRoutes(fastify) {
  fastify.post('/ai/generate-post', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!GEMINI_API_KEY) {
      return reply.code(500).send({ error: 'GEMINI_API_KEY is not configured on server.' })
    }

    const { platform = 'instagram', post_type = 'image', prompt, goal = 'engagement', tone = 'friendly' } = request.body

    if (!prompt?.trim()) {
      return reply.code(400).send({ error: 'Prompt is required' })
    }

    const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.instagram
    const toneDesc = TONE_MAP[tone] || tone
    const goalDesc = GOAL_MAP[goal] || goal
    const typeDesc = POST_TYPE_MAP[post_type] || post_type

    const systemPrompt = `You are an expert social media content creator specializing in high-performing ${platform} content.

Create a ${typeDesc} for ${platform.charAt(0).toUpperCase() + platform.slice(1)}.

Platform rules: ${platformRule}
Tone: ${toneDesc}
Goal: ${goalDesc}
User request: ${prompt}

Return ONLY a valid JSON object — no markdown, no explanation — with this exact structure:
{
  "caption": "Full post caption optimized for the platform and goal",
  "hashtags": ["tag1", "tag2", "tag3"],
  "hooks": [
    "Opening line option 1",
    "Opening line option 2",
    "Opening line option 3"
  ],
  "ctas": [
    "Call to action 1",
    "Call to action 2",
    "Call to action 3"
  ],
  "image_prompt": "A detailed image generation prompt that would complement this post visually"
}`

    try {
      const payload = {
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 2048 },
      }

      let attempt = await requestGeminiGenerate(TEXT_MODEL, payload)

      if (!attempt.res.ok && isModelUnavailableError(attempt.res.status, attempt.data)) {
        const fallbackModel = await discoverFallbackTextModel(fastify, [TEXT_MODEL])
        if (fallbackModel) {
          fastify.log.warn({ from: TEXT_MODEL, to: fallbackModel }, 'Gemini text model fallback activated')
          attempt = await requestGeminiGenerate(fallbackModel, payload)
        }
      }

      const { res, data } = attempt

      if (!res.ok) {
        const geminiError = data?.error?.message || JSON.stringify(data)
        fastify.log.error({ status: res.status, gemini: data, requestedModel: TEXT_MODEL, usedModel: attempt.model }, 'Gemini text generation failed')
        return reply.code(502).send({ error: `AI error: ${geminiError}` })
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      try {
        const parsed = JSON.parse(cleaned)
        return reply.send(parsed)
      } catch {
        return reply.send({ caption: raw, hashtags: [], hooks: [], ctas: [], image_prompt: '' })
      }
    } catch (err) {
      fastify.log.error(err, 'AI generate-post network error')
      return reply.code(502).send({ error: `Network error reaching AI: ${err.message}` })
    }
  })

  fastify.post('/ai/generate-image', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!GEMINI_API_KEY) {
      return reply.code(500).send({ error: 'GEMINI_API_KEY is not configured on server.' })
    }

    const { prompt, style = 'realistic' } = request.body

    if (!prompt?.trim()) {
      return reply.code(400).send({ error: 'Image prompt is required' })
    }

    const styleMap = {
      realistic: 'photorealistic, professional photography, high resolution, sharp details',
      minimal: 'minimalist design, clean composition, white background, simple and elegant',
      product: 'product photography, studio lighting, commercial quality, centered subject',
      marketing: 'vibrant colors, bold graphic design, eye-catching, social media ad style',
    }

    const fullPrompt = `${prompt}, ${styleMap[style] || styleMap.realistic}`

    try {
      const payload = {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }

      let attempt = await requestGeminiGenerate(IMAGE_MODEL, payload)

      if (!attempt.res.ok && isImageGenerationUnsupportedError(attempt.res.status, attempt.data)) {
        const fallbackModels = await discoverFallbackImageModels(fastify, [IMAGE_MODEL])
        for (const model of fallbackModels) {
          const fallbackAttempt = await requestGeminiGenerate(model, payload)

          if (!fallbackAttempt.res.ok && isImageGenerationUnsupportedError(fallbackAttempt.res.status, fallbackAttempt.data)) {
            fastify.log.warn({ model, status: fallbackAttempt.res.status, gemini: fallbackAttempt.data }, 'Gemini image model fallback attempt failed')
            continue
          }

          fastify.log.warn({ from: IMAGE_MODEL, to: model }, 'Gemini image model fallback activated')
          attempt = fallbackAttempt
          break
        }
      }

      let { res, data } = attempt

      if (!res.ok) {
        const geminiError = data?.error?.message || JSON.stringify(data)
        fastify.log.error({ status: res.status, gemini: data, requestedModel: IMAGE_MODEL, usedModel: attempt.model }, 'Gemini image generation failed')
        return reply.code(502).send({ error: `Image AI error: ${geminiError}` })
      }

      let parts = data.candidates?.[0]?.content?.parts || []
      let imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))

      if (!imagePart) {
        const fallbackModels = await discoverFallbackImageModels(fastify, [IMAGE_MODEL, attempt.model])
        for (const model of fallbackModels) {
          const fallbackAttempt = await requestGeminiGenerate(model, payload)
          if (!fallbackAttempt.res.ok) continue

          const fallbackParts = fallbackAttempt.data.candidates?.[0]?.content?.parts || []
          const fallbackImagePart = fallbackParts.find(p => p.inlineData?.mimeType?.startsWith('image/'))

          if (fallbackImagePart) {
            fastify.log.warn({ from: attempt.model, to: model }, 'Gemini image fallback found model returning image output')
            attempt = fallbackAttempt
            res = fallbackAttempt.res
            data = fallbackAttempt.data
            parts = fallbackParts
            imagePart = fallbackImagePart
            break
          }
        }
      }

      if (!imagePart) {
        fastify.log.error({ data, requestedModel: IMAGE_MODEL, usedModel: attempt.model }, 'No image part in Gemini response')
        return reply.code(502).send({ error: 'No image returned from AI service. Configure GEMINI_IMAGE_MODEL to an image-capable Gemini model.' })
      }

      const { mimeType, data: b64 } = imagePart.inlineData
      return reply.send({ image: `data:${mimeType};base64,${b64}` })
    } catch (err) {
      fastify.log.error(err, 'AI generate-image network error')
      return reply.code(502).send({ error: `Network error reaching AI: ${err.message}` })
    }
  })
}
