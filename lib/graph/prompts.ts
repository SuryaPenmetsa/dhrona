import fs from 'fs'
import path from 'path'

const PROMPTS_DIR = path.join(process.cwd(), 'prompts')

function readPromptFile(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8')
}

let _sharedRulesCache: string | null = null
let _sessionPromptCache: string | null = null
let _wtrPromptCache: string | null = null

export function getSharedRules(): string {
  if (!_sharedRulesCache) {
    _sharedRulesCache = readPromptFile('shared-rules.md')
  }
  return _sharedRulesCache
}

export function getSessionExtractionPrompt(): string {
  if (!_sessionPromptCache) {
    _sessionPromptCache = readPromptFile('session-extraction.md')
  }
  return _sessionPromptCache
}

export function getWtrExtractionPrompt(): string {
  if (!_wtrPromptCache) {
    _wtrPromptCache = readPromptFile('wtr-extraction.md')
  }
  return _wtrPromptCache
}

export function clearPromptCache(): void {
  _sharedRulesCache = null
  _sessionPromptCache = null
  _wtrPromptCache = null
}

export function formatExistingConceptsBlock(
  concepts: Array<{ name: string; subject: string | null; type: string }>
): string {
  if (concepts.length === 0) return 'No existing concepts yet.'
  return JSON.stringify(concepts, null, 0)
}

export function formatOpenGapsBlock(
  gaps: Array<{ concept: string; subject: string | null; note: string | null }>
): string {
  if (gaps.length === 0) return 'No open gaps.'
  return JSON.stringify(gaps, null, 0)
}
