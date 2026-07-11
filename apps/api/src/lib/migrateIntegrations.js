/**
 * One-time rename: MongoDB collection `services` → `integrations` (preserves all documents).
 */
export async function migrateServicesToIntegrations(db) {
  const names = (await db.listCollections().toArray()).map((c) => c.name)
  if (!names.includes('services')) return false
  if (names.includes('integrations')) {
    console.warn('[MongoDB] Both services and integrations collections exist; skipping rename')
    return false
  }
  await db.collection('services').rename('integrations')
  console.log('[MongoDB] Renamed collection services → integrations')
  return true
}
