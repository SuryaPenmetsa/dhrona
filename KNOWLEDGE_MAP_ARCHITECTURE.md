# Knowledge Map: Conceptual and Architectural Design

## 1. Purpose

The knowledge map is the shared learning-memory layer for Drona. Its job is to turn two different kinds of educational evidence into one navigable structure:

1. Student learning signals from tutoring sessions.
2. School syllabus signals from WTR / curriculum documents.

Instead of treating each tutoring conversation as isolated, the system stores:

- what concepts exist,
- how they relate to each other,
- what the student still does not understand,
- what the school is planning to teach next,
- and where cross-subject bridges already exist.

This enables Drona to do four important things:

1. Remember concept relationships across sessions.
2. Personalize future tutoring using prior gaps and prior concept bridges.
3. Align tutoring with school curriculum progression.
4. Give an admin-visible map of the current concept network.

At a product level, the knowledge map is not just a visualization. It is a durable semantic memory system that supports tutoring quality, curriculum alignment, and future reasoning over student progress.

## 2. Design Philosophy

The system is intentionally designed as a lightweight semantic graph rather than a mathematically strict ontology or a full graph database. Several principles are visible in the implementation:

### 2.1 Human-meaningful nodes

Nodes are named educational ideas such as `Quadratic equations`, `Projectile motion`, or `Change`.

The system prefers canonical, human-readable labels over deeply normalized IDs in runtime APIs. This makes the graph easier to inspect, easier to prompt into an LLM, and easier to manually curate.

### 2.2 Directed learning relationships

Edges are directional. An edge expresses that one concept leads to, supports, extends, applies to, or connects into another concept.

Examples:

- `Linear equations` -> `Quadratic equations`
- `Data handling` -> `Experimental analysis`
- `Quadratic equations` -> `Projectile motion`

Direction matters because the map is used for:

- prerequisite reasoning,
- "what comes next" tutoring guidance,
- focused map views that distinguish backward vs forward links,
- curriculum sequencing from current week to coming week.

### 2.3 One shared concept layer, multiple evidence layers

The graph merges multiple evidence sources into one concept space:

- a student/session layer,
- a curriculum/WTR layer.

This is why `concepts` are global, while `concept_connections` carry a source discriminator via `child_key`.

The key design idea is:

- concepts represent shared educational ideas,
- connections represent context-specific evidence that those ideas are linked.

### 2.4 LLM-assisted extraction, relational persistence

Claude is used to read transcripts and WTR files and extract structured graph data. Supabase/Postgres then stores the durable result.

This splits responsibilities cleanly:

- LLM: semantic interpretation and extraction,
- database: persistence, filtering, retrieval, and access control,
- UI: exploration and visualization.

### 2.5 Practical over perfect normalization

The current model favors implementation speed and inspectability over strict graph-theoretic purity:

- edges store concept names + subjects instead of concept foreign keys,
- missing concept rows can be synthesized in the admin API for display,
- connection deduplication is not yet enforced at the database layer.

This keeps the system flexible but introduces design trade-offs discussed later in this document.

## 3. Conceptual Model

The knowledge map has four primary conceptual entities.

### 3.1 Concept

A concept is a named unit of understanding. It is the node in the graph.

Implemented in `concepts`.

Key fields:

- `name`: canonical concept label.
- `subject`: domain ownership such as `Mathematics`, `Science`, `History`.
- `type`: semantic class of concept.
- `grade`: optional curriculum grouping.

Three concept types are supported:

1. `topic_concept`
   Standard syllabus or session-level ideas.
2. `ib_key_concept`
   One of the seeded IB MYP key concepts such as `Change`, `Systems`, `Relationships`.
3. `cross_subject`
   Concepts that intentionally bridge subject boundaries.

This gives the graph a mixed ontology:

- ordinary topical knowledge,
- institutional IB framing concepts,
- explicit interdisciplinary bridges.

### 3.2 Connection

A connection is a directed relationship between two concepts.

Implemented in `concept_connections`.

Each edge stores:

- source concept name and subject,
- target concept name and subject,
- relationship text,
- source provenance (`child_key`),
- optional `episode_id`,
- optional `wtr_upload_id`.

The system treats connections as evidence-bearing assertions rather than immutable truths. That matters because the same concepts can have:

- student-discovered bridges,
- curriculum-defined sequencing,
- multiple differently phrased relationships.

Examples of relationship text:

- `prerequisite for`
- `same mathematical shape`
- `real-world example of`
- `builds on`
- `next in school syllabus`

### 3.3 Learning Gap

A learning gap is not a graph edge. It is a stateful record of incomplete understanding for a specific student.

Implemented in `learning_gaps`.

It stores:

- which student,
- which concept,
- which subject,
- what exactly was not understood,
- whether the gap is still open or resolved.

This creates a second memory structure layered alongside the graph:

- graph memory = conceptual structure,
- gap memory = mastery state.

That combination is what lets the tutoring system both know the map and know where the learner is struggling inside the map.

### 3.4 WTR Upload

A WTR upload is an administrative ingestion event for syllabus documents.

Implemented in `wtr_uploads`.

It stores:

- file metadata,
- grade / period labeling,
- processing state,
- error state,
- extraction summary.

This is not part of the graph itself, but it is the ingestion ledger that connects a curriculum extraction event to the curriculum edges it produced.

## 4. Layered Graph Architecture

The graph is best understood as three stacked layers that share one concept namespace.

### 4.1 Canonical concept layer

This is the persistent set of known concepts in `concepts`.

It acts as the vocabulary layer for the entire system. Both tutoring sessions and WTR imports try to reuse existing concepts so the graph converges instead of fragmenting.

### 4.2 Student evidence layer

This is made of `concept_connections` rows where `child_key` is a real child identifier:

- `girl`
- `boy`

These edges represent relationships that emerged from tutoring sessions. They are linked to `episode_id`, so they preserve where they came from.

This layer is personalized. It reflects how a specific child has encountered ideas and what connections were made during tutoring.

### 4.3 Curriculum evidence layer

This is made of `concept_connections` rows where `child_key = 'curriculum'`.

These edges represent syllabus structure extracted from WTR uploads. They are linked to `wtr_upload_id`.

This layer is non-personal. It captures the school's intended sequencing and subject organization.

### 4.4 Why both layers matter

This layered design lets Drona answer a more useful tutoring question:

"What should be taught now for this student, given both what the school is covering and what the child currently understands or misunderstands?"

Without the curriculum layer, tutoring memory would drift away from school sequencing.
Without the student layer, tutoring would stay generic and fail to personalize.

The current architecture combines both inside a single retrieval path and a single explorer UI.

## 5. Database Design

## 5.1 `concepts`

`concepts` is the node table.

Important properties:

- UUID primary key.
- `unique(name, subject)` prevents duplicate concept labels within the same subject.
- `type` is constrained to the supported concept classes.

Important interpretation:

- same `name` in different subjects is allowed,
- same `name` in same subject is merged,
- subjectless concepts are allowed, especially seeded IB concepts.

This table is globally shared, not child-scoped.

### 5.2 `concept_connections`

`concept_connections` is the edge table.

Important properties:

- UUID primary key.
- Directed edge via `concept_a` -> `concept_b`.
- Provenance encoded in `child_key`.
- Optional source event references:
  - `episode_id` for tutoring sessions,
  - `wtr_upload_id` for curriculum uploads.

Important design choice:

The edge does not reference `concepts.id`. Instead, it stores concept names and subjects directly.

Benefits:

- simpler extraction writes,
- easier prompt formatting,
- easier manual inspection,
- concept rows can be absent and the edge still survives.

Costs:

- no strict referential integrity between edge endpoints and nodes,
- renaming concepts becomes harder,
- canonicalization quality depends on prompt behavior,
- display code must sometimes create synthetic nodes.

### 5.3 `learning_gaps`

`learning_gaps` is the mastery-state table.

Important properties:

- child-scoped records,
- `status` lifecycle of `open` or `resolved`,
- optional `resolved_at`,
- optional `episode_id`.

This design keeps conceptual misunderstanding records independent from the graph topology. That is appropriate because a gap is not "an edge"; it is a student-state annotation.

### 5.4 `wtr_uploads`

`wtr_uploads` is the ingestion log for curriculum files.

Important properties:

- lifecycle states: `pending`, `processing`, `completed`, `failed`,
- upload metadata,
- summary JSON for reporting,
- timestamps for operational visibility.

This table is necessary because curriculum extraction is an asynchronous-ish admin operation with failure modes, not just a silent insert.

### 5.5 Indexing strategy

The current schema includes indexes for:

- `concept_connections(child_key)`
- `concept_connections(concept_a)`
- `concept_connections(concept_b)`
- `concept_connections(wtr_upload_id)`
- `learning_gaps(child_key, status)`
- `wtr_uploads(created_at desc)`

These indexes support the current dominant access patterns:

- fetch child/curriculum scoped edges,
- look up edges by endpoint names,
- browse recent uploads,
- fetch unresolved gaps efficiently.

## 6. Access Control and Security Model

The knowledge map uses a mixed access model.

### 6.1 RLS on graph tables

RLS is enabled on:

- `concepts`
- `concept_connections`
- `learning_gaps`
- `wtr_uploads`

### 6.2 Read model

Current policies allow:

- authenticated users to read `concepts`,
- children to read their own `concept_connections` and `learning_gaps`,
- parents to read all student rows,
- authenticated users to read curriculum connections,
- no anonymous access by default.

### 6.3 Write model

Writes are comparatively permissive at the row-policy level for authenticated users, but the important runtime distinction is:

- student/session graph writes happen through app code,
- WTR admin writes happen through service-role-backed server routes,
- `wtr_uploads` is intentionally service-role/admin-oriented.

### 6.4 Admin secret

The admin routes for WTR and graph exploration optionally enforce `WTR_ADMIN_SECRET`.

If unset, the routes are open to the app runtime.
If set, requests must include `x-admin-secret`.

This is a lightweight operational gate around the administrative interfaces.

## 7. End-to-End Data Flows

There are three major system flows.

### 7.1 Flow A: tutoring session -> student knowledge map

This flow is implemented in `lib/graph/extract.ts`.

#### Step 1: session transcript is assembled

The system formats the conversation as a simple alternating transcript:

- `Student: ...`
- `Tutor: ...`

Context passed to extraction:

- `childKey`
- `episodeId`
- `subject`
- `topic`
- transcript messages

#### Step 2: Claude extracts structured learning data

Claude is prompted to produce JSON with:

- `concepts`
- `connections`
- `gaps`
- `gaps_resolved`

The extraction prompt is intentionally oriented around tutoring signals:

- meaningful concepts discussed,
- cross-subject or explanatory bridges,
- concepts still not understood,
- previously open gaps that now appear resolved.

#### Step 3: concepts are upserted

Extracted concepts are upserted into `concepts` using `onConflict: 'name,subject'`.

This is the graph's main convergence mechanism. It tries to ensure repeated encounters with the same idea reuse the same node.

#### Step 4: student edges are inserted

Connections are inserted into `concept_connections` with:

- `child_key = childKey`
- `episode_id = episodeId`

This is how the student-specific evidence layer is built.

#### Step 5: learning gaps are inserted

New unresolved misunderstandings are stored in `learning_gaps` with `status = 'open'`.

#### Step 6: resolved gaps are updated

If Claude reports that previously unresolved ideas now appear understood, the system updates matching open gaps to:

- `status = 'resolved'`
- `resolved_at = now()`

This creates a mastery-history trail across sessions.

### 7.2 Flow B: WTR upload -> curriculum knowledge map

This flow is implemented across:

- `app/api/admin/wtr/process/route.ts`
- `lib/graph/wtr.ts`
- `app/api/admin/wtr/route.ts`

#### Step 1: admin uploads syllabus file

Accepted file types:

- PNG
- JPEG
- WebP
- GIF
- PDF

The route validates:

- admin secret if configured,
- presence of `ANTHROPIC_API_KEY`,
- file size limit,
- mime type.

#### Step 2: upload row is created

A `wtr_uploads` row is inserted with status `processing`.

This means every ingestion attempt gets operational traceability even before extraction succeeds.

#### Step 3: existing concepts are fetched

The system loads existing concepts from Supabase and passes them into the extraction prompt.

This is a critical convergence step. It tells Claude:

- if the file refers to an already known idea,
- reuse the exact `name` and `subject`.

This reduces duplicate nodes caused by wording variation.

#### Step 4: Claude extracts curriculum map

The WTR prompt asks Claude to return only:

- concepts,
- directed connections.

No gaps are produced from WTR documents because these are not student-performance artifacts.

The prompt instructs Claude to infer:

- current week -> coming week sequencing,
- prerequisite/build-on relationships,
- justified cross-subject links,
- concise canonical concept names.

#### Step 5: concepts are upserted

WTR concepts are upserted into `concepts`, again using `name + subject` for convergence.

#### Step 6: curriculum edges are inserted

Connections are inserted with:

- `child_key = 'curriculum'`
- `episode_id = null`
- `wtr_upload_id = uploadId`

This is what turns the shared graph into a curriculum-aware graph.

#### Step 7: upload row is finalized

On success:

- status becomes `completed`,
- `completed_at` is set,
- summary JSON is stored.

On failure:

- status becomes `failed`,
- `error_message` is stored.

### 7.3 Flow C: graph retrieval -> tutoring context

This flow is implemented in `lib/graph/context.ts`.

When preparing context for a tutoring session, the system retrieves:

1. related concepts in the subject,
2. prior connections in the subject from both student and curriculum layers,
3. open gaps for the student,
4. recently resolved gaps.

Important retrieval rule:

For connections, the query includes both:

- the child's own edges,
- `curriculum` edges.

That is the key integration point between personalized memory and school syllabus alignment.

#### Output shape

The result is returned as `TopicGraphContext`:

- `related_concepts`
- `prior_connections`
- `open_gaps`
- `resolved_gaps`

#### Prompt formatting

`formatContextForPrompt()` converts that structured context into a text block for future tutoring prompts.

It explicitly distinguishes:

- known gaps to address,
- recently resolved concepts to reinforce but not re-teach,
- connections from student memory and syllabus memory.

This is the bridge from persisted graph memory back into live tutoring behavior.

## 8. Visualization and Explorer Architecture

The admin visualization is implemented in:

- `app/admin/graph/page.tsx`
- `app/api/admin/graph/route.ts`

The UI is not just a pretty graph. It is a diagnostic interface for understanding how the graph is evolving and whether extracted structure is useful.

### 8.1 Graph API role

`/api/admin/graph` reads concepts and connections from Supabase and applies:

- subject filters,
- grade filters,
- text search,
- source filters (`all`, `curriculum`, `student`).

It returns:

- visible concepts,
- visible connections,
- filter option lists,
- summary stats,
- trimming indicators.

### 8.2 Synthetic nodes

If an edge references a concept that is not present in `concepts`, the API may synthesize a concept object in memory for display.

This is an important architectural clue:

- the graph UI is resilient to imperfect database normalization,
- edge data is treated as first-class evidence even if node persistence is incomplete.

This keeps the explorer useful even when extraction or canonicalization is imperfect.

### 8.3 Trimming strategy

For readability and performance, the API trims:

- concepts to 220 visible nodes,
- connections to 320 visible edges.

It also returns flags:

- `trimmedConcepts`
- `trimmedConnections`

This is a pragmatic UI safeguard rather than a core graph constraint.

### 8.4 Overview mode

When no concept is selected, the explorer builds an overview map of the visible graph.

The overview layout does the following:

1. ranks concepts by degree,
2. computes directed levels using indegree reduction,
3. groups concepts into subject lanes,
4. places cross-subject or subjectless concepts into a shared lane,
5. draws directional edges between laid-out nodes.

This creates a lane-based visual topology:

- subjects remain visually separated,
- sequence-like structure is preserved across columns,
- shared ideas float into a common lane.

It is not a force-directed graph. It is a guided explanatory layout optimized for educational interpretability.

### 8.5 Focus mode

When a concept is selected, the explorer switches to a focused mind-map layout.

The layout logic is intentionally pedagogical:

- selected concept in the center-left,
- prerequisites on the far left,
- immediate next ideas on the right,
- second-order forward branches further right.

This lets an admin inspect a concept in terms a tutor would care about:

- what should come before,
- what follows next,
- what deeper branches this idea opens up.

### 8.6 Edge semantics in the UI

Edges are visually differentiated by provenance:

- curriculum edges,
- student edges.

This matters because the same local neighborhood may contain:

- school-defined progression,
- student-discovered conceptual links.

Seeing both at once reveals whether tutoring memory is aligning with curriculum structure or diverging from it.

### 8.7 Concept browser and relationship list

The right-side browser complements the visual graph with:

- concept lookup,
- degree counts,
- selected concept details,
- textual relationship listings.

This is useful because graph diagrams alone can hide precise relationship wording. The list preserves the raw semantic labels extracted into the graph.

## 9. Prompt Design Strategy

Prompt design is a central architectural component because extraction quality determines graph quality.

### 9.1 Session extraction prompt

The tutoring-session prompt is optimized for educational diagnosis.

It explicitly asks for:

- meaningful concepts,
- concept bridges,
- unresolved misunderstandings,
- newly resolved gaps.

The prompt discourages noise by asking for only ideas that were actually explored or explained.

This is essential because transcripts contain a lot of conversational filler that should not become graph nodes.

### 9.2 WTR extraction prompt

The WTR prompt is optimized for curriculum structure.

It asks Claude to identify:

- atomic ideas from syllabus documents,
- sequencing relationships,
- prerequisite or build-on relationships,
- explicit cross-subject links where justified.

It also emphasizes canonical reuse of existing concepts.

### 9.3 Why prompt-injected existing concepts matter

The system does not currently perform a robust post-extraction ontology reconciliation pass.

Instead, it reduces duplication earlier by telling Claude:

- here are existing concepts,
- reuse exact labels when the meaning matches.

This is a practical architecture choice:

- cheaper than full semantic matching after extraction,
- easier to implement,
- effective enough for early-stage graph convergence.

## 10. Semantic Rules Embedded in the System

The current design has several implicit rules that are worth making explicit.

### 10.1 Node identity rule

A concept is currently identified by:

- `name`
- `subject`

This means:

- same name + same subject = same canonical node,
- same name + different subject = distinct concepts,
- subjectless concepts form a shared pool.

### 10.2 Edge identity rule

Edges currently do not have a business-key uniqueness constraint. Multiple rows may represent the same conceptual relationship if they are extracted multiple times.

This means connections act more like observations than canonical graph axioms.

### 10.3 Direction rule

`concept_a` is always the source and `concept_b` the target.

The system uses this direction for:

- prerequisite vs subsequent ideas,
- curriculum sequencing,
- overview layout levels,
- focus-mode left/right branching.

### 10.4 Provenance rule

`child_key` functions as the edge-source channel:

- real child values mean student evidence,
- `curriculum` means syllabus evidence.

This is a compact but important architectural trick. One column carries both audience scoping and source semantics.

### 10.5 Gap lifecycle rule

Learning gaps move through a simple lifecycle:

1. extracted as unresolved,
2. stored as `open`,
3. later marked `resolved` when a session indicates understanding.

This keeps mastery tracking simple and prompt-friendly.

## 11. Current Strengths of the Architecture

### 11.1 Unified concept space

Both student understanding and school plans land in one graph, making later retrieval more powerful.

### 11.2 Easy LLM interoperability

The data model is simple enough to be:

- extracted by an LLM,
- re-injected into prompts,
- visualized without heavy graph tooling.

### 11.3 Strong inspectability

The entire system is easy to reason about because:

- tables are readable,
- routes are straightforward,
- graph UI is explicit,
- raw relationship text is preserved.

### 11.4 Curriculum alignment built in

The system does not merely remember what the student discussed. It also tracks what the school intends, which is vital for practical tutoring.

### 11.5 Supports interdisciplinary tutoring

Because cross-subject edges are first-class, the graph can support explanations like:

- mathematics concept -> science application,
- IB key concept -> multiple subject topics.

This is pedagogically valuable for concept transfer.

## 12. Current Limitations and Architectural Trade-Offs

The current implementation is good for an early-stage semantic memory system, but several limitations are important.

### 12.1 Edge endpoints are string-based, not foreign-key-based

Because `concept_connections` stores names and subjects instead of `concept_id` references:

- endpoint integrity is soft,
- concept renames are expensive,
- duplicate naming errors can propagate,
- explorer code must compensate with synthetic nodes.

This is the biggest structural trade-off in the current architecture.

### 12.2 No edge deduplication

Repeated extractions can insert semantically duplicate edges. Over time this can inflate degree counts and clutter the graph.

### 12.3 Grade is concept-level, not edge-level

The grade is stored on concepts and upload metadata, but edge sequencing is not strongly grade-scoped beyond filtering behavior.

This means the model is not yet a full curriculum versioning system.

### 12.4 Subject-scoped context retrieval is shallow

`getTopicContext()` retrieves a limited number of rows and filters by subject. This is practical, but it may miss useful cross-subject context if the relevant bridge sits outside the immediate subject window.

### 12.5 Canonicalization depends heavily on prompt quality

The system relies on Claude to reuse exact concept labels. This works reasonably well but is not guaranteed.

### 12.6 Gap resolution matching is name-based

Resolved gaps are updated by matching concept name strings. This is convenient, but brittle if the resolved concept label differs slightly from the originally stored gap label.

## 13. Recommended Mental Model for the Team

The simplest accurate mental model is:

"Drona has a shared educational concept graph with two evidence overlays: what the school is teaching and what the student has experienced in tutoring. On top of that, it keeps a separate mastery ledger of unresolved and resolved misunderstandings."

Or even more compactly:

- `concepts` = vocabulary,
- `concept_connections` = evidence-backed links,
- `learning_gaps` = mastery state,
- `wtr_uploads` = curriculum ingestion history.

## 14. Suggested Evolution Path

These are not required for the current system to function, but they are the natural next architectural improvements.

### 14.1 Add concept foreign keys to edges

Move from string endpoints to:

- `concept_a_id`
- `concept_b_id`

while optionally retaining name snapshots for audit/debugging.

This would improve:

- integrity,
- rename support,
- deduplication,
- query reliability.

### 14.2 Introduce connection deduplication or weighting

Possible approaches:

- unique constraint on a normalized edge signature,
- observation counts,
- confidence scores,
- source-specific weights.

This would make the graph better at representing repeated evidence without exploding in row count.

### 14.3 Add canonicalization pipeline after extraction

Instead of relying only on prompt reuse, add a post-processing reconciliation step that:

- fuzzy-matches extracted concepts,
- confirms subject mapping,
- merges synonyms into canonical nodes.

### 14.4 Model curriculum time more explicitly

The WTR system already stores:

- period type,
- label,
- school year.

The next step would be to expose temporal curriculum navigation, such as:

- this week,
- upcoming week,
- prior term,
- year progression.

### 14.5 Attach confidence and provenance metadata

For high-quality downstream tutoring, it may help to store:

- extraction confidence,
- extraction model version,
- human-reviewed status,
- edge source count.

### 14.6 Promote gaps into richer mastery modeling

The current open/resolved state is useful, but future versions could model:

- confidence of mastery,
- date last reinforced,
- misconception categories,
- prerequisite dependency of gaps.

## 15. Summary

The knowledge map architecture is a hybrid memory system for tutoring.

It combines:

- a shared graph of educational concepts,
- personalized student-derived relationships,
- curriculum-derived syllabus relationships,
- and a separate mastery-tracking system for learning gaps.

Its most important architectural insight is that student understanding and curriculum structure should live in the same conceptual space, but remain distinguishable by provenance.

That allows Drona to be:

- longitudinal across sessions,
- aligned with school teaching,
- personalized to the learner,
- inspectable by humans,
- and usable by LLM-based tutoring flows.

In its current form, the system is best described as a practical semantic graph built for educational memory rather than a fully normalized graph platform. That makes it simple, flexible, and already useful, while leaving clear room for stronger canonicalization and graph integrity as the product matures.
