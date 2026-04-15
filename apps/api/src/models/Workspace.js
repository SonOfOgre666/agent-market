import { getDb } from '../db/mongodb.js'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

export const COLLECTION = 'workspaces'

export async function findById(id) {
  return getDb().collection(COLLECTION).findOne({ _id: new ObjectId(id) })
}

export async function findByUserId(userId) {
  return getDb().collection(COLLECTION).find({
    'members.user_id': userId,
    deleted_at: null,
  }).sort({ created_at: 1 }).toArray()
}

export async function createWorkspace({ name, owner_id }) {
  const doc = {
    name,
    owner_id,
    members: [{ user_id: owner_id, role: 'owner', joined_at: new Date() }],
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  }
  const result = await getDb().collection(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function updateWorkspace(id, fields) {
  fields.updated_at = new Date()
  await getDb().collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: fields })
  return findById(id)
}

export async function addMember(workspaceId, { user_id, role = 'member' }) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(workspaceId) },
    {
      $push: { members: { user_id, role, joined_at: new Date() } },
      $set:  { updated_at: new Date() },
    }
  )
}

export async function removeMember(workspaceId, userId) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(workspaceId) },
    {
      $pull: { members: { user_id: userId } },
      $set:  { updated_at: new Date() },
    }
  )
}

export async function updateMemberRole(workspaceId, userId, role) {
  await getDb().collection(COLLECTION).updateOne(
    { _id: new ObjectId(workspaceId), 'members.user_id': userId },
    { $set: { 'members.$.role': role, updated_at: new Date() } }
  )
}

export function getMember(workspace, userId) {
  return workspace?.members?.find(m => m.user_id === userId) || null
}

// ── Invite tokens ──────────────────────────────────────────────────────────

export async function createInvite({ workspace_id, email, role = 'member', invited_by }) {
  const token = nanoid(32)
  const doc = {
    token,
    workspace_id,
    email: email.toLowerCase(),
    role,
    invited_by,
    used: false,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    created_at: new Date(),
  }
  await getDb().collection('workspace_invites').insertOne(doc)
  return doc
}

export async function findInviteByToken(token) {
  return getDb().collection('workspace_invites').findOne({ token, used: false })
}

export async function markInviteUsed(token) {
  await getDb().collection('workspace_invites').updateOne({ token }, { $set: { used: true } })
}

export async function listInvites(workspace_id) {
  return getDb().collection('workspace_invites').find({
    workspace_id,
    used: false,
    expires_at: { $gt: new Date() },
  }).sort({ created_at: -1 }).toArray()
}

export async function deleteInvite(token, workspace_id) {
  await getDb().collection('workspace_invites').deleteOne({ token, workspace_id })
}
