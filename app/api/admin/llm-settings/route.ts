import { NextResponse } from 'next/server'
import { AuthzError, requireAdmin } from '@/lib/auth/admin'
import {
  DEFAULT_PROFILE_GENERATION_MODEL_ID,
  DEFAULT_TUTOR_MODEL_ID,
  LLM_MODEL_CATALOG,
  estimateModelCostUsd,
} from '@/lib/llm/models'
import { toPublicLlmSettings } from '@/lib/llm/settings'

const VALID_MODEL_IDS = new Set(LLM_MODEL_CATALOG.map(item => item.id))

function isValidModelId(value: string) {
  return VALID_MODEL_IDS.has(value)
}

export async function GET() {
  try {
    const { service } = await requireAdmin()
    const { data, error } = await service
      .from('llm_settings')
      .select('tutor_model_id, profile_generation_model_id, updated_at')
      .eq('id', true)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const settings = toPublicLlmSettings(
      (data as
        | { tutor_model_id: string; profile_generation_model_id: string; updated_at: string }
        | null) ?? null
    )

    const modelCatalog = LLM_MODEL_CATALOG.map(model => ({
      ...model,
      estimatedCostUsdExamples: {
        light: estimateModelCostUsd({ modelId: model.id, inputTokens: 1000, outputTokens: 500 }),
        standard: estimateModelCostUsd({ modelId: model.id, inputTokens: 4000, outputTokens: 1200 }),
        heavy: estimateModelCostUsd({ modelId: model.id, inputTokens: 12000, outputTokens: 3000 }),
      },
    }))

    return NextResponse.json({
      settings,
      defaults: {
        tutorModelId: DEFAULT_TUTOR_MODEL_ID,
        profileGenerationModelId: DEFAULT_PROFILE_GENERATION_MODEL_ID,
      },
      modelCatalog,
      pricingDisclaimer:
        'Pricing is estimated from model list rates in USD per 1M tokens. Final billing depends on actual provider usage.',
    })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load LLM settings' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, service } = await requireAdmin()
    const body = (await request.json()) as {
      tutorModelId?: string
      profileGenerationModelId?: string
    }

    const tutorModelId = body.tutorModelId?.trim() ?? ''
    const profileGenerationModelId = body.profileGenerationModelId?.trim() ?? ''

    if (!isValidModelId(tutorModelId)) {
      return NextResponse.json({ error: 'Invalid tutor model selection.' }, { status: 400 })
    }
    if (!isValidModelId(profileGenerationModelId)) {
      return NextResponse.json({ error: 'Invalid profile generation model selection.' }, { status: 400 })
    }

    const { error } = await service.from('llm_settings').upsert({
      id: true,
      tutor_model_id: tutorModelId,
      profile_generation_model_id: profileGenerationModelId,
      updated_by: user.id,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update LLM settings' },
      { status: 500 }
    )
  }
}
