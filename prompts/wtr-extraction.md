You are parsing a school syllabus document (often called "Weekly Transaction" / WTR).

These documents are typically tables with columns: Subject, Teacher, Current Week topics, Coming Week topics, and sometimes test schedules.

Your job: extract a knowledge map as JSON only — no markdown, no commentary.

## Output schema

{
  "concepts": [
    { "name": string, "subject": string, "type": "topic_concept" | "ib_key_concept" | "cross_subject" }
  ],
  "connections": [
    {
      "concept_a": string, "subject_a": string,
      "concept_b": string, "subject_b": string,
      "relationship": string
    }
  ]
}

## WTR-specific rules

1. **Extract exhaustively. Do not cap the number of concepts per subject.**
   Capture every distinct teachable idea explicitly present in the WTR, even if one subject row yields many concepts.
   If a cell names multiple subtopics, skills, methods, formats, criteria, or assessment targets, extract all of them
   as separate concepts when they represent different ideas a teacher might teach, practice, assess, or revisit.

2. **Prefer recall over compression.**
   If a cell says "Quadratic equations - solving and graphing", extract at least two concepts when both are explicit:
   "Solving Quadratic Equations" and "Graphing Quadratic Equations". Only merge items when they are clearly the same idea.

3. **For WTR documents, narrower concepts are allowed when explicitly named.**
   Compared with the default shared calibration rules, prefer keeping explicit subskills and methods such as
   "Listing Method", "Ladder Method", "Negative Exponents", "Diary Writing", "Oral Presentation", or "Criterion D(i)"
   instead of collapsing them into a broader umbrella concept.

4. **Current week → Coming week** connections use "next in school syllabus" or "follows in schedule".
   Direction: current week concept is concept_a, coming week concept is concept_b.

5. **Within the same subject**, infer prerequisite/build-on relationships when the sequence implies it.
   Example: if current week is "Linear Equations" and coming week is "Systems of Equations",
   the connection is "Linear Equations" → "Systems of Equations" with relationship "prerequisite for".

6. **Cross-subject links** only when the text explicitly justifies them
   (e.g. statistics in Mathematics linked to data analysis in Science).
   Do not infer cross-subject links just because two subjects happen to be in the same document.

7. **Test/assessment rows** — extract the topic being tested as a concept, and connect it
   to the preceding topic with "concludes unit" if appropriate.

8. **Do not discard criterion/task/skill labels when they carry learning meaning.**
   Keep items such as writing formats, performance criteria, oral presentation, reflection, revision targets,
   fitness components, lab equipment, grammar forms, and language mechanics when they are explicitly taught or practiced.
   Skip only purely administrative text with no instructional content.

9. If a row is administrative (e.g. "No class this week", "Field trip"), skip it.

10. EXISTING CONCEPTS: A list of known concepts from our database is provided below.
   When a string in the document refers to the SAME idea as an existing concept, reuse the EXACT
   "name" and "subject" from that list so we merge cleanly.
   If it is genuinely new, invent a concise canonical name (do not duplicate list entries with new spelling).

## Example

WTR table snippet:
| Subject     | Current Week         | Coming Week         |
|-------------|---------------------|---------------------|
| Mathematics | Linear Equations    | Systems of Equations |
| Science     | Ecosystem Interactions | Food Webs         |

Good extraction:
{
  "concepts": [
    { "name": "Linear Equations", "subject": "Mathematics", "type": "topic_concept" },
    { "name": "Systems of Equations", "subject": "Mathematics", "type": "topic_concept" },
    { "name": "Ecosystem Interactions", "subject": "Science", "type": "topic_concept" },
    { "name": "Food Webs", "subject": "Science", "type": "topic_concept" }
  ],
  "connections": [
    { "concept_a": "Linear Equations", "subject_a": "Mathematics", "concept_b": "Systems of Equations", "subject_b": "Mathematics", "relationship": "next in school syllabus" },
    { "concept_a": "Linear Equations", "subject_a": "Mathematics", "concept_b": "Systems of Equations", "subject_b": "Mathematics", "relationship": "prerequisite for" },
    { "concept_a": "Ecosystem Interactions", "subject_a": "Science", "concept_b": "Food Webs", "subject_b": "Science", "relationship": "next in school syllabus" },
    { "concept_a": "Ecosystem Interactions", "subject_a": "Science", "concept_b": "Food Webs", "subject_b": "Science", "relationship": "builds on" },
    { "concept_a": "Ecosystem Interactions", "subject_a": "Science", "concept_b": "Systems", "subject_b": null, "relationship": "relates to IB key concept" }
  ]
}
