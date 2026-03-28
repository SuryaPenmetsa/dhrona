Continue building the AI tutoring app. The knowledge graph module is already 
built and working. Do not touch anything in /lib/graph/ or the graph admin UI.
Build everything else in phases, exactly as described below.

---

## WHAT ALREADY EXISTS — DO NOT MODIFY

/lib/graph/                     → knowledge graph module (complete)
/app/admin/graph/               → graph visualizer UI (complete)  
/lib/supabase/client.ts         → Supabase browser client
/lib/supabase/server.ts         → Supabase server client
/lib/anthropic/client.ts        → Anthropic client
/supabase/migrations/001_*      → base schema (if any)
/supabase/migrations/002_*      → knowledge graph tables

---

## STACK REMINDER

Next.js 14 App Router, TypeScript strict, Tailwind CSS, shadcn/ui
Supabase (Auth + Postgres + Storage), Anthropic claude-sonnet-4-20250514
Vercel deployment target

---

## PHASE 1 — DATABASE + AUTH
Build this first. Nothing else works without it.

### Migration: /supabase/migrations/003_app_schema.sql
```sql
-- User profiles (extends Supabase auth.users)
create table profiles (
  id         uuid references auth.users(id) on delete cascade primary key,
  role       text not null check (role in ('parent', 'child')),
  name       text not null,
  child_key  text check (child_key in ('girl', 'boy')), -- null for parents
  created_at timestamptz default now()
);

-- Child AI tutor instruction files (editable by parent)
create table child_instructions (
  id          uuid primary key default gen_random_uuid(),
  child_key   text unique not null check (child_key in ('girl', 'boy')),
  content     text not null,
  updated_at  timestamptz default now()
);

-- Academic grades
create table grades (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,        -- '6th Grade'
  academic_year text not null,        -- '2025-26'
  is_active     boolean default true,
  created_by    uuid references profiles(id),
  created_at    timestamptz default now()
);

-- Subjects per grade
create table subjects (
  id          uuid primary key default gen_random_uuid(),
  grade_id    uuid references grades(id) on delete cascade,
  name        text not null,          -- 'Mathematics'
  short_code  text not null,          -- 'MATH'
  color       text not null,          -- hex color '#1D9E75'
  applies_to  text default 'both' check (applies_to in ('both', 'girl', 'boy')),
  created_at  timestamptz default now()
);

-- Uploaded syllabus files
create table syllabus_uploads (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid references subjects(id) on delete cascade,
  grade_id        uuid references grades(id),
  filename        text not null,
  file_type       text not null,      -- 'pdf' | 'xlsx' | 'docx'
  storage_path    text not null,
  parse_status    text default 'pending' 
                  check (parse_status in ('pending','processing','done','failed')),
  error_message   text,
  uploaded_by     uuid references profiles(id),
  created_at      timestamptz default now()
);

-- Syllabus topics (AI-extracted from uploads)
create table syllabus_topics (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid references subjects(id) on delete cascade,
  grade_id        uuid references grades(id),
  title           text not null,
  description     text,
  term            text,               -- 'Term 1' | 'Term 2' | 'Term 3'
  week_number     int,
  start_date      date,
  end_date        date,
  sequence_order  int,
  source_upload_id uuid references syllabus_uploads(id),
  created_at      timestamptz default now()
);

-- Curriculum items per child (derived from syllabus topics)
create table curriculum_items (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid references profiles(id),
  topic_id    uuid references syllabus_topics(id),
  subject_id  uuid references subjects(id),
  grade_id    uuid references grades(id),
  title       text not null,
  item_type   text default 'class' 
              check (item_type in ('class','assignment','project','exam','self_study')),
  due_date    date,
  status      text default 'upcoming' 
              check (status in ('upcoming','in_progress','completed')),
  created_at  timestamptz default now()
);

-- Materials uploaded by children per topic
create table topic_materials (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid references syllabus_topics(id) on delete cascade,
  child_id        uuid references profiles(id),
  filename        text not null,
  file_type       text not null,
  storage_path    text not null,
  label           text not null,      -- 'Class notes Oct 3'
  extracted_text  text,               -- first 800 chars of PDF text
  uploaded_at     timestamptz default now()
);

-- Tutor sessions (episodes)
create table episodes (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid references profiles(id),
  topic_id     uuid references syllabus_topics(id),
  subject_id   uuid references subjects(id),
  subject_name text,
  topic_title  text,
  messages     jsonb default '[]',    -- [{role, content, created_at}]
  summary      text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Indexes
create index idx_curriculum_child on curriculum_items(child_id);
create index idx_curriculum_due on curriculum_items(due_date);
create index idx_episodes_child on episodes(child_id);
create index idx_episodes_topic on episodes(topic_id);
create index idx_topics_subject on syllabus_topics(subject_id);
create index idx_materials_topic on topic_materials(topic_id, child_id);

-- RLS
alter table profiles enable row level security;
alter table child_instructions enable row level security;
alter table grades enable row level security;
alter table subjects enable row level security;
alter table syllabus_uploads enable row level security;
alter table syllabus_topics enable row level security;
alter table curriculum_items enable row level security;
alter table topic_materials enable row level security;
alter table episodes enable row level security;

-- Profiles: own row only
create policy "profiles: read own"
  on profiles for select using (auth.uid() = id);
create policy "profiles: update own"
  on profiles for update using (auth.uid() = id);

-- Child instructions: all authenticated can read, parents update
create policy "instructions: read all"
  on child_instructions for select using (auth.role() = 'authenticated');
create policy "instructions: parent update"
  on child_instructions for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );

-- Grades + subjects: all read, parent write
create policy "grades: read all" on grades for select using (auth.role() = 'authenticated');
create policy "grades: parent write" on grades for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'parent')
);
create policy "subjects: read all" on subjects for select using (auth.role() = 'authenticated');
create policy "subjects: parent write" on subjects for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'parent')
);

-- Curriculum items: child sees own, parent sees all
create policy "items: child sees own"
  on curriculum_items for select using (
    child_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );
create policy "items: authenticated insert"
  on curriculum_items for insert with check (auth.role() = 'authenticated');
create policy "items: update own status"
  on curriculum_items for update using (child_id = auth.uid() or 
    exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );

-- Syllabus topics: all read
create policy "topics: read all" 
  on syllabus_topics for select using (auth.role() = 'authenticated');
create policy "topics: parent write" on syllabus_topics for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'parent')
);

-- Topic materials: child sees own, parent sees all
create policy "materials: read"
  on topic_materials for select using (
    child_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );
create policy "materials: child insert"
  on topic_materials for insert with check (child_id = auth.uid());

-- Episodes: child sees own, parent sees all
create policy "episodes: read"
  on episodes for select using (
    child_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );
create policy "episodes: child insert"
  on episodes for insert with check (child_id = auth.uid());
create policy "episodes: child update"
  on episodes for update using (child_id = auth.uid() or
    exists (select 1 from profiles where id = auth.uid() and role = 'parent')
  );

-- Seed: child instruction defaults
insert into child_instructions (child_key, content) values
('girl', '# Girl — AI Tutor Instructions

## Who they are
12-year-old girl, 6th grade IB MYP, Indus International School Hyderabad.
Intensely competitive, academically top of class. Highly organised.
Risk: external achievement may be overriding genuine curiosity.

## How to teach her
- Always ask "do you understand WHY this works?" not just whether she got it right
- Use Socratic method: questions first, always
- When she rushes to the answer, slow her down: "Before we check if you are right, tell me your reasoning"
- Connect concepts to strategy, systems, how things work at scale

## What to watch for
- If asking for quick answers to finish faster, redirect to depth
- If fatigued or overwhelmed, give permission to slow down
- Gently challenge grade-focus: "If there were no exam, would you still find this interesting?"

## Tone
Direct, intellectually stimulating. Push her. She responds to challenge.

## Hard rules
- Never just validate without probing reasoning
- Never say "you are so smart" — praise effort and depth
- Never compare to her brother
- Never encourage rushing'),

('boy', '# Boy — AI Tutor Instructions

## Who they are
12-year-old boy, 6th grade IB MYP, Indus International School Hyderabad.
Laid-back, deep thinker, creative. Kinesthetic learner.
Into video editing, YouTube, basketball. Can hyperfocus on things he loves.

## How to teach him
- Meet him where he is: use video editing for maths (frame rates, ratios),
  basketball for physics (projectile motion, arcs), YouTube for storytelling
- Give physical and spatial analogies for abstract concepts
- Let him demonstrate understanding verbally or through sketches
- Break big tasks into small concrete milestones
- When he goes off-topic, follow his thinking first, then redirect

## What to watch for
- Distraction is a signal, not a character flaw — ask what he was thinking about
- If disengaged, change the entry point to something he cares about
- Watch for hyperfocus moments — when locked in, extend it

## Tone
Casual, warm, genuinely curious about his ideas. Short responses.
Use humour. Ask what he thinks before explaining anything.

## Hard rules
- Never give walls of text
- Never demand a specific response format
- Never treat distraction as laziness
- Never compare to his sister');

-- Seed: active grade and IB MYP subjects
insert into grades (label, academic_year, is_active) 
values ('6th Grade', '2025-26', true);
```

After migration, also seed subjects for the grade:
```sql
-- Run after grade is inserted (use the grade id)
insert into subjects (grade_id, name, short_code, color, applies_to)
select 
  g.id,
  s.name,
  s.code,
  s.color,
  'both'
from grades g
cross join (values
  ('Language & Literature', 'LL', '#1D9E75'),
  ('Mathematics', 'MATH', '#185FA5'),
  ('Sciences', 'SCI', '#854F0B'),
  ('Individuals & Societies', 'IS', '#993556'),
  ('Arts', 'ARTS', '#534AB7'),
  ('Physical & Health Education', 'PHE', '#3B6D11'),
  ('Design', 'DES', '#993C1D'),
  ('Advisory', 'ADV', '#5F5E5A')
) as s(name, code, color)
where g.academic_year = '2025-26';
```

### Auth pages

/app/(auth)/login/page.tsx
- Email + password form using Supabase Auth
- On success: fetch profile row → if role='parent' redirect to /parent,
  else redirect to /dashboard
- No signup page — parent creates child accounts from /parent setup

/app/(auth)/setup/page.tsx  
- Only reachable if profile row doesn't exist after login
- Form: enter name, shown role (auto-detected from a setup token or parent invite)
- Creates profile row
- Redirects to appropriate dashboard

### Route protection

Create /middleware.ts:
- If no session → redirect to /login
- If session but no profile → redirect to /setup
- If role=child and trying to access /parent → redirect to /dashboard
- If role=parent and trying to access /dashboard → redirect to /parent

---

## PHASE 2 — CHILD DASHBOARD

URL: /dashboard

This is the child's home screen. Simple weekly view.
The child who logs in sees only their own data, determined by their profile.child_key.

### Layout

Full-page, clean. Two columns on desktop, single column on mobile.

Left column (60%): Weekly agenda
- Header: child's name + "Week of [Mon date] – [Fri date]"
- Days listed Mon → Fri as collapsible sections (default open for today, closed for others)
- Each day shows curriculum_items where due_date = that day
- Each item card shows:
  - Subject colour dot + subject name pill
  - Item title
  - Item type badge (class / assignment / exam / project)
  - Status toggle (checkbox: marks as completed)
  - Two small buttons: "Study →" (opens tutor) | "Materials +" (opens upload)
- Empty day shows: "Nothing scheduled" in muted text
- Below the week: "+ Add item" link (simple form: title, subject, type, due date)

Right column (40%): Quick panels
- "Today's focus" card: items due today or tomorrow, highlighted
- "Open gaps" card: fetch learning_gaps where child_key matches, status='open'
  Show as a small list: concept + subject + note snippet
  Title: "Things to revisit"
- "Recent sessions" card: last 3 episodes with subject + topic + date
  Each links to /review

Floating button bottom-right: "Ask AI" → opens /tutor with no pre-selected topic

### Data fetching

Use server components where possible. 
Fetch curriculum_items for current week using the child's profile ID.
Week = Mon 00:00 to Sun 23:59 in IST (UTC+5:30).
Join with subjects to get color and name.

---

## PHASE 3 — AI TUTOR CHAT

URL: /tutor (general) and /tutor?topicId=[id]&episodeId=[id]

This is the core feature. Full-screen chat with streaming Claude responses.

### System prompt builder

Create /lib/anthropic/prompts.ts
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTopicContext, formatContextForPrompt } from '@/lib/graph'
import type { ChildKey } from '@/lib/graph'

export async function buildSystemPrompt({
  childKey,
  subjectName,
  topicTitle,
  topicDescription,
}: {
  childKey: ChildKey
  subjectName?: string
  topicTitle?: string
  topicDescription?: string
}): Promise<string> {

  const supabase = await createClient()

  // 1. Fetch base instructions from DB
  const { data: instructions } = await supabase
    .from('child_instructions')
    .select('content')
    .eq('child_key', childKey)
    .single()

  const baseInstructions = instructions?.content ?? 'You are a helpful tutor.'

  // 2. Fetch graph context if topic provided
  let graphContext = ''
  if (subjectName && topicTitle) {
    const ctx = await getTopicContext({ childKey, subject: subjectName, topic: topicTitle })
    graphContext = formatContextForPrompt(ctx)
  }

  // 3. Build session context block
  const sessionBlock = topicTitle ? `
## Current session
Subject: ${subjectName}
Topic: ${topicTitle}
${topicDescription ? `What this covers: ${topicDescription}` : ''}

Begin by asking what the student already knows about ${topicTitle}.
Do not begin with an explanation. Begin with a question.
` : `
## Current session
This is a general study session. No specific topic selected.
Ask the student what they want to explore today.
`

  return [baseInstructions, sessionBlock, graphContext]
    .filter(Boolean)
    .join('\n\n---\n\n')
}
```

### Streaming API route

/app/api/tutor/route.ts

POST body: { episodeId, childKey, subjectName, topicTitle, topicDescription, messages }
```typescript
// 1. Build system prompt using buildSystemPrompt()
// 2. Stream Claude response using anthropic.messages.stream()
// 3. Return a ReadableStream using StreamingTextResponse pattern
// 4. After each response chunk: append to episodes.messages in Supabase
//    (do this async, don't block the stream)
// 5. Handle errors gracefully — if Claude fails, return a fallback message
```

### Session summary API route

/app/api/episodes/summarize/route.ts

POST body: { episodeId, childKey }
```typescript
// 1. Fetch full episode messages from Supabase
// 2. Send to Claude with prompt:
//    "Summarise this tutoring session in 4-5 sentences.
//     Write for the student to read, not the teacher.
//     Focus on: what concept was explored, what the student understood,
//     what question or gap emerged, what to look at next.
//     Be warm and direct. No bullet points."
// 3. Save summary to episodes.summary
// 4. Trigger extractAndSaveGraph() from /lib/graph with full messages
//    Pass the child_key, episode_id, subject_name, topic_title
// 5. Return { summary }
```

### Chat UI

/app/(child)/tutor/page.tsx

Layout: Full screen. Dark-ish background (slate-950 or similar).

Top bar (sticky):
- Back arrow → /dashboard
- Subject pill + topic title (if set)
- "End session" button (calls summarize API, then redirects to /review)

Chat area (scrollable):
- Messages rendered as bubbles
- Child messages: right-aligned, teal background
- AI messages: left-aligned, neutral background, slightly wider
- AI messages render markdown (use react-markdown with remark-gfm)
- Streaming: show a pulsing dot while AI is responding
- Auto-scroll to bottom on new message

Input area (sticky bottom):
- Text input + Send button
- On send: append user message to local state → call /api/tutor → stream response

On page load:
- If no episodeId in params: create new episode row in Supabase, get ID, set in URL
- If topicId in params: fetch topic data to populate subject + topic title
- Load existing messages if episodeId already has messages (resuming session)

Topic context panel (collapsible sidebar on desktop):
- Shows open gaps for this subject
- Shows materials uploaded for this topic (list of labels)
- "Upload material" button → opens upload modal

---

## PHASE 4 — REVIEW SCREEN

URL: /review

The memory layer. Where sessions become study notes.

### Layout

Two-panel layout on desktop. Single column on mobile.

Left panel: Subject navigation (sticky)
- List of subjects (from subjects table), color-coded
- Each subject has a disclosure triangle
- Expanded: shows syllabus_topics for that subject in sequence order
- Click a topic → loads that topic's content in right panel
- Unread indicator if topic has episodes with no summary yet

Right panel: Topic detail
Shows when a topic is selected:

1. Topic header: subject pill + topic title + date range
2. "Open gaps" section (if any learning_gaps are open for this topic/subject)
3. "Sessions" section: list of episodes linked to this topic
   Each episode card:
   - Date + duration (derive from messages timestamps)
   - Summary paragraph (if exists) — this IS the revision note
   - Expand toggle → shows full transcript (collapsible)
   - "Study again →" button → opens /tutor with this topicId
4. "Materials" section: list of topic_materials uploaded by child
   Each shows label + file type + upload date
   Click → opens file in new tab (use Supabase Storage signed URL)

Top of page: 
- Search bar: searches episode summaries and topic titles (client-side filter)
- Filter pills: Term 1 | Term 2 | Term 3 | All

Empty state (no topic selected):
- "Select a topic from the left to see your study notes"
- Show 3 most recent episodes as quick-access cards

---

## PHASE 5 — PARENT DASHBOARD

URL: /parent

Single page, tab navigation. Five tabs.

### Tab 1: Setup (grade + subjects)

Shows active grade + subject list.
If no active grade: show "Create Grade" form first.
  - Fields: Grade label (e.g. '7th Grade'), Academic year (e.g. '2026-27')
  
Subject builder (after grade exists):
  - Shows current subjects as coloured pills with edit/delete
  - "Add subject" inline form: Name, Short code (auto-suggested), Colour picker (8 presets), Applies to
  - Pre-populated with IB MYP subjects from seed (can be edited)

### Tab 2: Curriculum upload

Step-by-step flow:

Step 1: Select subject (dropdown) + Term (Term 1/2/3) + term dates
Step 2: Drag-and-drop upload zone
  - Accepts: PDF, XLSX, DOCX
  - Shows upload progress
  - On upload: store in Supabase Storage at /syllabus/{grade_id}/{subject_id}/{filename}
  - Insert syllabus_uploads row with parse_status='pending'
  - Trigger POST /api/parse-syllabus with upload ID

Step 3: Review extracted topics
  - Shows parsed topics in an editable table
  - Columns: Week | Title | Start date | End date | Description (editable)
  - Add row / delete row buttons
  - "Confirm and apply to children" button
  - On confirm: insert syllabus_topics, then create curriculum_items for both children

Parse API: /app/api/parse-syllabus/route.ts
```typescript
// POST { uploadId }
// 1. Fetch upload row → get storage_path, file_type, subject name, term dates
// 2. Download file from Supabase Storage
// 3. Extract text:
//    - PDF: use pdf-parse
//    - XLSX: use xlsx library (sheets to text)
//    - DOCX: use mammoth
// 4. Send to Claude:
const PARSE_PROMPT = `
Parse this school syllabus document for IB MYP 6th Grade.
Subject: {subject_name}
Term: {term} ({start_date} to {end_date})

Extract all topics taught this term. Return ONLY a JSON array, no preamble.
Each item: {
  title: string,           // short topic name, 2-5 words
  description: string,     // 1-2 sentences on what this covers
  week_number: number,     // week of academic year (1-36), infer from position
  start_date: string,      // ISO date, infer from term dates and topic order
  end_date: string,        // ISO date
  sequence_order: number   // integer order within this term
}
`
// 5. Parse JSON response
// 6. Update parse_status to 'done' or 'failed'
// 7. Return { topics } for parent to review
```

### Tab 3: Calendar view

Monthly calendar grid.
- Subject-coloured blocks showing which topics are active each week
- Click a week block → slide-in panel showing: topic description + linked episodes count + materials count
- Toggle: Girl / Boy (shows that child's curriculum_items)
- "Add one-off item" button → form: title, subject, type, date, which child

### Tab 4: Sessions viewer

Two columns: Girl | Boy

Each column:
- Recent episodes list (last 10), most recent first
- Each card: date + subject + topic + first line of summary
- Click → expands to show full summary + transcript
- Filter by subject dropdown

### Tab 5: Instructions editor

Two panels side by side: Girl | Boy

Each panel:
- Large textarea showing current content from child_instructions table
- Character count
- "Save" button → PATCH child_instructions SET content = ... WHERE child_key = ...
- Last updated timestamp
- Warning banner: "Changes take effect immediately on the next session"

---

## PHASE 6 — CHILD MATERIAL UPLOAD

Accessible from: topic cards in /dashboard and topic detail in /review

Component: /components/materials/UploadMaterial.tsx

Slide-in panel (not a modal):
- File picker: accepts PDF, JPG, PNG, DOCX
- Label field: "What is this?" (placeholder: "Class notes", "Worksheet 4", "My summary")
- Upload button
- On upload:
  - POST to /app/api/materials/upload
  - Store file in Supabase Storage at /materials/{child_id}/{topic_id}/{filename}
  - Extract text if PDF (first 800 chars using pdf-parse)
  - Insert topic_materials row
  - Show success: "Saved to [Topic name]"

Upload API: /app/api/materials/upload/route.ts
```typescript
// 1. Auth check — must be child role
// 2. Receive FormData: file, topic_id, label
// 3. Upload to storage
// 4. If PDF: extract text, truncate to 800 chars
// 5. Insert topic_materials row
// 6. Return { material_id, label }
```

---

## DESIGN SYSTEM

Apply consistently across all pages:

Colors:
- Girl child theme: teal accent (use Tailwind teal-500/600)  
- Boy child theme: amber accent (use Tailwind amber-500/600)
- Parent theme: slate neutral
- Background: white / slate-50
- Cards: white with slate-200 border, subtle shadow

Typography: Inter (already in Next.js default stack)
Spacing: generous — 24px padding on cards, 16px gaps between elements
No gamification: no points, badges, streaks, leaderboards
No bold gradients: flat colours only

Subject colour pills: use the hex colours seeded in subjects table
Render as: <span style={{ backgroundColor: subject.color + '20', color: subject.color }}>

---

## NAVIGATION

Child navigation (bottom bar on mobile, left sidebar on desktop):
  Home (/dashboard) | Study (/tutor) | Review (/review)

Parent navigation (top tabs):
  Setup | Curriculum | Calendar | Sessions | Instructions

Shared: logout button, profile name display

---

## FILE STRUCTURE TO CREATE

/app
  /(auth)/login/page.tsx
  /(auth)/setup/page.tsx
  /(child)/dashboard/page.tsx
  /(child)/tutor/page.tsx
  /(child)/review/page.tsx
  /(parent)/parent/page.tsx
  /api/tutor/route.ts
  /api/episodes/summarize/route.ts
  /api/parse-syllabus/route.ts
  /api/materials/upload/route.ts
/components
  /tutor/ChatWindow.tsx
  /tutor/MessageBubble.tsx
  /tutor/TopicContextPanel.tsx
  /curriculum/WeekView.tsx
  /curriculum/ItemCard.tsx
  /curriculum/SubjectPill.tsx
  /review/EpisodeCard.tsx
  /review/TranscriptViewer.tsx
  /review/SubjectNav.tsx
  /materials/UploadMaterial.tsx
  /parent/InstructionsEditor.tsx
  /parent/CurriculumUpload.tsx
  /parent/CalendarView.tsx
/lib
  /anthropic/prompts.ts
  /supabase/types.ts        ← generated types from schema
/middleware.ts

---

## BUILD SEQUENCE — STRICT ORDER

Phase 1 first. Verify migration runs and auth redirects work before moving on.
Phase 2 next. Get the dashboard rendering with real data before building the tutor.
Phase 3 next. Tutor chat working end-to-end (including graph context injection) 
  before building review or parent tools.
Phase 4 next. Review screen reads from episodes created in Phase 3.
Phase 5 last. Parent tools are additive — app is useful without them.
Phase 6 can be built alongside Phase 4.

After each phase: test with real Supabase data before proceeding.

---

## CRITICAL INTEGRATION POINT — GRAPH MODULE

The graph module (/lib/graph/) must be called in exactly two places:

1. In /app/api/episodes/summarize/route.ts — AFTER saving the summary:
   import { extractAndSaveGraph } from '@/lib/graph'
   await extractAndSaveGraph({ childKey, episodeId, subject, topic, messages })

2. In /lib/anthropic/prompts.ts — BEFORE building the system prompt:
   import { getTopicContext, formatContextForPrompt } from '@/lib/graph'
   const ctx = await getTopicContext({ childKey, subject, topic })
   const graphContext = formatContextForPrompt(ctx)

These two calls close the learning loop:
  session → extract graph → stored → retrieved → richer next session

Do not call graph functions anywhere else.
Do not modify /lib/graph/.

---

## PACKAGES TO INSTALL

npm install pdf-parse xlsx mammoth react-markdown remark-gfm
npm install @types/pdf-parse --save-dev

---

Start with Phase 1. Run the migration, build auth pages, verify role-based 
redirect works with a test parent login and test child login.
Confirm with me before starting Phase 2.