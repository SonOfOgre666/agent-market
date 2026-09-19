import { getDb } from '../lib/mongo.js'
import bcrypt from 'bcryptjs'

export const COLLECTION = 'users'

export async function findById(id) {
  const { ObjectId } = await import('mongodb')
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id) })
}

export async function findByIds(ids) {
  const { ObjectId } = await import('mongodb')
  const objectIds = ids.map(id => { try { return new ObjectId(id) } catch { return null } }).filter(Boolean)
  return getDb().collection(COLLECTION).find({ _id: { $in: objectIds } }).toArray()
}

export async function findByEmail(email) {
  return getDb().collection(COLLECTION).findOne({ email: email.toLowerCase() })
}

export async function createUser({ name, email, password }) {
  const hash = await bcrypt.hash(password, 12)
  const doc = { name, email: email.toLowerCase(), password: hash, created_at: new Date(), updated_at: new Date() }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateUser(id, fields) {
  const { ObjectId } = await import('mongodb')
  if (fields.password) fields.password = await bcrypt.hash(fields.password, 12)
  fields.updated_at = new Date()
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: fields })
  return findById(id)
}

export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

export function sanitize(user) {
  if (!user) return null
  const { password, ...safe } = user
  return { ...safe, id: safe._id?.toString() }
}
