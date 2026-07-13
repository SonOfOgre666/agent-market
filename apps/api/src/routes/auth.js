import * as User from '../models/User.js'
import * as Workspace from '../models/Workspace.js'
import { authenticate } from '../middleware/auth.js'

function signToken(app, user, workspaceId) {
  return app.jwt.sign(
    { id: user._id.toString(), email: user.email, workspace_id: workspaceId },
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

export default async function authRoutes(app) {
  // POST /api/login
  app.post('/login', async (request, reply) => {
    const { email, password } = request.body || {}
    if (!email || !password) return reply.code(422).send({ error: 'Email and password are required' })

    const user = await User.findByEmail(email)
    if (!user || !(await User.verifyPassword(password, user.password))) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    // Get user's first (or only) workspace
    const workspaces = await Workspace.findByUserId(user._id.toString())
    const workspace = workspaces[0] || null
    const workspaceId = workspace?._id?.toString() || null

    const token = signToken(app, user, workspaceId)
    return reply.send({ token, user: User.sanitize(user), workspace: workspace ? sanitizeWorkspace(workspace, user._id.toString()) : null })
  })

  // POST /api/register — first user or via invite token
  app.post('/register', async (request, reply) => {
    const { name, email, password, invite_token } = request.body || {}
    if (!name || !email || !password) return reply.code(422).send({ error: 'All fields required' })

    const existing = await User.findByEmail(email)
    if (existing) return reply.code(422).send({ error: 'Email already in use' })

    const user = await User.createUser({ name, email, password })
    const userId = user._id.toString()

    // If an invite token was provided, join that workspace instead of creating a new one
    if (invite_token) {
      const invite = await Workspace.findInviteByToken(invite_token)
      if (!invite) return reply.code(422).send({ error: 'Invalid or expired invite link' })
      if (new Date() > new Date(invite.expires_at)) return reply.code(422).send({ error: 'Invite link has expired' })

      await Workspace.addMember(invite.workspace_id, { user_id: userId, role: invite.role })
      await Workspace.markInviteUsed(invite_token)

      const workspace = await Workspace.findById(invite.workspace_id)
      const token = signToken(app, user, invite.workspace_id)
      return reply.code(201).send({ token, user: User.sanitize(user), workspace: sanitizeWorkspace(workspace, userId) })
    }

    // No invite — create a personal workspace for this user
    const workspace = await Workspace.createWorkspace({ name: `${name}'s Workspace`, owner_id: userId })
    const workspaceId = workspace._id.toString()

    const token = signToken(app, user, workspaceId)
    return reply.code(201).send({ token, user: User.sanitize(user), workspace: sanitizeWorkspace(workspace, userId) })
  })

  // POST /api/logout
  app.post('/logout', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send({ message: 'Logged out' })
  })

  // GET /api/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await User.findById(request.user.id)
    if (!user) return reply.code(401).send({ error: 'User not found' })

    const workspaces = await Workspace.findByUserId(request.user.id)
    const workspace = workspaces.find(w => w._id.toString() === request.user.workspace_id) || workspaces[0] || null
    return reply.send({
      ...User.sanitize(user),
      workspace: workspace ? sanitizeWorkspace(workspace, request.user.id) : null,
      workspaces: workspaces.map(w => sanitizeWorkspace(w, request.user.id)),
    })
  })

  // POST /api/switch-workspace
  app.post('/switch-workspace', { preHandler: [authenticate] }, async (request, reply) => {
    const { workspace_id } = request.body || {}
    const workspaces = await Workspace.findByUserId(request.user.id)
    const workspace = workspaces.find(w => w._id.toString() === workspace_id)
    if (!workspace) return reply.code(403).send({ error: 'Workspace not found or access denied' })

    const user = await User.findById(request.user.id)
    const token = signToken(app, user, workspace_id)
    return reply.send({ token, workspace: sanitizeWorkspace(workspace, request.user.id) })
  })
}

function sanitizeWorkspace(workspace, userId) {
  if (!workspace) return null
  const member = Workspace.getMember(workspace, userId)
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    role: member?.role || 'member',
    member_count: workspace.members?.length || 1,
  }
}
