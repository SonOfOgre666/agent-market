/** Workspace membership roles from GET /api/me → workspace.role */

export function isWorkspaceAdmin(role) {
  return role === 'owner' || role === 'admin'
}

export function workspaceRoleLabel(role) {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return 'Member'
}

export function workspaceRoleBadgeClass(role) {
  if (role === 'owner') return 'badge badge-info'
  if (role === 'admin') return 'badge badge-warning'
  return 'badge'
}
