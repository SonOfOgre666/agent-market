/** Derive an editable landing-page plan from a natural-language marketing brief. */

const GOAL_DISPLAY = {
  leads: 'Generate leads',
  traffic: 'Drive traffic',
  conversions: 'Drive conversions',
  awareness: 'Build awareness',
}

const TONE_LABELS = {
  marketing: 'Marketing',
  professional: 'Professional',
  friendly: 'Friendly',
  urgent: 'Urgent',
}

function firstSentence(text) {
  const m = String(text || '').trim().match(/^(.+?[.!?])(?:\s|$)/)
  return (m ? m[1] : String(text || '').trim().slice(0, 120)).trim()
}

function lineValue(prompt, label) {
  const m = String(prompt || '').match(new RegExp(`${label}:\\s*(.+)`, 'i'))
  return m?.[1]?.trim() || ''
}

function extractTitle(prompt) {
  const text = String(prompt || '').trim()
  for (const pattern of [
    /landing page (?:for|about)\s+(.+?)(?:\.|$)/i,
    /(?:promote|market|sell)\s+(.+?)(?:\.|$)/i,
    /(?:trip|tour|offer|campaign)\s+(?:to|for)\s+(.+?)(?:\.|$)/i,
    /page for (?:my )?(.+?)(?:\.|$)/i,
  ]) {
    const m = text.match(pattern)
    if (m?.[1]) return m[1].trim().slice(0, 120)
  }
  const sentence = firstSentence(text)
  return sentence.slice(0, 80) || 'New landing page'
}

function extractAudience(prompt) {
  const fromLine = lineValue(prompt, 'Audience')
  if (fromLine) return fromLine.slice(0, 160)
  const m = String(prompt || '').match(/\bfor\s+([^.!?\n]+)/i)
  if (m?.[1]) return m[1].trim().slice(0, 160)
  return ''
}

function extractBusiness(prompt) {
  const fromLine = lineValue(prompt, 'Business')
  if (fromLine) return fromLine.slice(0, 80)

  const lower = String(prompt || '').toLowerCase()
  if (/\b(tour|travel|trip|tourism|vacation|hotel|marrakech|morocco|fes|fez)\b/.test(lower)) return 'Tourism'
  if (/\b(restaurant|dining|cafe|food|bistro)\b/.test(lower)) return 'Food & hospitality'
  if (/\b(saas|software|app|waitlist|startup|platform)\b/.test(lower)) return 'SaaS / technology'
  if (/\b(clothing|fashion|apparel|brand|boutique)\b/.test(lower)) return 'Retail / fashion'
  if (/\b(google ads|ad campaign|ppc|marketing campaign)\b/.test(lower)) return 'Digital marketing'
  return 'Your business'
}

function extractOffer(prompt, business) {
  const lower = String(prompt || '').toLowerCase()
  const cityMatch = lower.match(/\b(fes|fez|marrakech|morocco|casablanca|rabat)\b/)

  if (/\bguided tour/.test(lower)) {
    if (cityMatch) {
      const city = cityMatch[1].charAt(0).toUpperCase() + cityMatch[1].slice(1)
      return `Guided tours of ${city}`
    }
    return 'Guided tours'
  }
  if (/\b(tour|trip|travel package|getaway)\b/.test(lower) && cityMatch) {
    const city = cityMatch[1].charAt(0).toUpperCase() + cityMatch[1].slice(1)
    return `Travel experiences in ${city}`
  }
  if (/\bsummer sale\b/.test(lower)) return 'Summer sale promotion'
  if (/\bwaitlist\b/.test(lower)) return 'Product waitlist sign-up'
  if (/\brestaurant\b/.test(lower)) return 'Restaurant reservations & dining'
  if (/\bnew restaurant\b/.test(lower)) return 'New restaurant launch'

  const action = lineValue(prompt, 'Desired action')
  if (action) return action.slice(0, 120)

  if (business === 'Tourism') return 'Travel packages & experiences'
  if (business === 'SaaS / technology') return 'Software product access'
  return extractTitle(prompt)
}

function extractSeoPhrases(prompt, business, offer) {
  const lower = String(prompt || '').toLowerCase()
  const phrases = []

  if (/\bfes\b|\bfez\b/.test(lower)) {
    phrases.push('Fes tours', 'Visit Fes', 'Morocco travel')
  } else if (/\bmarrakech\b/.test(lower)) {
    phrases.push('Marrakech tours', 'Visit Marrakech', 'Morocco travel')
  } else if (/\bmorocco\b/.test(lower)) {
    phrases.push('Morocco travel', 'Morocco tours', 'Visit Morocco')
  }

  if (/\bsummer sale\b/.test(lower)) {
    phrases.push('Summer sale', 'Fashion deals', 'Clothing discounts')
  }
  if (/\bwaitlist\b/.test(lower)) {
    phrases.push('SaaS waitlist', 'Early access', 'Software launch')
  }
  if (/\brestaurant\b/.test(lower)) {
    phrases.push('Restaurant booking', 'Dining experience', 'New restaurant')
  }

  if (phrases.length < 3) {
    const stop = new Set(['the', 'and', 'for', 'with', 'your', 'our', 'from', 'that', 'this', 'will', 'book', 'get', 'need', 'page', 'landing', 'create', 'offer'])
    const words = lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w))
    const unique = [...new Set(words)]
    for (let i = 0; i < unique.length && phrases.length < 5; i++) {
      const phrase = unique.slice(i, i + 2).join(' ')
      if (phrase.length > 4 && !phrases.includes(phrase)) phrases.push(phrase.charAt(0).toUpperCase() + phrase.slice(1))
    }
  }

  if (offer && phrases.length < 5 && !phrases.some(p => p.toLowerCase().includes(offer.toLowerCase().slice(0, 12)))) {
    phrases.unshift(offer)
  }

  return [...new Set(phrases)].slice(0, 6)
}

function formatToneDisplay(toneSlug, prompt, business) {
  const lower = String(prompt || '').toLowerCase()
  if (toneSlug === 'professional' && business === 'Tourism') return 'Professional & inspiring'
  if (/\b(inspire|inspiring|magic|unforgettable|premium|luxury)\b/.test(lower)) return 'Professional & inspiring'
  if (toneSlug === 'friendly' && business === 'Food & hospitality') return 'Warm & welcoming'
  return TONE_LABELS[toneSlug] || TONE_LABELS.marketing
}

function buildAssumptions({ business, offer, audience, goal, prompt }) {
  const assumptions = []
  const lower = String(prompt || '').toLowerCase()

  if (offer && offer !== 'New landing page') {
    assumptions.push(`You offer ${offer.charAt(0).toLowerCase() + offer.slice(1)}`)
  }

  if (audience && !/^prospects interested/i.test(audience)) {
    assumptions.push(`Targeting ${audience.charAt(0).toLowerCase() + audience.slice(1)}`)
  } else if (business === 'Tourism') {
    assumptions.push('Targeting English-speaking travelers')
  }

  if (goal === 'leads' || goal === 'Generate leads') {
    assumptions.push('The primary conversion is a lead form submission')
  }

  if (/\bgoogle ads\b/.test(lower)) {
    assumptions.push('This page will receive paid search or ad traffic')
  }

  if (assumptions.length < 2) {
    assumptions.push('Visitors should understand your offer within the first screen')
  }

  return [...new Set(assumptions)].slice(0, 4)
}

export function inferGoal(prompt) {
  const lower = String(prompt || '').toLowerCase()
  if (/\b(waitlist|collect email|sign up|signup|lead|quote|contact|book a call|register|subscribe)\b/.test(lower)) return 'leads'
  if (/\b(sale|buy|shop|purchase|convert|checkout|order)\b/.test(lower)) return 'conversions'
  if (/\b(awareness|brand|introduce|launch|discover)\b/.test(lower)) return 'awareness'
  if (/\b(traffic|click|visit|google ads|campaign|promote)\b/.test(lower)) return 'traffic'
  return 'leads'
}

export function inferTone(prompt) {
  const lower = String(prompt || '').toLowerCase()
  if (/\b(urgent|limited time|hurry|last chance|today only|ending soon)\b/.test(lower)) return 'urgent'
  if (/\b(professional|enterprise|b2b|corporate|business|inspiring|premium|luxury)\b/.test(lower)) return 'professional'
  if (/\b(friendly|warm|welcome|community|cozy)\b/.test(lower)) return 'friendly'
  return 'marketing'
}

export function getFollowUpQuestions(prompt) {
  const trimmed = String(prompt || '').trim()
  const lower = trimmed.toLowerCase()
  const questions = []

  if (trimmed.length < 30) {
    questions.push({
      id: 'business',
      label: 'What is your business or offer?',
      placeholder: 'e.g. Italian restaurant in downtown Austin',
    })
  }
  if (!/\b(for|audience|customers|users|people|families|buyers)\b/i.test(trimmed) && trimmed.length < 90) {
    questions.push({
      id: 'audience',
      label: 'Who is this page for?',
      placeholder: 'e.g. Local families, tourists, small business owners…',
    })
  }
  if (!/\b(sign up|collect|email|buy|book|contact|call|download|waitlist|lead|register|shop|reserve|order)\b/i.test(lower)) {
    questions.push({
      id: 'action',
      label: 'What should visitors do on this page?',
      placeholder: 'e.g. Join the waitlist, book a table, request a quote',
    })
  }

  return questions.slice(0, 2)
}

export function enrichPromptWithFollowUps(prompt, answers = {}) {
  const parts = [String(prompt || '').trim()]
  if (answers.business?.trim()) parts.push(`Business: ${answers.business.trim()}`)
  if (answers.audience?.trim()) parts.push(`Audience: ${answers.audience.trim()}`)
  if (answers.action?.trim()) parts.push(`Desired action: ${answers.action.trim()}`)
  return parts.filter(Boolean).join('\n')
}

export function detectLanguageFromText(text) {
  const raw = String(text || '').trim()
  if (!raw) return 'en'
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(raw)) return 'ar'
  const lower = raw.toLowerCase()
  if (/[àâäéèêëïîôùûüç]/.test(lower) || /\b(pour|une|des|créer|page|mon|ma|vos|avec)\b/.test(lower)) return 'fr'
  if (/[ñáéíóúü]/.test(lower) || /\b(para|una|página|crear|con)\b/.test(lower)) return 'es'
  if (/[äöüß]/.test(lower) || /\b(für|eine|mein|seite)\b/.test(lower)) return 'de'
  if (/\b(per|una|mio|creare|pagina)\b/.test(lower)) return 'it'
  if (/\b(para|uma|meu|criar|página)\b/.test(lower)) return 'pt'
  return 'en'
}

const LANGUAGE_LABELS = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  ar: 'Arabic',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  tr: 'Turkish',
}

export function languageLabel(code) {
  const key = String(code || 'en').trim().toLowerCase().slice(0, 2)
  return LANGUAGE_LABELS[key] || key.toUpperCase()
}

export function resolvePlanLanguage(data, sourcePrompt = '') {
  const fromLlm = String(data?.language || '').trim().toLowerCase().slice(0, 5)
  const detected = detectLanguageFromText(sourcePrompt)
  if (fromLlm && fromLlm !== 'auto' && fromLlm !== 'en') return fromLlm
  if (detected && detected !== 'en') return detected
  return fromLlm || detected || 'en'
}

export function sanitizeSlug(input) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'landing-page'
}

function suggestPageTitle(offer, business) {
  const o = String(offer || '').trim()
  if (o && o !== 'New landing page') return o.slice(0, 80)
  const b = String(business || '').trim()
  if (b && b !== 'Your business') return `${b} Landing Page`
  return 'New landing page'
}

function suggestSlugFromPlan({ slug, title, seo_keywords, offer }) {
  const fromLlm = sanitizeSlug(slug)
  if (slug && fromLlm !== 'landing-page') return fromLlm
  const fromSeo = seo_keywords?.[0] ? sanitizeSlug(seo_keywords[0]) : ''
  if (fromSeo && fromSeo !== 'landing-page') return fromSeo
  return sanitizeSlug(title || offer)
}

export function normalizePlanFromLlm(data, sourcePrompt = '') {
  const seo_keywords = Array.isArray(data?.seo_keywords)
    ? data.seo_keywords.map(String).map(s => s.trim()).filter(Boolean)
    : String(data?.seo_keywords || data?.keywords || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

  const followUpQuestions = (data?.follow_up_questions || []).map((q, i) => ({
    id: q.id || `q_${i}`,
    label: q.label || q.question || '',
    placeholder: q.placeholder || '',
  })).filter(q => q.label)

  const assumptions = Array.isArray(data?.assumptions)
    ? data.assumptions.map(String).map(s => s.trim()).filter(Boolean)
    : []

  const title = String(data?.title || '').trim() || suggestPageTitle(data?.offer, data?.business)
  const offer = String(data?.offer || '').trim()
  const slug = suggestSlugFromPlan({
    slug: data?.slug,
    title,
    seo_keywords,
    offer,
  })

  const language = resolvePlanLanguage(data, sourcePrompt)

  return {
    title,
    slug,
    business: String(data?.business || '').trim(),
    goal: String(data?.goal || 'Generate leads').trim(),
    audience: String(data?.audience || '').trim(),
    offer,
    tone: String(data?.tone || 'Marketing').trim(),
    seo_keywords,
    keywords: seo_keywords.join(', '),
    assumptions,
    headline_hint: String(data?.headline_hint || title).trim(),
    key_message: String(data?.key_message || sourcePrompt || '').trim(),
    campaign_id: '',
    language,
    language_label: languageLabel(language),
    followUpQuestions,
  }
}

export function extractLandingPagePlan({ prompt }) {
  const trimmed = String(prompt || '').trim()
  const goalKey = inferGoal(trimmed)
  const toneSlug = inferTone(trimmed)
  const business = extractBusiness(trimmed)
  const offer = extractOffer(trimmed, business)
  const audience = extractAudience(trimmed) || 'People interested in your offer'
  const seo_keywords = extractSeoPhrases(trimmed, business, offer)
  const tone = formatToneDisplay(toneSlug, trimmed, business)
  const goal = GOAL_DISPLAY[goalKey] || GOAL_DISPLAY.leads
  const title = suggestPageTitle(offer, business)
  const slug = suggestSlugFromPlan({ title, seo_keywords, offer })
  const assumptions = buildAssumptions({ business, offer, audience, goal: goalKey, prompt: trimmed })

  const language = detectLanguageFromText(trimmed)

  return {
    title,
    slug,
    business,
    goal,
    audience,
    offer,
    tone,
    seo_keywords,
    keywords: seo_keywords.join(', '),
    assumptions,
    headline_hint: firstSentence(trimmed) || title,
    key_message: trimmed,
    campaign_id: '',
    language,
    language_label: languageLabel(language),
    followUpQuestions: getFollowUpQuestions(trimmed),
  }
}

export function buildSeoMeta({ headline, subheadline, body, keywords }) {
  const meta_title = (headline || '').trim().slice(0, 60)
  const rawDesc = (subheadline || body || '').replace(/\s+/g, ' ').trim()
  const meta_description = rawDesc.slice(0, 160)
  const kw = Array.isArray(keywords) ? keywords : String(keywords || '').split(',')
  const meta_keywords = kw.map(k => String(k).trim()).filter(Boolean).join(', ')
  return { meta_title, meta_description, meta_keywords }
}
