import { createServiceClient } from '@/lib/supabase/service'
import { DEFAULT_PROFILE_GENERATION_MODEL_ID, DEFAULT_TUTOR_MODEL_ID, LLM_MODEL_CATALOG } from '@/lib/llm/models'

export type LlmSettings = {
  tutorModelId: string
  profileGenerationModelId: string
  updatedAt: string | null
}

type LlmSettingsRow = {
  tutor_model_id: string
  profile_generation_model_id: string
  updated_at: string
}

const VALID_MODEL_IDS = new Set(LLM_MODEL_CATALOG.map(item => item.id))

function sanitizeModelId(rawValue: string | null | undefined, fallback: string) {
  const trimmed = rawValue?.trim()
  if (!trimmed) return fallback
  return VALID_MODEL_IDS.has(trimmed) ? trimmed : fallback
}

export function toPublicLlmSettings(row: LlmSettingsRow | null): LlmSettings {
  return {
    tutorModelId: sanitizeModelId(row?.tutor_model_id, DEFAULT_TUTOR_MODEL_ID),
    profileGenerationModelId: sanitizeModelId(
      row?.profile_generation_model_id,
      DEFAULT_PROFILE_GENERATION_MODEL_ID
    ),
    updatedAt: row?.updated_at ?? null,
  }
}

export async function getLlmSettingsWithServiceClient() {
  const service = createServiceClient()
  const { data, error } = await service
    .from('llm_settings')
    .select('tutor_model_id, profile_generation_model_id, updated_at')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return toPublicLlmSettings((data as LlmSettingsRow | null) ?? null)
}
