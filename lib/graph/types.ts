export type ChildKey = 'girl' | 'boy'

/** Session graphs use ChildKey; syllabus uploads use `curriculum`. */
export type ConnectionChildKey = ChildKey | 'curriculum'

export type ConceptType = 'topic_concept' | 'ib_key_concept' | 'cross_subject'

export interface Concept {
  id: string
  name: string
  subject: string | null
  type: ConceptType
  grade: string | null
  created_at: string
}

export interface ConceptConnection {
  id: string
  child_key: ConnectionChildKey
  concept_a: string
  concept_b: string
  subject_a: string | null
  subject_b: string | null
  relationship: string
  episode_id: string | null
  created_at: string
}

export interface LearningGap {
  id: string
  child_key: ChildKey
  concept: string
  subject: string | null
  note: string | null
  status: 'open' | 'resolved'
  episode_id: string | null
  created_at: string
  resolved_at: string | null
}

// What Claude returns when extracting graph from a session
export interface GraphExtraction {
  concepts: Array<{
    name: string
    subject: string
    type: ConceptType
  }>
  connections: Array<{
    concept_a: string
    concept_b: string
    subject_a: string
    subject_b: string
    relationship: string
  }>
  gaps: Array<{
    concept: string
    subject: string
    note: string
  }>
  gaps_resolved: Array<{
    concept: string // concept name matching an existing open gap
  }>
}

// What gets injected into the tutor system prompt
export interface TopicGraphContext {
  related_concepts: Concept[]
  prior_connections: ConceptConnection[]
  open_gaps: LearningGap[]
  resolved_gaps: LearningGap[]
}

export type WtrPeriodType = 'weekly' | 'monthly' | 'term' | 'yearly' | 'other'

/** Claude output for a syllabus / WTR document (no session gaps) */
export interface WtrGraphExtraction {
  concepts: Array<{
    name: string
    subject: string
    type: ConceptType
  }>
  connections: Array<{
    concept_a: string
    concept_b: string
    subject_a: string
    subject_b: string
    relationship: string
  }>
}
