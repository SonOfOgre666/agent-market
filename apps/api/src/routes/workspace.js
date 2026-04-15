import { authenticate } from '../middleware/auth.js'
import * as Workspace from '../models/Workspace.js'
import * as User from '../models/User.js'
import { sendInviteEmail } from '../services/mailer.js'

export default async function workspaceRoutes(app) {
  // GET /api/workspace  — current workspace info + members
  app.get('/workspace', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    // Enrich members with user info
    const memberIds = workspace.members.map(m => m.user_id)
    const users = await User.findByIds(memberIds)
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]))

    const members = workspace.members.map(m => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      name: userMap[m.user_id]?.name || null,
      email: userMap[m.user_id]?.email || null,
    }))

    const invites = await Workspace.listInvites(request.workspace_id)

    return reply.send({
      workspace: {
        id: workspace._id.toString(),
        name: workspace.name,
        owner_id: workspace.owner_id,
        member_count: workspace.members.length,
        created_at: workspace.created_at,
      },
      members,
      invites: invites.map(i => ({
        token: i.token,
        email: i.email,
        role: i.role,
        expires_at: i.expires_at,
        created_at: i.created_at,
      })),
    })
  })

  // PATCH /api/workspace  — update workspace name
  app.patch('/workspace', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    // Only owners/admins can rename
    const member = Workspace.getMember(workspace, request.user.id)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return reply.code(403).send({ error: 'Only owners and admins can update workspace settings' })
    }

    const { name } = request.body || {}
    if (!name?.trim()) return reply.code(422).send({ error: 'Workspace name is required' })

    const updated = await Workspace.updateWorkspace(request.workspace_id, { name: name.trim() })
    return reply.send({ id: updated._id.toString(), name: updated.name })
  })

  // POST /api/workspace/invite  — create invite link
  app.post('/workspace/invite', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    const member = Workspace.getMember(workspace, request.user.id)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return reply.code(403).send({ error: 'Only owners and admins can invite members' })
    }

    const { email, role = 'member' } = request.body || {}
    if (!email) return reply.code(422).send({ error: 'email is required' })
    if (!['admin', 'member'].includes(role)) return reply.code(422).send({ error: 'role must be admin or member' })

    const invite = await Workspace.createInvite({
      workspace_id: request.workspace_id,
      email,
      role,
      invited_by: request.user.id,
    })

    const webUrl = process.env.NEXT_PUBLIC_WEB_URL || process.env.NEXT_PUBLIC_API_URL?.replace(':3001', ':3000') || 'http://localhost:3000'
    const inviteUrl = `${webUrl}/register?invite=${invite.token}`

    // Send email notification (non-blocking — don't fail the request if email fails)
    const inviter = await User.findById(request.user.id)
    sendInviteEmail({
      to: email,
      inviterName: inviter?.name || 'A teammate',
      workspaceName: workspace.name,
      inviteUrl,
      role,
    }).catch(err => console.error('[Mailer] Failed to send invite email:', err.message))

    return reply.code(201).send({
      token: invite.token,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      invite_url: inviteUrl,
    })
  })

  // DELETE /api/workspace/invites/:token  — revoke invite
  app.delete('/workspace/invites/:token', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    const member = Workspace.getMember(workspace, request.user.id)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return reply.code(403).send({ error: 'Only owners and admins can revoke invites' })
    }

    await Workspace.deleteInvite(request.params.token, request.workspace_id)
    return reply.code(204).send()
  })

  // PATCH /api/workspace/members/:userId  — change member role
  app.patch('/workspace/members/:userId', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    const requester = Workspace.getMember(workspace, request.user.id)
    if (!requester || requester.role !== 'owner') {
      return reply.code(403).send({ error: 'Only the workspace owner can change roles' })
    }

    const { role } = request.body || {}
    if (!['admin', 'member'].includes(role)) return reply.code(422).send({ error: 'role must be admin or member' })

    const target = Workspace.getMember(workspace, request.params.userId)
    if (!target) return reply.code(404).send({ error: 'Member not found' })
    if (target.role === 'owner') return reply.code(422).send({ error: 'Cannot change the owner role' })

    await Workspace.updateMemberRole(request.workspace_id, request.params.userId, role)
    return reply.send({ user_id: request.params.userId, role })
  })

  // DELETE /api/workspace/members/:userId  — remove member
  app.delete('/workspace/members/:userId', { preHandler: [authenticate] }, async (request, reply) => {
    const workspace = await Workspace.findById(request.workspace_id)
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' })

    const requester = Workspace.getMember(workspace, request.user.id)
    const isSelf = request.params.userId === request.user.id

    // Members can leave themselves; owners/admins can remove others
    if (!isSelf) {
      if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return reply.code(403).send({ error: 'Only owners and admins can remove members' })
      }
    }

    const target = Workspace.getMember(workspace, request.params.userId)
    if (!target) return reply.code(404).send({ error: 'Member not found' })
    if (target.role === 'owner' && !isSelf) return reply.code(422).send({ error: 'Cannot remove the workspace owner' })

    await Workspace.removeMember(request.workspace_id, request.params.userId)
    return reply.code(204).send()
  })
}
