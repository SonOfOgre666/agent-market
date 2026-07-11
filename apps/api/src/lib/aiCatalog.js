/**
 * AI catalog — loaded from MongoDB (`ai_catalog` collection).
 * Seed data lives in aiCatalogSeed.js; runtime always reads DB via AiCatalog model.
 */

export {
  getCatalog,
  catalogViews,
  validateFeatureAssignment,
  validatePlannerAssignment,
  getDefaultFeatureConfig,
  getDefaultPlannerConfig,
  resolveApiModelId,
  seedCatalogIfMissing,
} from '../models/AiCatalog.js'
