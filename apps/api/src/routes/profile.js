import { authenticate } from '../middleware/auth.js'
import * as User from '../models/User.js'

export default async function profileRoutes(app) {
  // GET /api/profile
  app.get('/profile', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await User.findById(request.user.id)
    return reply.send(User.sanitize(user))
  })

  // PUT /api/profile/user
  app.put('/profile/user', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, email } = request.body || {}
    if (!name && !email) return reply.code(422).send({ error: 'Nothing to update' })
    const updated = await User.updateUser(request.user.id, { ...(name && { name }), ...(email && { email }) })
    return reply.send(User.sanitize(updated))
  })

  // PUT /api/profile/password
  app.put('/profile/password', { preHandler: [authenticate] }, async (request, reply) => {
    const { current_password, password, password_confirmation } = request.body || {}
    if (!current_password || !password) return reply.code(422).send({ error: 'All password fields are required' })
    if (password !== password_confirmation) return reply.code(422).send({ error: 'Passwords do not match' })

    const user = await User.findById(request.user.id)
    const valid = await User.verifyPassword(current_password, user.password)
    if (!valid) return reply.code(422).send({ error: 'Current password is incorrect' })

    await User.updateUser(request.user.id, { password })
    return reply.send({ message: 'Password updated' })
  })
}
