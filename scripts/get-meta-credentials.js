import { MongoClient } from 'mongodb'
import crypto from 'crypto'

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agent-market'
const ENCRYPT_KEY = (process.env.APP_KEY || 'agentmarket-default-key-32bytes!!').slice(0, 32)

function decrypt(text) {
  const [ivHex, encHex] = text.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const enc = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv)
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()])
  return JSON.parse(decrypted.toString())
}

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db()

  // 1. Get META_APP_ID and META_APP_SECRET from encrypted integrations collection
  const coll = db.collection('integrations')
  const legacy = db.collection('services')
  const service =
    (await coll.findOne({ name: 'facebook' })) ||
    (legacy ? await legacy.findOne({ name: 'facebook' }) : null)
  let appId = ''
  let appSecret = ''
  if (service?.configuration) {
    const config = decrypt(service.configuration)
    appId = config.app_id || ''
    appSecret = config.app_secret || ''
  }

  // 2. Get access tokens, ad account IDs, page IDs from accounts collection
  const accounts = await db.collection('accounts').find({
    provider: { $in: ['facebook', 'instagram', 'meta_ads'] }
  }).toArray()

  const accessTokens = []
  const adAccountIds = []
  const pageIds = []

  for (const acc of accounts) {
    if (acc.access_token?.token) {
      accessTokens.push({ provider: acc.provider, name: acc.name, token: acc.access_token.token })
    }
    if (acc.data?.ad_account_id) {
      adAccountIds.push(acc.data.ad_account_id)
    }
    if (acc.data?.page_id) {
      pageIds.push(acc.data.page_id)
    }
  }

  console.log('META_APP_ID=' + appId)
  console.log('META_APP_SECRET=' + appSecret)
  console.log('')
  console.log('# Access tokens found:')
  for (const at of accessTokens) {
    console.log(`META_ACCESS_TOKEN (${at.provider} - ${at.name})=${at.token}`)
  }
  if (accessTokens.length === 0) {
    console.log('META_ACCESS_TOKEN=')
  }
  console.log('')
  console.log('# Ad account IDs found:')
  for (const id of adAccountIds) {
    console.log('META_AD_ACCOUNT_ID=' + id)
  }
  if (adAccountIds.length === 0) {
    console.log('META_AD_ACCOUNT_ID=act_')
  }
  console.log('')
  console.log('# Page IDs found:')
  for (const id of pageIds) {
    console.log('META_PAGE_ID=' + id)
  }
  if (pageIds.length === 0) {
    console.log('META_PAGE_ID=')
  }

  await client.close()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
