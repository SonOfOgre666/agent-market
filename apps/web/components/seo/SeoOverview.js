'use client'

import {
  Search, Layers, Binoculars, TrendingUp, ChevronRight, Check,
} from 'lucide-react'
import { SEO_COLORS, WORKFLOW_STEPS } from './seoConstants.js'
import SeoHistoryPanel from './SeoHistoryPanel.js'

const FEATURE_CARDS = [
  {
    id: 'audit',
    icon: Search,
    color: SEO_COLORS.audit,
    title: 'Landing Page Audit',
    desc: 'Score every page, surface critical issues, and get AI optimization suggestions.',
    features: ['On-page scoring', 'Issue detection', 'AI recommendations', 'Meta checks'],
  },
  {
    id: 'keywords',
    icon: Layers,
    color: SEO_COLORS.keywords,
    title: 'Keyword Clustering',
    desc: 'Group keywords by search intent to plan content and landing pages.',
    features: ['Intent grouping', 'Content ideas', 'Commercial vs informational', 'Chip visualization'],
  },
  {
    id: 'competitors',
    icon: Binoculars,
    color: SEO_COLORS.competitors,
    title: 'Competitive Analysis',
    desc: 'Analyze competitor websites, ads, SEO strategy, and positioning.',
    features: ['Landing pages', 'Keywords', 'Ads', 'Opportunities'],
  },
  {
    id: 'rankings',
    icon: TrendingUp,
    color: SEO_COLORS.rankings,
    title: 'Rank Tracking',
    desc: 'Monitor keyword positions over time and spot ranking trends.',
    features: ['Position tracking', 'Trend indicators', 'Domain targeting', 'History'],
  },
]

export default function SeoOverview({ historyItems, onTabChange, onHistorySelect }) {
  return (
    <div className="seo-overview">
      <div className="card seo-workflow-card">
        <div className="card-title">SEO optimization workflow</div>
        <p className="text-muted text-sm" style={{ marginTop: 0 }}>
          Follow these steps to grow organic traffic — each leads naturally into the next.
        </p>
        <div className="seo-workflow-steps">
          {WORKFLOW_STEPS.map((step, i) => (
            <button
              key={step.step}
              type="button"
              className="seo-workflow-step"
              onClick={() => onTabChange?.(step.tab)}
            >
              <span className="seo-workflow-num" style={{ background: `${step.color}18`, color: step.color }}>
                {step.step}
              </span>
              <span className="seo-workflow-label">{step.label}</span>
              {i < WORKFLOW_STEPS.length - 1 && (
                <ChevronRight size={14} className="seo-workflow-arrow" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="seo-feature-grid">
        {FEATURE_CARDS.map((f) => {
          const Icon = f.icon
          return (
            <div key={f.id} className="seo-overview-card card" style={{ '--seo-accent': f.color }}>
              <div className="seo-overview-card-header">
                <div className="seo-feature-icon" style={{ background: `${f.color}18`, color: f.color }}>
                  <Icon size={18} strokeWidth={2} />
                </div>
                <h3 className="seo-overview-card-title">{f.title}</h3>
              </div>
              <p className="seo-overview-card-desc">{f.desc}</p>
              <ul className="seo-checklist compact">
                {f.features.map((feat) => (
                  <li key={feat}><Check size={12} /> {feat}</li>
                ))}
              </ul>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onTabChange?.(f.id)}>
                Start {f.title.split(' ')[0]}
              </button>
            </div>
          )
        })}
      </div>

      <SeoHistoryPanel
        items={historyItems}
        onSelect={onHistorySelect}
      />
    </div>
  )
}
