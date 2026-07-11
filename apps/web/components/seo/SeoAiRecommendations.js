'use client'

import { Sparkles } from 'lucide-react'
import { useToast } from '../Toast.js'

const RECOMMENDATIONS = [
  { id: 'title', label: 'Improve title', prompt: (p) => `Rewrite the SEO page title for "${p.title || p.slug}" to be compelling, under 60 characters, and keyword-rich.` },
  { id: 'h1', label: 'Rewrite H1', prompt: (p) => `Rewrite the main headline (H1) for "${p.title || p.slug}" to be clear, benefit-driven, and under 70 characters.` },
  { id: 'meta', label: 'Add meta description', prompt: (p) => `Write a meta description (150–160 chars) for the landing page "${p.title || p.slug}".` },
  { id: 'cta', label: 'Improve CTA', prompt: (p) => `Suggest 3 stronger call-to-action options for "${p.title || p.slug}".` },
  { id: 'faq', label: 'Generate FAQ', prompt: (p) => `Generate 5 FAQ items with schema-ready Q&A for "${p.title || p.slug}".` },
  { id: 'schema', label: 'Generate Schema', prompt: (p) => `Generate JSON-LD schema markup (WebPage + FAQPage if relevant) for "${p.title || p.slug}".` },
  { id: 'headings', label: 'Optimize headings', prompt: (p) => `Suggest an H1–H3 outline with target keywords for "${p.title || p.slug}".` },
  { id: 'a11y', label: 'Fix accessibility', prompt: (p) => `List accessibility improvements for "${p.title || p.slug}" (contrast, labels, structure).` },
]

export default function SeoAiRecommendations({ page }) {
  const toast = useToast()
  if (!page) return null

  async function runAction(rec) {
    const text = rec.prompt(page)
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Copied "${rec.label}" prompt — paste in AI Agent to run`)
    } catch {
      toast.info(text.slice(0, 120) + '…')
    }
  }

  return (
    <div className="seo-ai-recs">
      <div className="seo-ai-recs-header">
        <Sparkles size={14} />
        <span>AI Recommendations</span>
      </div>
      <div className="seo-ai-recs-grid">
        {RECOMMENDATIONS.map((rec) => (
          <button
            key={rec.id}
            type="button"
            className="seo-ai-rec-btn"
            onClick={() => runAction(rec)}
          >
            {rec.label}
          </button>
        ))}
      </div>
    </div>
  )
}
