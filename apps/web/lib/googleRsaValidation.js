/** Google responsive search ad (RSA) requirements for publish. */

export function parseRsaLines(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** @returns {{ headlines: string[], descriptions: string[], linkUrl: string }} */
export function googleRsaDraft(values = {}) {
  return {
    headlines: parseRsaLines(values.headlines),
    descriptions: parseRsaLines(values.descriptions),
    linkUrl: (values.final_url || values.link_url || '').trim(),
  }
}

/**
 * Validate RSA fields for publish (reference create_responsive_search_ad).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateGoogleRsaForPublish(values = {}) {
  const { headlines, descriptions, linkUrl } = googleRsaDraft(values)
  const errors = []

  if (!linkUrl) {
    errors.push('Final URL is required (Ads step).')
  }
  if (headlines.length < 3) {
    errors.push(
      `At least 3 headlines required (one per line). You have ${headlines.length} — add ${Math.max(0, 3 - headlines.length)} more on the Ads step.`,
    )
  }
  if (descriptions.length < 2) {
    errors.push(
      `At least 2 descriptions required (one per line). You have ${descriptions.length}.`,
    )
  }
  for (const h of headlines) {
    if (h.length > 30) {
      errors.push(`Headline "${h.slice(0, 20)}…" exceeds 30 characters.`)
      break
    }
  }
  for (const d of descriptions) {
    if (d.length > 90) {
      errors.push(`Description "${d.slice(0, 24)}…" exceeds 90 characters.`)
      break
    }
  }

  return { ok: errors.length === 0, errors }
}
