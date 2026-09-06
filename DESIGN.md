# Memorest — Design Spec (v2)

> Revised UX (2026-09-04). Supersedes `DESIGN_v1.md`. Build phases + status: `BUILD_PLAN.md`.
> Prompt log: `CLAD_PROMPTS.md`.

## What changed from v1 (read this first)

The core interaction was restructured so journaling is not a late-night chore:

1. **Emotion + reflection are per-object (per-moment), captured immediately** — while the
   object and feeling are still relevant. NOT chosen once for the whole day at the end.
2. **Capture is separated from journal composition.** Two entry points: **Capture a Moment**
   and **Review Today**. A user can capture one moment and leave; compose the journal later.
3. **One object is enough.** No requirement to collect several traces. Users may capture more
   throughout the day.
4. **Ask the reflective question right after the emotion**, per moment.
5. **The reflective question depends on the chosen emotion.**
6. **Private by default.** At save: **Keep Private** (personal monthly archive) vs
   **Place in Space** (optionally anchored somewhere meaningful).
7. **Music search is removed from the MVP.** Add later, only once journaling is reliable.
8. **One sphere = one day.** Individual objects are *moments within* the day; the completed
   daily journal becomes one coloured sphere in the monthly collection.
9. Object cards use a **background-removed cut-out** (Gemini segmentation mask), not the raw
   still.

## Technical framing (unchanged)

Snap Spectacles Lens, Lens Studio 5.22+. Each deliberately captured still is sent to
**Gemini Flash** (`gemini-3-flash-preview`) via the **Remote Service Gateway**. No local ML.
World units cm. Gemini returns object label, visible text, optional clearly-visible
date/location, a segmentation mask, and a confidence level. Uncertain info is never saved or
used until the user confirms it.

## Revised experience summary

Users capture meaningful objects and their emotional significance whenever moments occur.
Each object becomes a small memory card (cut-out + confirmed info + emotion + reflection +
capture time). Later, the Lens combines selected moments into one personal daily journal
entry, stored as a private spatial memory sphere.

---

## UX flow

### 1. Home

Two actions:

* **Capture a Moment** — "Notice something meaningful around you."
* **Review Today** — "Turn today's moments into a journal entry."

If there are no captured moments, **disable Review Today**.

### 2. Capture the object

The user looks at an object and pinches.

Show: **Hold still while I capture this moment.**

Use a still image, not continuous scanning. Show a subtle loading animation while Gemini
processes it.

### 3. Create the object card

Gemini returns: object label, visible text, date/location text *only when clearly visible*,
object segmentation mask, confidence level.

Display a card with:

* Background-removed object thumbnail
* Editable object label
* Editable extracted text
* **Keep** / **Retake** / **Remove**

Show: **Here's what I found. Is it correct?**

Do not save or use uncertain information until the user confirms it.

### 4. Capture the emotion

After confirmation, ask: **How does this make you feel right now?**

Options: **Happy**, **Peaceful**, **Difficult**, **Surprising**.
Consider adding: Nostalgic, Excited, Unsure.

The user picks **one** emotion for that object moment.

### 5. Ask one personal question

The question depends on the selected emotion:

| Emotion | Example question |
|---|---|
| Happy | What made this moment feel good? |
| Peaceful | What would you like to remember about this feeling? |
| Difficult | What do you need right now? |
| Surprising | What was unexpected about this moment? |
| Nostalgic | What memory does this bring back? |

Answer by voice or keyboard. Show: **A few words are enough.**

Gemini must not generate the personal meaning without an answer from the user.

### 6. Save the moment

The completed object card contains: object cut-out, confirmed information, selected emotion,
user reflection, capture time.

Show: **Moment saved for today.**

Then offer: **Capture Another** / **Finish for Now** / **Create Today's Journal**.
The user can leave and return later.

### 7. Review today

**Review Today** shows all captured moments in chronological order. Each card shows: object,
emotion colour, short reflection, edit / remove controls.

Show: **These are the moments you captured today. Which ones belong in your journal?**

Allow selecting **one to five** moments.

### 8. Choose the overall feeling

Because several objects may carry different emotions, ask:
**Looking back, how would you describe today overall?**

The user picks the emotion that determines the daily sphere's colour. Do **not** auto-compute
it from the individual moments.

### 9. Generate the daily journal

Gemini uses **only**: confirmed labels + OCR, the selected object moments, per-object
emotions, user-written reflections, the overall daily emotion.

It generates: date, a short title, the selected object cut-outs, a **60–90-word** journal
paragraph, one final reflection.

It must not invent events, locations, relationships or emotions.

### 10. Review the journal

Display the journal as a spatial page surrounded by / connected to its object cut-outs.

Provide: **Edit** / **Make Shorter** / **Change Tone** / **Regenerate** / **Save**.
Regeneration keeps using only confirmed information.

### 11. Save the day

The journal page folds / transforms into one coloured sphere (colour = the overall emotion
selected for that day).

Offer: **Keep Private** / **Place in Space**.
If placed spatially, reopening it requires a deliberate gesture (e.g. pinch-and-hold).

### 12. Revisit the month

A reliable palm-up menu or button summons the monthly container (not a middle-finger+thumb
gesture). It holds one sphere per completed journal day. Users can:

* See the month's emotional pattern
* Select a sphere by date
* View its object previews
* Deliberately unlock the full journal entry
* Edit / move / export / delete it

---

## Data model — per moment (object card)

* Moment ID
* Capture time (ISO)
* Object cut-out (background-removed thumbnail) + raw still ref
* Confirmed object label
* Confirmed / kept OCR text
* Clearly-visible date text (confirmed) — optional
* Clearly-visible location text (confirmed) — optional
* Selected emotion (per moment) + emotion colour
* Personal reflection (user words, verbatim)
* Included-in-journal flag (set at Review Today)

## Data model — per day (journal entry / sphere)

* Entry ID
* Date
* Selected moment IDs (1–5)
* Overall daily emotion + sphere colour
* Generated title
* Generated journal paragraph (60–90 words)
* Final reflection
* Privacy: Private | Placed (+ optional anchor)

## MVP priorities (revised)

1. Home with Capture a Moment / Review Today
2. Capture still → Gemini object recognition + OCR + segmentation
3. Object card (cut-out, editable label/text, Keep / Retake / Remove, "Is it correct?")
4. Per-moment emotion pick
5. Per-moment emotion-specific reflective question (voice / keyboard)
6. Save the moment (Capture Another / Finish for Now / Create Today's Journal)
7. Review Today — list moments chronologically, select 1–5
8. Overall daily emotion pick
9. Generate one grounded daily journal (title + 60–90-word paragraph + final reflection)
10. Journal review actions (Make Shorter / Change Tone / Regenerate / Save)
11. Save day → coloured sphere → Keep Private / Place in Space
12. Monthly container (palm-up menu), open a sphere to its journal
13. Persistence between sessions

Deferred / not MVP: music search, custom middle-finger gesture, exact same-room spatial
persistence, multiple monthly containers, freely placing individual moment cards, advanced
journal text editing.
