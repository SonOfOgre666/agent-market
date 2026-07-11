import * as Workspace from '../models/Workspace.js'

export async function authenticate(request, reply) {
  try {
    await request.jwtVerify()
    // Attach workspace_id from token to request for easy access in routes
    request.workspace_id = request.user.workspace_id || null
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}

// Middleware that also verifies the user is a member of the workspace
export async function authenticateWorkspace(request, reply) {
  try {
    await request.jwtVerify()
    const workspaceId = request.user.workspace_id
    if (!workspaceId) return reply.code(403).send({ error: 'No workspace selected' })

    const workspace = await Workspace.findById(workspaceId)
    if (!workspace) return reply.code(403).send({ error: 'Workspace not found' })

    const member = Workspace.getMember(workspace, request.user.id)
    if (!member) return reply.code(403).send({ error: 'Access denied to this workspace' })

    request.workspace_id = workspaceId
    request.workspace = workspace
    request.workspace_role = member.role
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}

/** Requires authenticate first — owner or admin only. */
export async function requireWorkspaceAdmin(request, reply) {
  const workspaceId = request.workspace_id || request.user?.workspace_id
  if (!workspaceId) return reply.code(403).send({ error: 'No workspace selected' })

  const workspace = await Workspace.findById(workspaceId)
  if (!workspace) return reply.code(403).send({ error: 'Workspace not found' })

  const member = Workspace.getMember(workspace, request.user.id)
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return reply.code(403).send({ error: 'Admin access required' })
  }

  request.workspace = workspace
  request.workspace_role = member.role
}
