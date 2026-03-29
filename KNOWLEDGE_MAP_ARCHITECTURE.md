# Knowledge Map: Conceptual and Architectural Design

## 1. Purpose

The knowledge map is the shared learning-memory layer for Drona. Its job is to turn two kinds of educational evidence into one navigable structure:

1. **Student learning signals** from tutoring sessions.
2. **School syllabus signals** from WTR / curriculum documents.

Instead of treating each tutoring conversation as isolated, the system stores:

- what concepts exist,
- how they relate to each other,
- what the student still does not understand,
- what the school is planning to teach next,
- and where cross-subject bridges already exist.

This enables four capabilities:

1. Remember concept relationships across sessions.
2. Personalize future tutoring using prior gaps and prior concept bridges.
3. Align tutoring with school curriculum progression.
4. Give an admin-visible map of the current concept network.

The knowledge map is not just a visualization. It is a durable semantic memory system that supports tutoring quality, curriculum alignment, and future reasoning over student progress.

---

## 2. Design Philosophy

The system is a lightweight semantic graph rather than a strict ontology or full graph database.

### 2.1 Human-meaningful nodes

Nodes are named educational ideas: `Quadratic equations`, `Projectile motion`, `Change`. The system prefers canonical, human-readable labels over normalized IDs. This makes the graph inspectable, promptable, and manually curable.

### 2.2 Directed learning relationships

Edges are directional. An edge expresses that one concept leads to, supports, extends, applies to, or connects into another. Direction matters for prerequisite reasoning, "what comes next" guidance, and visual layout.

### 2.3 One shared concept layer, multiple evidence layers

Concepts are global. Connections carry a source discriminator (`child_key`) that separates student evidence from curriculum evidence. The design intent: concepts represent shared educational ideas; connections represent context-specific evidence that those ideas are linked.

### 2.4 LLM-assisted extraction, relational persistence

Claude performs semantic interpretation and extraction. Supabase/Postgres handles persistence, filtering, retrieval, and access control. The UI handles exploration and visualization.

### 2.5 Practical over perfect normalization

The model favors speed and inspectability over graph-theoretic purity. Edges store concept names + subjects instead of foreign keys. Missing concept rows can be synthesized for display. Connection deduplication is not enforced.

This keeps the system flexible but introduces real trade-offs covered in depth in section 12.

---

## 3. Conceptual Model

### 3.1 Concept

A concept is a named unit of understanding. It is the node in the graph.

**Table:** `concepts`

| Field | Purpose |
|-------|---------|
| `name` | Canonical concept label |
| `subject` | Domain: `Mathematics`, `Science`, `History`, etc. |
| `type` | One of `topic_concept`, `ib_key_concept`, `cross_subject` |
| `grade` | Optional curriculum grouping |

Three concept types:

- **`topic_concept`** — standard syllabus or session-level ideas.
- **`ib_key_concept`** — one of the 16 seeded IB MYP key concepts (`Change`, `Systems`, `Relationships`, etc.).
- **`cross_subject`** — concepts that intentionally bridge subject boundaries.

**Identity rule:** A concept is identified by `(name, subject)`. Same name in different subjects = distinct concepts. Same name + same subject = same canonical node.

### 3.2 Connection

A connection is a directed relationship between two concepts.

**Table:** `concept_connections`

| Field | Purpose |
|-------|---------|
| `concept_a`, `subject_a` | Source endpoint (name + subject) |
| `concept_b`, `subject_b` | Target endpoint (name + subject) |
| `relationship` | Free-text semantic label |
| `child_key` | Provenance: `girl`, `boy`, or `curriculum` |
| `episode_id` | Session this came from (student edges) |
| `wtr_upload_id` | WTR upload this came from (curriculum edges) |

Connections are evidence-bearing assertions, not canonical axioms. The same conceptual relationship can appear multiple times with different provenance or phrasing.

**Direction rule:** `concept_a` is always the source, `concept_b` the target. The system uses this for prerequisite reasoning, curriculum sequencing, and layout.

**Provenance rule:** `child_key` encodes both audience scoping and source semantics. Real child values mean student evidence; `curriculum` means syllabus evidence.

### 3.3 Learning Gap

A learning gap is a stateful record of incomplete understanding for a specific student. It is not a graph edge.

**Table:** `learning_gaps`

| Field | Purpose |
|-------|---------|
| `child_key` | Which student |
| `concept` | Concept name string |
| `subject` | Subject domain |
| `note` | What specifically was not understood |
| `status` | `open` or `resolved` |
| `resolved_at` | When mastery was achieved |

This creates a second memory structure alongside the graph:

- **Graph memory** = conceptual structure.
- **Gap memory** = mastery state.

**Lifecycle:** `open` -> `resolved` (when a later session indicates understanding).

### 3.4 WTR Upload

An administrative ingestion event for syllabus documents.

**Table:** `wtr_uploads`

| Field | Purpose |
|-------|---------|
| `filename`, `mime_type`, `file_size_bytes` | File metadata |
| `period_type`, `grade`, `label`, `school_year` | Curriculum labeling |
| `status` | `pending` -> `processing` -> `completed` or `failed` |
| `extraction_summary` | JSON summary of what was extracted |
| `error_message` | Failure details |

This is the ingestion ledger that connects a curriculum extraction event to the edges it produced.

---

## 4. Layered Graph Architecture

The graph is three stacked layers sharing one concept namespace.

### 4.1 Canonical concept layer

The persistent set of known concepts in `concepts`. Acts as the vocabulary layer. Both tutoring sessions and WTR imports try to reuse existing concepts so the graph converges instead of fragmenting.

### 4.2 Student evidence layer

`concept_connections` rows where `child_key` is a real child identifier (`girl`, `boy`). These edges represent relationships that emerged from tutoring sessions, linked to `episode_id`. This layer is personalized.

### 4.3 Curriculum evidence layer

`concept_connections` rows where `child_key = 'curriculum'`. These edges represent syllabus structure extracted from WTR uploads, linked to `wtr_upload_id`. This layer is non-personal.

### 4.4 Why both layers matter

This lets Drona answer a useful tutoring question: "What should be taught now for this student, given both what the school is covering and what the child currently understands or misunderstands?"

Without the curriculum layer, tutoring memory drifts from school sequencing. Without the student layer, tutoring stays generic.

---

## 5. Database Design

### 5.1 Indexing strategy

| Index | Supports |
|-------|----------|
| `concept_connections(child_key)` | Fetch child- or curriculum-scoped edges |
| `concept_connections(concept_a)` | Look up edges by source endpoint |
| `concept_connections(concept_b)` | Look up edges by target endpoint |
| `concept_connections(wtr_upload_id)` | Find edges from a specific WTR upload |
| `learning_gaps(child_key, status)` | Fetch unresolved gaps efficiently |
| `wtr_uploads(created_at desc)` | Browse recent uploads |

### 5.2 Access control

RLS is enabled on all four tables.

**Read policies:**
- Authenticated users can read `concepts`.
- Children can read their own `concept_connections` and `learning_gaps`.
- Parents can read all student rows.
- Authenticated users can read curriculum connections.
- No anonymous access.

**Write policies:**
- Authenticated users can insert connections and gaps.
- Authenticated users can update gap status.
- `wtr_uploads` is service-role/admin only.

**Admin secret:** The admin routes optionally enforce `WTR_ADMIN_SECRET` via `x-admin-secret` header.

---

## 6. End-to-End Data Flows

### 6.1 Flow A: tutoring session -> student knowledge map

**Implementation:** `lib/graph/extract.ts`

| Step | What happens |
|------|-------------|
| 1 | Session transcript is assembled as `Student: ... / Tutor: ...` alternating text |
| 2 | Claude is prompted to extract `concepts`, `connections`, `gaps`, `gaps_resolved` as JSON |
| 3 | Concepts are upserted into `concepts` using `onConflict: 'name,subject'` with `ignoreDuplicates: true` |
| 4 | Connections are inserted with `child_key = childKey` and `episode_id` |
| 5 | New gaps are inserted with `status = 'open'` |
| 6 | Resolved gaps are matched by concept name string and updated to `status = 'resolved'` |

### 6.2 Flow B: WTR upload -> curriculum knowledge map

**Implementation:** `app/api/admin/wtr/process/route.ts`, `lib/graph/wtr.ts`

| Step | What happens |
|------|-------------|
| 1 | Admin uploads syllabus file (PNG, JPEG, WebP, GIF, or PDF; max 12 MB) |
| 2 | `wtr_uploads` row is created with `status = 'processing'` |
| 3 | Existing concepts are fetched from Supabase and passed into the extraction prompt |
| 4 | Claude extracts `concepts` and `connections` (no gaps from curriculum docs) |
| 5 | Concepts are upserted using `onConflict: 'name,subject'` (without `ignoreDuplicates`) |
| 6 | Connections are inserted with `child_key = 'curriculum'` and `wtr_upload_id` |
| 7 | Upload row is updated to `completed` or `failed` |

### 6.2.1 Batch curriculum import and reset

**Implementation:** `scripts/import-curriculum.mjs`, `supabase/reset_knowledge_map.sql`

To support full re-ingestion after prompt/modeling changes:

1. `reset_knowledge_map.sql` clears graph tables in FK-safe order and reseeds IB key concepts.
2. `import-curriculum.mjs` processes all WTR files (PDF + XLSX), chronologically.
3. XLSX files are transformed into markdown text blocks for extraction.
4. Upsert logic reuses canonical concepts and inserts curriculum edges with `wtr_upload_id`.

This enables reproducible full refreshes of curriculum graph quality after extraction-rule updates.

### 6.4 Flow D: WTR schedule extraction -> temporal map

**Implementation:** `supabase/migrations/005_curriculum_schedule.sql`, `scripts/extract-schedule.mjs`

| Step | What happens |
|------|-------------|
| 1 | `curriculum_schedule` stores concept-week records (`current` or `coming`) with date ranges |
| 2 | Script parses WTR date ranges from filenames and normalizes to `YYYY-MM-DD` |
| 3 | XLSX schedule text is parsed directly; PDF schedule is inferred from extracted curriculum edges |
| 4 | Raw topic lines are matched to canonical concepts via exact/substring/word-overlap matching |
| 5 | Rows are upserted on `(concept_name, subject, week_start, schedule_type)` |
| 6 | Graph API can filter and sort by week timeline |

### 6.3 Flow C: graph retrieval -> tutoring context

**Implementation:** `lib/graph/context.ts`

When preparing context for a tutoring session, the system retrieves:

1. Related concepts in the subject (up to 10).
2. Prior connections from both student and curriculum layers for the subject (up to 12).
3. Open gaps for the student in the subject (up to 5).
4. Recently resolved gaps for reinforcement (up to 3).

`formatContextForPrompt()` converts this into a text block injected into the tutor system prompt, distinguishing gaps to address, recently mastered concepts, and syllabus/student connections.

---

## 7. Visualization Architecture

**Implementation:** `app/admin/graph/page.tsx`, `app/api/admin/graph/route.ts`

### 7.1 Graph API

`/api/admin/graph` reads concepts, connections, and schedule metadata from Supabase and applies filters:

- `subject`
- `grade`
- `search`
- `source` (`all`, `curriculum`, `student`)
- `week_start` / `week_end`

When week filters are provided, both concepts and edges are constrained to the selected temporal slice. Schedule metadata (`week_start`, `week_end`, `schedule_type`) is attached to returned concepts.

It also synthesizes concept objects for edge endpoints missing from the `concepts` table.

### 7.2 Graph interaction mode

The explorer now uses a high-density force-directed layout optimized for large concept sets. It supports:

- pan + zoom
- drag-to-reposition nodes
- fit/reset viewport
- branch highlighting from selected/focused node
- optional always-on edge labels

### 7.3 Relationship management

Admins can edit and delete edges directly from the graph UI.

**Implementation:** `app/api/admin/graph/connections/route.ts`

- `PATCH` updates edge `relationship`
- `DELETE` removes one or multiple edges (`id` or `ids`)

### 7.4 Concept browser

Right-side panel supports:

- quick concept search
- sort by degree or schedule date
- per-node schedule hints
- direct jump-to-node for relationship traversal

---

## 8. Prompt Design

### 8.1 Session extraction prompt

Prompts are now externalized to markdown files and loaded through `lib/graph/prompts.ts`.

- `prompts/session-extraction.md`
- `prompts/wtr-extraction.md`
- `prompts/shared-rules.md`

Session extraction combines:

1. session-specific instructions
2. shared canonical rules/taxonomy
3. existing concepts block (for reuse)
4. open gap block (for exact-name resolution)

### 8.2 WTR extraction prompt

WTR extraction uses the same shared rule layer + WTR-specific instructions and includes existing concepts for canonicalization.

The shared rules now explicitly define:

- canonical subject names
- controlled relationship taxonomy
- concept naming granularity
- edge direction semantics
- IB key concept linking constraints

---

## 9. Critical Design Issues

These are genuine problems in the current implementation, ordered by severity.

### 9.1 ~~Session extraction does not receive existing concepts~~ FIXED

`extractAndSaveGraph` now fetches existing concepts via `fetchExistingConceptsForPrompt()` and injects them into the extraction prompt, matching the WTR flow.

### 9.2 ~~Gap resolution is blind~~ FIXED

`extractAndSaveGraph` now queries open gaps for the child and includes them in the extraction prompt. The prompt instructs Claude to use the exact concept name from the open gaps list when reporting `gaps_resolved`.

### 9.3 ~~Grade is hardcoded in session extraction~~ FIXED

`extractAndSaveGraph` now accepts an optional `grade` parameter. The hardcoded `'6th Grade'` has been removed.

### 9.4 ~~`topic` parameter is accepted but never used in context retrieval~~ FIXED

`getTopicContext` now uses `topic` to fetch topic-matching concepts first (via `ilike`), then fills with broader subject concepts. Connections are also prioritized by topic relevance.

### 9.5 ~~`related_concepts` retrieval has no relevance ordering~~ FIXED

Topic-matching concepts are now fetched first and placed at the front of the list. Cross-subject concepts are also included. The result is capped at 15 instead of 10.

### 9.6 ~~Cross-subject context retrieval is asymmetric~~ PARTIALLY FIXED

`getTopicContext` now fetches up to 5 `cross_subject` type concepts regardless of subject filter. Topic-matching connections are also fetched across subjects. Transitive relevance (edges between two unrelated subjects) still does not surface.

### 9.7 ~~`ignoreDuplicates` asymmetry between flows~~ FIXED

Both session and WTR flows now use `ignoreDuplicates: true`. The rule is: first writer wins for concept metadata. Neither flow overwrites existing concept types or grades.

### 9.8 No transaction safety in extraction saves — PARTIALLY FIXED

**Severity: Medium.**

Both extraction flows still perform multiple sequential database operations without a transaction boundary. However, error propagation has been improved:

- `saveWtrGraphToDatabase` now returns an `errors[]` array.
- The WTR process route now marks uploads as `failed` when sub-operations fail, instead of silently marking them `completed`.
- `extractAndSaveGraph` now collects and logs all sub-operation errors.

Full transaction safety requires a Postgres RPC function, which remains a future improvement.

### 9.9 ~~IB key concepts are orphaned~~ FIXED

Both the session extraction and WTR extraction prompts now include an explicit instruction to create connections to IB key concepts when relevant. The full list of 16 IB MYP key concepts is embedded in both prompts.

### 9.10 ~~NULL subject uniqueness does not hold in Postgres~~ FIXED

Migration `004_fix_null_subject_uniqueness.sql` replaces the original `unique(name, subject)` constraint with a `COALESCE`-based unique index that properly handles NULL subjects. It also deduplicates any existing rows.

### 9.11 ~~Relationship text is uncontrolled free text~~ FIXED (prompt-level)

`prompts/shared-rules.md` now constrains extraction to a fixed relationship taxonomy and explicit edge-direction semantics. This materially reduces label drift across extractions.

Note: hard DB-level enum enforcement is still open; current control is prompt-governed.

### 9.12 No graph pruning or versioning

**Severity: Low (now), will increase.**

Concepts and connections can never be deleted, superseded, or marked stale through the normal flow. There is no way to indicate that a newer WTR upload supersedes an older one's edges. Over time, the graph only grows. Edge duplication (9.13 below) compounds this.

### 9.13 No edge deduplication

**Severity: Low (now), will increase.**

Repeated extractions can insert semantically duplicate edges. Over time this inflates degree counts and clutters the graph. The overview and focus layouts will become noisy.

### 9.14 RLS write policies are too permissive

**Severity: Low (in current scope).**

The `INSERT` and `UPDATE` policies only check `auth.role() = 'authenticated'`. Any authenticated user can insert connections for any `child_key` or update any gap's status. There is no check that the user is the child or parent referenced.

This is fine while the app only runs as a controlled family tool, but would be a real security issue in a multi-family deployment.

### 9.15 ~~Week filter leaked full graph through connection expansion~~ FIXED

In `/api/admin/graph`, week filtering now constrains both concept visibility and connection inclusion. Previously, connection expansion could re-introduce off-week concepts and make the week filter look ineffective.

---

## 10. Current Strengths

### 10.1 Unified concept space
Both student understanding and school plans land in one graph, making retrieval powerful.

### 10.2 Easy LLM interoperability
The data model is simple enough to be extracted by an LLM, re-injected into prompts, and visualized without heavy graph tooling.

### 10.3 Strong inspectability
Tables are readable, routes are straightforward, the graph UI is explicit, and raw relationship text is preserved.

### 10.4 Curriculum alignment built in
The system tracks what the school intends alongside what the student discussed.

### 10.5 Supports interdisciplinary tutoring
Cross-subject edges are first-class, supporting explanations that bridge domains.

---

## 11. Prioritized Improvement Roadmap

### Phase 1: Fix blind spots — DONE

All four items have been implemented:

| Item | Status | Implementation |
|------|--------|---------------|
| Pass existing concepts to session extraction | Done | `extract.ts` now calls `fetchExistingConceptsForPrompt()` and injects results into prompt |
| Pass open gaps to session extraction | Done | `extract.ts` now queries open gaps for the child and includes them in prompt; prompt instructs Claude to use exact gap names |
| Parameterize grade | Done | `extractAndSaveGraph` now accepts optional `grade` parameter; hardcoded `'6th Grade'` removed |
| Use `topic` in context retrieval | Done | `getTopicContext` now fetches topic-matching concepts first, then subject concepts, plus cross-subject concepts; connections are prioritized by topic relevance |

### Phase 2: Strengthen data integrity — DONE

| Item | Status | Implementation |
|------|--------|---------------|
| Fix NULL uniqueness | Done | Migration `004_fix_null_subject_uniqueness.sql` replaces `unique(name, subject)` with `COALESCE`-based unique index |
| Decide upsert authority | Done | Both session and WTR flows now use `ignoreDuplicates: true` — first writer wins; neither flow overwrites existing concept metadata |
| Check sub-operation errors in WTR | Done | `saveWtrGraphToDatabase` now returns `errors[]`; WTR process route marks upload as `failed` when sub-operations fail |
| Add transaction boundaries | Open | Supabase JS client does not support multi-statement transactions natively; requires Postgres RPC function |

### Phase 2.5: IB key concepts activation — DONE

| Item | Status | Implementation |
|------|--------|---------------|
| Connect IB key concepts in session extraction | Done | Session extraction prompt now instructs Claude to create connections to IB key concepts |
| Connect IB key concepts in WTR extraction | Done | WTR extraction prompt now includes the same IB key concept instruction |

### Phase 3: Improve graph quality

| Item | What to do | Why |
|------|-----------|-----|
| Enforce relationship taxonomy at DB layer | Add enum/check constraint for `relationship` values | Prevents taxonomy drift outside LLM path |
| Normalize relationship types | Define controlled vocabulary, map free text in post-processing | Enables structured graph queries |
| Add edge deduplication | Unique constraint on normalized edge signature, or observation counts | Prevents graph noise |
| Add concept foreign keys to edges | `concept_a_id`, `concept_b_id` with optional name snapshots | Enables renames, integrity, better queries |

### Phase 4: Richer modeling

| Item | What to do | Why |
|------|-----------|-----|
| Model curriculum time | Extend schedule to multi-grade/multi-section and per-term views | Enables broader syllabus-aware tutoring |
| Enrich mastery modeling | Confidence scores, date last reinforced, misconception categories | Supports spaced repetition |
| Add canonicalization pipeline | Post-extraction fuzzy matching and synonym merging | Reduces long-term graph fragmentation |
| Add confidence metadata | Extraction confidence, model version, human-reviewed flag | Supports quality filtering |

---

## 12. Recommended Mental Model

The simplest accurate model:

> Drona has a shared educational concept graph with two evidence overlays: what the school is teaching and what the student has experienced in tutoring. On top of that, it keeps a separate mastery ledger of unresolved and resolved misunderstandings.

Or more compactly:

- `concepts` = vocabulary
- `concept_connections` = evidence-backed links
- `learning_gaps` = mastery state
- `wtr_uploads` = curriculum ingestion history

---

## 13. File Map

| File | Role |
|------|------|
| `supabase/migrations/002_knowledge_graph.sql` | Core schema: concepts, connections, gaps |
| `supabase/migrations/003_wtr_curriculum.sql` | WTR uploads, curriculum child_key, schema evolution |
| `supabase/migrations/004_fix_null_subject_uniqueness.sql` | NULL-safe uniqueness handling for concepts |
| `supabase/migrations/005_curriculum_schedule.sql` | Curriculum time model: concept-week schedule table |
| `supabase/reset_knowledge_map.sql` | Full knowledge-map reset + IB key concept reseed |
| `lib/graph/types.ts` | TypeScript types for all graph entities |
| `lib/graph/extract.ts` | Session transcript -> Claude extraction -> Supabase save |
| `lib/graph/wtr.ts` | WTR document -> Claude extraction -> Supabase save |
| `lib/graph/prompts.ts` | Prompt loader/cache + prompt block formatters |
| `lib/graph/context.ts` | Graph retrieval -> prompt context formatting |
| `lib/graph/test-graph.ts` | Manual test script for extraction and context |
| `prompts/shared-rules.md` | Canonical subjects, taxonomy, direction semantics, IB linking rules |
| `prompts/session-extraction.md` | Session extraction instructions |
| `prompts/wtr-extraction.md` | WTR extraction instructions |
| `app/api/admin/graph/route.ts` | Graph API: filtered concept + connection retrieval |
| `app/api/admin/graph/connections/route.ts` | Admin edge edit/delete API |
| `app/api/admin/wtr/route.ts` | WTR upload list API |
| `app/api/admin/wtr/process/route.ts` | WTR upload processing API |
| `app/admin/graph/page.tsx` | Graph explorer UI: overview + focus mode + browser |
| `app/admin/wtr/page.tsx` | WTR upload admin UI |
| `scripts/import-curriculum.mjs` | Batch curriculum ingestion from all WTR files |
| `scripts/extract-schedule.mjs` | Extract week-level schedule and populate `curriculum_schedule` |

---

## 14. Summary

The knowledge map architecture is now a hybrid educational memory system with five integrated layers:

- shared concept vocabulary (`concepts`)
- evidence-backed relationships (`concept_connections`)
- student mastery state (`learning_gaps`)
- ingestion provenance (`wtr_uploads`)
- curriculum timeline (`curriculum_schedule`)

The key implementation evolution after the original design document is the shift from a static graph to a time-aware, admin-curatable graph:

- prompts are externalized and centrally governed
- full reset/reimport workflows are automated
- graph edges are editable/deletable from admin UI
- schedule dates are extracted and attached to concepts
- graph retrieval supports week-level filtering and timeline-driven sorting

This keeps the architecture lightweight (Postgres + LLM extraction) while significantly improving data quality controls, temporal alignment, and operational maintainability.

---

## 15. Post-Document Implementation Updates (Consolidated)

The following were implemented after the initial version of this architecture document:

1. **Prompt modularization**
   - Moved extraction instructions into versionable markdown files under `prompts/`.
   - Added `lib/graph/prompts.ts` cache/loader and shared block formatters.

2. **Canonical extraction quality improvements**
   - Session + WTR prompts now share taxonomy and direction rules.
   - Existing concepts and open gaps are injected into session extraction.

3. **Graph operations in admin**
   - Added edge relationship edit and edge delete APIs.
   - Added UI controls for relationship CRUD and edge label visibility.

4. **Curriculum timeline model**
   - Added `curriculum_schedule` table and indexes.
   - Built `scripts/extract-schedule.mjs` to parse WTR week windows and map topics to canonical concepts.
   - Imported schedule rows for all available WTR files.

5. **Temporal graph navigation**
   - Added week filter + date-aware sorting in graph explorer.
   - Updated graph API to return schedule metadata and week options.
   - Fixed week-filter leakage so off-week concepts are no longer reintroduced via connection expansion.

6. **Operational scripts**
   - Added full reset script (`reset_knowledge_map.sql`) and batch import script (`scripts/import-curriculum.mjs`) for clean reprocessing cycles.
