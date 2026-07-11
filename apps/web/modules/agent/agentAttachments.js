/** Normalize media library items for agent chat attachments. */
export function toAgentAttachment(item) {
  if (!item?.id) return null
  const mime = item.mime_type || ''
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) return null
  return {
    id: String(item.id),
    name: item.name || 'Media',
    mime_type: mime,
    url: item.url || '',
  }
}

export function isVideoAttachment(att) {
  return Boolean(att?.mime_type?.startsWith('video/'))
}

export function primaryAttachment(attachments = []) {
  if (!attachments?.length) return null
  return attachments.find(isVideoAttachment) || attachments[0]
}
