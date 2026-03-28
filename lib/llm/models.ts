export type LlmModelCatalogItem = {
  id: string
  label: string
  provider: 'anthropic'
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  contextWindowTokens: number
  recommendedFor: string
}

export const LLM_MODEL_CATALOG: LlmModelCatalogItem[] = [
  {
    id: 'claude-3-5-haiku-20241022',
    label: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
    contextWindowTokens: 200_000,
    recommendedFor: 'Lowest cost and fastest responses',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    label: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    contextWindowTokens: 200_000,
    recommendedFor: 'Balanced quality and cost',
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    provider: 'anthropic',
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    contextWindowTokens: 200_000,
    recommendedFor: 'Default: strong reasoning at moderate cost',
  },
  {
    id: 'claude-opus-4-20250514',
    label: 'Claude Opus 4',
    provider: 'anthropic',
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    contextWindowTokens: 200_000,
    recommendedFor: 'Highest quality for hardest tutoring tasks',
  },
]

export const DEFAULT_TUTOR_MODEL_ID = 'claude-sonnet-4-20250514'
export const DEFAULT_PROFILE_GENERATION_MODEL_ID = 'claude-sonnet-4-20250514'

export function getLlmModelCatalogItem(modelId: string) {
  return LLM_MODEL_CATALOG.find(item => item.id === modelId) ?? null
}

export function estimateModelCostUsd({
  modelId,
  inputTokens,
  outputTokens,
}: {
  modelId: string
  inputTokens: number
  outputTokens: number
}) {
  const model = getLlmModelCatalogItem(modelId)
  if (!model) return null
  const inputCost = (inputTokens / 1_000_000) * model.inputUsdPerMillion
  const outputCost = (outputTokens / 1_000_000) * model.outputUsdPerMillion
  return inputCost + outputCost
}
