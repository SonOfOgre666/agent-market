import { authenticate } from '../middleware/auth.js'
import * as Account from '../models/Account.js'
import { getSocialProvider } from '../providers/index.js'

// Simple keyword-based sentiment scoring
const POSITIVE_WORDS = [
  'great','good','excellent','amazing','love','fantastic','wonderful','best','happy','perfect',
  'awesome','outstanding','superb','brilliant','positive','nice','enjoy','beautiful','helpful','thanks',
]
const NEGATIVE_WORDS = [
  'bad','terrible','awful','hate','worst','horrible','poor','disappointing','useless','broken',
  'wrong','fail','error','issue','problem','annoying','frustrating','slow','ugly','negative',
]

function analyzeSentiment(text) {
  const lower = text.toLowerCase()
  const words = lower.match(/\b\w+\b/g) || []

  const matched = { positive: [], negative: [] }
  for (const word of words) {
    if (POSITIVE_WORDS.includes(word)) matched.positive.push(word)
    if (NEGATIVE_WORDS.includes(word)) matched.negative.push(word)
  }

  const score = matched.positive.length - matched.negative.length
  let sentiment = 'neutral'
  if (score > 0) sentiment = 'positive'
  else if (score < 0) sentiment = 'negative'

  return {
    sentiment,
    score,
    keywords: {
      positive: [...new Set(matched.positive)],
      negative: [...new Set(matched.negative)],
    },
  }
}

export default async function socialRoutes(app) {
  // POST /api/social/comments/analyze
  // Mode 1: { text } — analyze a single string directly
  // Mode 2: { account_id, provider_post_id } — fetch comments from a social post then analyze each
  app.post('/social/comments/analyze', { preHandler: [authenticate] }, async (request, reply) => {
    const { text, account_id, provider_post_id } = request.body || {}

    // Mode 2: fetch comments from the social platform
    if (account_id && provider_post_id) {
      const account = await Account.findByUuid(account_id) || await Account.findById(account_id)
      if (!account) return reply.code(404).send({ error: 'Account not found' })

      const provider = await getSocialProvider(account.provider, {}, account)
      if (typeof provider.getComments !== 'function') {
        return reply.code(422).send({ error: `Comment fetching is not supported for provider: ${account.provider}` })
      }

      const comments = await provider.getComments(provider_post_id)
      const analyzed = comments.map(c => ({ ...c, ...analyzeSentiment(c.text || '') }))
      const overall = analyzed.length
        ? analyzeSentiment(analyzed.map(c => c.text).join(' '))
        : { sentiment: 'neutral', score: 0, keywords: { positive: [], negative: [] } }

      return reply.send({ comments: analyzed, overall, total: analyzed.length })
    }

    // Mode 1: single text
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(422).send({ error: 'Provide either "text" or both "account_id" and "provider_post_id"' })
    }
    return reply.send(analyzeSentiment(text.trim()))
  })
}
