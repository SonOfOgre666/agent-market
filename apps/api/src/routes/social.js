import { getDb } from '../db/mongodb.js'
import { getRedis } from '../db/redis.js'
import { nanoid } from 'nanoid'

const COLLECTION = 'social_posts'

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
  return { sentiment, score, keywords: { positive: [...new Set(matched.positive)], negative: [...new Set(matched.negative)] } }
}

export default async function socialRoutes(app) {

  // POST /api/social/posts/draft
  // Body: { userId, channel, text, media? }
  app.post('/social/posts/draft', async (request, reply) => {
    const { userId, channel, text, media } = request.body || {}
    if (!userId) return reply.code(422).send({ error: 'userId is required' })
    if (!channel) return reply.code(422).send({ error: 'channel is required' })
    if (!text) return reply.code(422).send({ error: 'text is required' })

    const db = getDb()
    const post = {
      uuid: nanoid(),
      userId,
      channel,
      text,
      media: media || [],
      status: 'draft',
      scheduledAt: null,
      publishedAt: null,
      providerPostId: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection(COLLECTION).insertOne(post)

    // Emit realtime event
    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    getRedis().publish(eventsChannel, JSON.stringify({ event: 'post.drafted', postId: post.uuid, userId, channel }))

    return reply.code(201).send({ id: post.uuid, status: 'draft', message: 'Draft created successfully' })
  })

  // POST /api/social/posts/schedule
  // Body: { userId, channel, text, scheduledAt, media? }
  app.post('/social/posts/schedule', async (request, reply) => {
    const { userId, channel, text, scheduledAt, media } = request.body || {}
    if (!userId) return reply.code(422).send({ error: 'userId is required' })
    if (!channel) return reply.code(422).send({ error: 'channel is required' })
    if (!text) return reply.code(422).send({ error: 'text is required' })
    if (!scheduledAt) return reply.code(422).send({ error: 'scheduledAt is required (ISO datetime)' })

    const scheduledDate = new Date(scheduledAt)
    if (isNaN(scheduledDate.getTime())) {
      return reply.code(422).send({ error: 'scheduledAt must be a valid ISO datetime' })
    }

    const db = getDb()
    const post = {
      uuid: nanoid(),
      userId,
      channel,
      text,
      media: media || [],
      status: 'scheduled',
      scheduledAt: scheduledDate,
      publishedAt: null,
      providerPostId: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection(COLLECTION).insertOne(post)

    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    getRedis().publish(eventsChannel, JSON.stringify({ event: 'post.scheduled', postId: post.uuid, userId, channel, scheduledAt }))

    return reply.code(201).send({ id: post.uuid, status: 'scheduled', scheduledAt: scheduledDate.toISOString() })
  })

  // GET /api/social/posts?userId=wetaxi
  app.get('/social/posts', async (request, reply) => {
    const { userId, channel, status, page = 1, per_page = 20 } = request.query
    if (!userId) return reply.code(422).send({ error: 'userId query param is required' })

    const db = getDb()
    const filter = { userId }
    if (channel) filter.channel = channel
    if (status) filter.status = status

    const skip = (parseInt(page) - 1) * parseInt(per_page)
    const [items, total] = await Promise.all([
      db.collection(COLLECTION).find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(per_page)).toArray(),
      db.collection(COLLECTION).countDocuments(filter),
    ])

    return reply.send({
      items: items.map(p => ({
        id: p.uuid,
        userId: p.userId,
        channel: p.channel,
        text: p.text,
        media: p.media,
        status: p.status,
        scheduledAt: p.scheduledAt,
        publishedAt: p.publishedAt,
        providerPostId: p.providerPostId,
        createdAt: p.createdAt,
      })),
      total,
      page: parseInt(page),
      per_page: parseInt(per_page),
    })
  })

  // POST /api/social/posts/:postId/publish-now
  app.post('/social/posts/:postId/publish-now', async (request, reply) => {
    const { postId } = request.params
    const db = getDb()
    const post = await db.collection(COLLECTION).findOne({ uuid: postId })
    if (!post) return reply.code(404).send({ error: 'Post not found' })
    if (post.status === 'published') return reply.code(422).send({ error: 'Post already published' })

    // Mark as processing and push to Celery queue via Redis
    await db.collection(COLLECTION).updateOne({ uuid: postId }, {
      $set: { status: 'processing', updatedAt: new Date() },
    })

    const eventsChannel = process.env.EVENTS_CHANNEL || 'agent_market:events'
    getRedis().publish(eventsChannel, JSON.stringify({ event: 'post.publish_requested', postId, userId: post.userId, channel: post.channel }))

    // Push task to Celery via Redis
    const taskId = nanoid()
    const task = {
      id: taskId,
      task: 'tasks.publish_social_post',
      args: [postId],
      kwargs: {},
      retries: 0,
      eta: null,
      expires: null,
      utc: true,
      callbacks: null,
      errbacks: null,
      timelimit: [null, null],
      taskset: null,
      chord: null,
    }
    await getRedis().lpush('celery', JSON.stringify(task))

    return reply.send({ id: postId, status: 'processing', message: 'Post queued for immediate publication' })
  })

  // POST /api/social/comments/analyze
  app.post('/social/comments/analyze', async (request, reply) => {
    const { text } = request.body || {}
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(422).send({ error: 'text is required' })
    }
    return reply.send(analyzeSentiment(text.trim()))
  })
}
