/**
 * Parse Google Ads keyword input for UI + Mongo targeting.keyword_entries.
 * Formats (one per line):
 *   buy shoes
 *   running gear | PHRASE
 *   [EXACT] premium widgets
 */

const MATCH_TYPES = new Set(['BROAD', 'PHRASE', 'EXACT'])

export function normalizeMatchType(raw, fallback = 'BROAD') {
  const u = String(raw || fallback).trim().toUpperCase()
  return MATCH_TYPES.has(u) ? u : 'BROAD'
}

/** @returns {{ text: string, match_type: string }[]} */
export function parseGoogleKeywordEntries(text, defaultMatchType = 'BROAD') {
  const def = normalizeMatchType(defaultMatchType)
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const out = []
  for (const line of lines) {
    let matchType = def
    let kwText = line

    const bracket = line.match(/^\[(BROAD|PHRASE|EXACT)\]\s*(.+)$/i)
    if (bracket) {
      matchType = normalizeMatchType(bracket[1])
      kwText = bracket[2].trim()
    } else if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim())
      if (parts.length >= 2 && MATCH_TYPES.has(parts[parts.length - 1].toUpperCase())) {
        matchType = normalizeMatchType(parts.pop())
        kwText = parts.join('|').trim()
      }
    }

    if (kwText) out.push({ text: kwText, match_type: matchType })
  }
  return out
}

/** Flat keyword strings for legacy campaign.keywords array. */
export function keywordTextsFromEntries(entries) {
  return (entries || []).map((e) => e.text).filter(Boolean)
}
