# Trace Journal — Build Plan & Status

Incremental, testable build of the MVP (see `DESIGN.md` for the full spec).
Principle: de-risk external unknowns first, get one vertical slice working, then add breadth.
Every phase is runnable in the Lens Studio Preview and has a concrete exit check.

## Per-moment emotion + reflection (§4-§6) + segmentation attempt — 2026-09-04

The builder agent for this pass hit its session rate limit mid-run (`status: failed`, no
final report) — but its tool calls had already landed almost everything on disk before it
was cut off. Recovered/finished directly (no subagent) rather than re-spawning:

- **Part A — per-moment emotion + question (§4-§6): COMPLETE**, verified via BOTH the
  autopilot debug path and real `PreviewInteractTool` pinches. New: `MomentEmotionReflect.ts`
  (emotion pick: Happy/Peaceful/Difficult/Surprising/Nostalgic/Excited/Unsure → emotion-specific
  question, "A few words are enough" → Confirm/Try Again/Skip → "Moment saved for today." /
  Capture Another / Finish for Now / Create Today's Journal) and `ReflectionCapture.ts` (shared
  ASR + AR-keyboard helper, also used by `ReflectScreen`). `JournalSession.KeptTrace` gains
  `emotion` / `emotionColor` / `reflection` / `captureTimeMs`. Verified real-pinch: tapped
  **Peaceful** on the emotion panel → correct question ("What would you like to remember about
  this feeling?") rendered. Card + emotion panel + question panel are coplanar with the marker
  (same plane convention as the Phase-1 card).
- **Part B — segmentation cut-out: implemented, but blocked by the RSG request deadline in
  Preview.** `GeminiService.segmentPrimary()` sends the focused segmentation prompt (`box_2d`
  `[y0,x0,y1,x1]` @ 0-1000 + base64-PNG `mask` per the Gemini image-understanding docs), parses
  the JSON-array response, detects a polygon-shaped `mask` vs a real PNG, and
  `Base64.decodeTextureAsync`s the PNG. `MemoryCardSpawner` composites it via a new
  `Assets/Materials/UICutout.mat` (unlit, `ENABLE_BASE_TEX`+`ENABLE_OPACITY_TEX`, blend Normal)
  with a 3-tier fallback ladder (cutout → bbox crop → full frame), each tier logged and
  monotonic (a late response can't downgrade an already-upgraded thumbnail). **In this Preview
  environment `segmentPrimary` has never once returned successfully** — 3 separate test runs,
  each attempt (with a retry I added: `segmentPrimary` now retries once like the other calls)
  hit either `Code:4 Deadline Exceeded` (~30s, consistent — looks like a fixed RSG client-side
  request timeout, not exposed/configurable via the RSG TS API) or `Code:14 upstream connect
  error / connection termination`. `analyzeTrace` on the SAME image succeeds reliably in 5-8s,
  so this is specific to the heavier segmentation request, not RSG/token/network being down.
  **Every run correctly fell back to the bbox crop** — nothing is broken, the card always gets
  a reasonable thumbnail. Recreated `Assets/Materials/ImageMaterial.mat`, which the rate-limited
  agent's session had deleted without recreating it (3 scripts — `MemoryCardSpawner`,
  `FeelScreen`, the disabled `TraceJournalSpikeA_Capture` — reference it; this would have broken
  thumbnails/icons at runtime had it shipped missing).
  - Options if this is worth revisiting: test on-device (Preview's network path may differ);
    downscale the captured still specifically for the segmentation call (would need a
    render-to-texture downscale step — no runtime resize API exists — to shrink both the
    upload and the resulting mask); or accept the bbox crop as the shipped v2 §3 behaviour and
    move on (it already reads as "background-narrowed", which was itself a deliberate first
    step per the original v2 §3 handoff).

**Follow-up tried (2026-09-04): `thinkingConfig: { thinkingBudget: 0 }`.** Google's segmentation
guidance suggests skipping the model's reasoning step for this task. Added it to
`segmentPrimary`'s `generationConfig`, plus per-attempt timing logs. Result: **no change** — both
retry attempts still hit `Code:4 Deadline Exceeded` at **exactly 30.06s and 30.07s**, same as
without the flag. That precision (two runs, two different generationConfig payloads, both
~30.0s to the hundredth) is strong evidence this is a **fixed client-side transport deadline
baked into the RSG native package**, not a function of how long Gemini takes to think or
generate — the connection is cut at ~30s regardless of what's asked for. There is no
`@input`/request field that raises it; `thinkingBudget` was the only generationConfig lever
available and it made no measurable difference. **Not attempting further script-side fixes** —
downscaling the input (the remaining untried lever) only reduces generation/transfer time, and
a hard 30.0s wall that doesn't move when the request gets objectively lighter (0 thinking
tokens) suggests time-of-generation isn't what's being measured. Segmentation is parked; the
bbox crop is the shipped, reliable v2 §3 thumbnail behaviour. Worth re-checking only if a future
RSG package version exposes a longer/no deadline, or on-device testing shows different behaviour.

**Resolved (2026-09-04, later same day): switched from a base64-PNG mask to a polygon outline —
segmentation now works, well under the RSG deadline.** The "fixed 30.0s wall" theory above was
wrong about *what* it was fixed by — it tracks output TOKEN VOLUME, not wall-clock generation
time: a base64-PNG mask requires Gemini to emit thousands of output tokens, `thinkingBudget: 0`
only skips internal reasoning tokens (not the final output), so it never touched the actual
bottleneck. The user supplied the fix direction: ask Gemini for a segmentation **polygon**
(`mask: [[y1,x1],[y2,x2],...]`, 12-30 points) instead of a raster mask — a few dozen coordinate
pairs instead of an inline image. Rewrote the pipeline:
- `GeminiService.segmentPrimary` — new prompt matching the lighter contract exactly
  (`{label, box_2d, mask}` as a polygon outline, "12-30 points"); `SegmentResult.polygon`
  replaces the old `maskB64`; parsing switched to the existing object-shaped
  `lenientJsonParse` (the response is now a single JSON object, not an array-of-one).
- `TraceGizmos.triangulatePolygon` (new) — ear-clipping triangulation, CCW-normalized, with a
  fan fallback for anything it can't fully resolve.
- `TraceGizmos.makePolygonCutout` (new) — builds an actual cut-out **mesh** shaped like the
  polygon, with per-vertex UVs sampling the captured still directly. No mask texture, no
  `Base64.decodeTextureAsync`, no alpha compositing at all — the silhouette IS the geometry.
  `MemoryCardSpawner.applySegmentation` now calls this directly instead of building/binding a
  `UICutout.mat` opacity mask (that material and its `buildThumb` maskTex plumbing were removed).
- Result, live in Preview: `segmentPrimary` completed in **2.87s–4.02s** across 3 test runs
  (vs. the previous 30.0s timeout on every attempt) — confirms the token-volume theory.

**Two more bugs found and fixed during verification (both would have shipped a broken cutout
even though the request itself succeeded):**
1. **Mask points are `[y, x]`, not `[x, y]`.** The prompt template labels them "x1, y1", but a
   live response's mask coordinates only made sense against its own `box_2d` when read as
   `[y, x]` — the same order `box_2d` itself uses. Reading them as `[x, y]` silently produced a
   *valid-looking* polygon that was actually mirrored across the diagonal — visually a
   self-intersecting "bowtie" instead of the object's outline. Fixed in `parsePolygonMask`
   (`GeminiService.ts`) by swapping which index maps to which axis, with a comment recording why.
2. **Cutout mesh was invisible from the front** (screenshot came back solid black; only
   `viewAngle: "back"` showed the — at the time still-bowtied — geometry). Backface culling: the
   ear-clipping normalizes winding to CCW in image space, but the local-Y flip that maps
   image-down to local-up mirrors the triangles, so which side ends up "front" isn't reliably
   knowable in advance. Fixed by setting `mat.mainPass.twoSided = true` on the cutout's cloned
   material in `makePolygonCutout`, sidestepping winding entirely rather than chasing it by hand.

Verified end-to-end in Preview (screenshot): a real stool/chair capture produced a correctly
rounded cut-out silhouette on the Memory Card, buttons rendering normally (the shard artifacts
from bug #2 are gone). Debug flags used for this test (`CaptureController.autoCaptureAfterSec`,
`FlowManager.debugStartState`) reset to shipped values afterward; project saved.

Debug flags reset (recurring gotcha — **`MemoryCardSpawner.debugAutoKeepFirstCard`** was ON
from testing and silently auto-pressed Keep on the next real capture; it's now a fourth debug
flag on that component alongside `debugAutopilot`/`debugAutopilotRemove`/`debugSeedConfirm`/
`debugSeedWithDateLoc` — all OFF). `FlowManager.debugStartState="Launch"`,
`CaptureController.autoCaptureAfterSec=0`, `MomentEmotionReflect.debugAutopilot=false`.

**Next pass:** §7 Review Today — list moments chronologically (object, emotion colour, short
reflection, edit/remove), "Which ones belong in your journal?", select 1–5. Then §8 (overall
daily feeling, reusing `FeelScreen`'s pattern for the DAY level this time).

## §7 Review Today — ✅ DONE (2026-09-04)

New `ReviewScreen.ts` on the existing (previously empty) `Screens/ReviewRoot` object, wired as
its own dedicated `ScreenRouter.reviewRoot` input (was sitting unused in `otherRoots`). Lists
every kept moment — `JournalSession.keptTraces()` is already order-ascending, which **is**
chronological order, so no extra sort was needed — each row showing: frozen-still thumbnail,
label, a small colour swatch for the emotion picked at Keep-time (§4, reusing
`MomentEmotionReflect`'s swatch technique), capture time, a short reflection snippet, and
Include/Exclude · Change label · Remove controls. Heading: "These are the moments you captured
today. Which ones belong in your journal?" + a live "(N/5 selected)" count.

- **Data model**: `KeptTrace.includedInJournal` (new field, per DESIGN.md's data model line).
  `JournalSession.keep()` pre-selects the first 5 kept moments by default (a sane starting point
  most days won't exceed — still fully editable). New `setIncluded(order, included): boolean`
  enforces the 1–5 cap in one place (refuses to turn on a 6th, always allows turning off) —
  screens just reflect it. New `includedOrders()` query.
- **Discovered while wiring**: the "Review Today" (Home) and "Create Today's Journal"
  (`MomentEmotionReflect`'s §6 panel) buttons were both still stub-routed to `TraceScreen.Confirm`
  (a leftover from before the v2 restructure retired the old batch-confirm screen — see the v2
  restructure note above: "the batch 'confirm all kept traces' screen is replaced by Review
  Today"). Repointed both to `TraceScreen.Review`. `FeelScreen`'s Back button was still routed to
  `TraceScreen.Reflect` (also retired, folded into per-moment `MomentEmotionReflect`) — repointed
  to `TraceScreen.Review`, its actual predecessor in the v2 flow. Continue still goes to
  `Generate` (§9, not yet built).
- Verified in Preview: seeded 3 varied moments (`ReviewScreen.debugSeedMoments`, Preview-only,
  OFF by default) — screenshot confirms the header count, all three swatches/snippets/thumbnails
  render, buttons work. `debugAutopilot` (Preview-only) drove Continue with the default
  selection and confirmed the full **Review → Feel** transition: `FlowManager` log shows
  `Review -> Feel`, `FeelScreen` built cleanly, `ScreenRouter` shows `feel=true review=false`. Real
  hand-pinch interaction against the row buttons hit a Preview-only "Blocked by Collider"
  targeting quirk (same class of issue every other screen in this project works around with a
  `debugAutopilot` flag) — not pursued further since the autopilot path exercises the same
  production code.
- Also fixed a stray `FlowManager.debugStartState` value ("Lauchw" — an old fat-finger, unrelated
  to this pass) found while wiring; reset to "Launch". Debug flags used for this test reset to
  shipped values afterward; project saved.

**Next pass:** §8 Overall daily emotion pick is technically already reachable (`FeelScreen`
already writes `entry.feeling` / `entry.orbColor` at the day level and is now correctly wired
as Review's next step) — worth a real-data pass to confirm it end-to-end, then §9 Generate the
daily journal (Gemini call using only confirmed evidence + selected moments + emotions +
reflections, 60–90 words).

## Review Today thumbnails: background-removed, not raw still (2026-09-04)

User feedback: Review Today's row thumbnails were showing the raw full captured still
(`KeptTrace.thumb`) instead of the card's background-removed cut-out/crop — exactly the gap
flagged (but not yet fixed) in the original §7 pass's `buildThumb` comment.

Root cause: MemoryCardSpawner never stored WHICH crop rect or polygon was behind a card's
CURRENT thumbnail anywhere `JournalSession` could read — the crop/cutout is a live UV-scale or
mesh-cutout trick on the card's own SceneObject, not a baked texture, so there was nothing to
hand off. Fixed by tracking and mirroring that shape, rather than baking a new texture:

- `SpawnedCard` gains `thumbBox?` / `thumbPolygon?` — kept in sync with whichever tier
  (`THUMB_FRAME` < `THUMB_BBOX` < `THUMB_CUTOUT`) is CURRENTLY shown, set in `spawn()` and
  refreshed in `applySegmentation()`/`recropToBox()` on every tier upgrade.
- `JournalSession.keep()` gains two new trailing optional params (`box01`, `polygon01`),
  stored on the new `KeptTrace.thumbBox` / `.thumbPolygon` fields. New
  `updateThumbShape(order, box01?, polygon01?)` — a card can be Kept BEFORE segmentation
  resolves (this is the common case: segmentation is a separate ~3-4s Gemini call that keeps
  running after Keep hands off to the §4-§6 sub-flow), so `applySegmentation` calls this to
  reach an already-kept trace's shape too (same pattern as `relabel()` reaching a kept trace).
- `ReviewScreen.buildThumb` rewritten to replicate MemoryCardSpawner's own fallback ladder
  against the SAME frozen still (`KeptTrace.thumb`) instead of just showing it plain: polygon
  present -> `TraceGizmos.makePolygonCutout` (same triangulated mesh technique); else box
  present -> UV-cropped Image quad; else full frame. No new texture asset anywhere — same
  live-rendering trick, just reproduced from the mirrored shape data.
- Verified with a REAL capture (not the debug-seed shortcut, which has no thumb texture to
  crop): auto-capture -> analyzeTrace -> card spawns on the bbox tier -> auto-Keep fires
  **before** segmentation resolves -> `[Session] moment #1 thumb shape -> polygon(26pts)` log
  confirms the post-Keep sync path fired -> Review screenshot shows the actual chair-shaped
  cut-out, not a rectangle. This is the harder of the two timing orders (Keep-before-segment);
  the reverse order (segment-before-Keep, captured straight into `keep()`'s own params) is the
  simpler path and follows the same code.
- Along the way, extended `MomentEmotionReflect`'s `debugAutopilot` with a 5th step that drives
  Create Today's Journal itself (previously stopped at the "Moment saved" panel) — matches every
  other screen's autopilot convention of completing its own primary action, and was needed
  because real `PreviewInteractTool` taps against these panels hit the same "Blocked by
  Collider" Preview-only quirk noted in the §7 entry above.

Debug flags reset to shipped values; project saved.

## §8 Overall daily emotion + §9 Generate the daily journal (2026-09-04)

**§8 was already built** (`FeelScreen.ts`, from the earlier Phase 0 spine work) — it already
wrote `entry.feeling`/`entry.orbColor` at the DAY level, separate from any per-moment emotion,
exactly per spec. It just needed pointing at the right neighbours after the v2 restructure moved
Review Today in front of it: fixed copy to the spec's exact prompt ("Looking back, how would you
describe today overall?", was the v1-era "Today felt…"), fixed Back to go to `Review` (was the
retired `Reflect`), and refreshed the doc comment's phase numbering (v1 §6/§10 → v2 §8/§11).
Verified live: autopilot picks Peaceful, `entry.feeling`/`orbColor` written correctly, Continue
reaches Generate.

**§9 is new** — `GenerateScreen.ts` on the existing (previously empty) `GenerateRoot`, wired as
its own dedicated `ScreenRouter.generateRoot` input. Auto-fires `GeminiService.generateJournal()`
on entering the screen (Review Today + Feel already made every choice this call needs) and shows
a title + 60-90-word paragraph + one final reflection, with Continue (§11, not yet built) / Back
(§8) / Try Again on failure.

- **`GeminiService.generateJournal` rewritten for the v2 data shape.** It was still v1-shaped —
  a single day-level `reflection`/`feeling` string pair — which doesn't exist anymore now that
  reflection+emotion are per-moment (§4-§5). New `JournalGenInput.moments: JournalMomentInput[]`
  (label/ocrText/emotion/reflection per selected moment) + `dayFeeling` (the one §8 value).
  Prompt rewritten to match: "Using ONLY this evidence... never invent objects, events,
  locations, relationships, or emotions that are not present" + paragraph spec tightened to the
  literal 60-90 words DESIGN.md asks for (was "2-4 sentences").
- **Only the SELECTED moments are ever sent.** `GenerateScreen.selectedMoments()` reads
  `journalSession.keptTraces().filter(t => t.includedInJournal)` — the §7 Review Today flag —
  never the full kept list. Confirmed OCR fragments win over the raw OCR blob when present.
- **`JournalEntry` gained a `title` field** — DESIGN.md §9 explicitly asks Gemini to generate
  "a short title", but the data model had nowhere to put it (`generatedJournalText` was
  paragraph-only). Threaded through `toData()`/`fromData()` for persistence.
- **`FlowManager.SCREEN_ORDER` reordered** to match the real v2 path (`Launch → Scan → Card →
  Review → Feel → Generate → Orb → Jar`, with the retired `Confirm`/`Reflect` parked at the
  end) — cosmetic (nothing currently calls `next()`/`prev()`), fixed while in the area.
- **Bug found + fixed during verification: a long paragraph rendered completely blank.** The
  paragraph Text object held the correct ~80-word string with every property set as intended
  (confirmed via a live scene query — text, color, `sizeToFit`, `horizontalOverflow: Wrap`,
  `verticalOverflow: Shrink` all correct) but nothing drew. This is PanelKit's own title/body
  technique (`sizeToFit` + `VerticalOverflow.Shrink` + a `layoutRect`) — solid for the SHORT
  one/two-line labels it's used for everywhere else in this codebase, but empirically breaks on
  a many-wrapped-line paragraph (worth flagging if this shrink-to-fit combo is ever reused for
  another long block of text). Fixed by switching to a plain fixed-size `Wrap` +
  `VerticalOverflow.Overflow` (no `sizeToFit`) — the standard, predictable text-wrapping path,
  sized generously enough that a 60-90-word paragraph fits without needing to shrink at all.
- Verified live, twice, with real Gemini calls end-to-end from a fresh capture: 12.31s / 9.33s
  response times, 77 / 76-word paragraphs (both inside the 60-90-word spec), titles "A Quiet
  Moment at the Table" / "A Peaceful Moment of Stillness". Second run's result screenshotted
  post-fix — title, full paragraph, and final reflection all render correctly, Continue/Back
  present. `FeelScreen` → `GenerateScreen` → (§11 Orb, not yet built) confirmed via
  `debugAutopilot` on both screens (new `GenerateScreen.debugAutopilot`, OFF by default, taps
  Continue automatically once generation succeeds).

Debug flags reset to shipped values; project saved.

## §10 Review the journal + §11 Save the day (2026-09-04)

**§10** lives behind a new **"Revise"** chooser on `GenerateScreen`'s result panel (matches
MemoryCardSpawner's label-editor pattern) rather than five big buttons crammed onto one panel:
- **Edit the words** — dictate/type a full replacement paragraph via the shared
  `ReflectionCapture` helper (same ASR + AR-keyboard plumbing as §5/§9's "Edit" needs, no
  duplicated transcription code). Verbatim, no Gemini call — matches §5's "the user's own words"
  principle.
- **Make Shorter** (toggle) / **Change Tone** (4-way cycle: Default/Warmer/Plainer/Reflective) —
  each sets a `styleHint` and regenerates. `GeminiService.generateJournal` gained this optional
  field, sent as its OWN instruction part (not folded into the evidence blob) so a style note can
  only change HOW it's written, never invent WHAT it's about.
- **Regenerate** — fresh generation, same evidence + whatever style notes are currently active.
- **Save** advances to §11.

**§11** is new — `OrbScreen.ts` on the existing (previously empty) `OrbRoot`, wired as its own
dedicated `ScreenRouter.orbRoot` input. Folds the entry into a real coloured sphere
(`MarkerSphereMesh.mesh` + a tinted clone of `MarkerWhite.mat`, colour = `entry.orbColor` from
§8) with a pop-in scale tween, then
**Keep Private** (destroys the sphere — tucked away) or **Place in Space** (sphere stays
visible). Either way the entry persists to `global.persistentStorageSystem.store` as a small
JSON array under one key (`traceJournal.days`) — the multi-day extension of
`TraceJournalSpikeD_Persistence`'s single-entry proof, ready for §12's monthly container to read
later. Real spatial anchoring (surviving a Lens restart in the same physical spot) is explicitly
out of MVP scope per DESIGN.md ("exact same-room spatial persistence") — Placed currently just
means the sphere stays visible for the rest of the session.

- **`JournalEntry` gained `privacy` and `selectedMomentIds`** — both explicitly named in the
  data model but missing from the class until now.
- **Bug found and fixed while wiring "Place in Space": the sphere would have vanished on Done.**
  `OrbScreen`'s own SceneObject IS the toggled `OrbRoot` — `ScreenRouter` disables it the instant
  the user leaves the screen, so anything parented under it (including a "Placed" sphere meant
  to stay visible) would disappear too. Fixed by reparenting a Placed sphere to a new always-on
  `OrbSpawner` object (sibling of `CardSpawner`/`JournalSession` under `TraceJournal`) right
  before `saveDay()` returns, and clearing the script's own `this.sphere` reference so a later
  visit's teardown can't reach in and destroy an already-externally-owned sphere.
- Verified fully live, twice: **Run 1 (Keep Private)** — real capture through Review→Feel→
  Generate→§10's Make Shorter regenerate (styleHint correctly threaded to Gemini, confirmed in
  logs) →Save→Orb→Keep Private→Done→Home, zero errors, `persisted — 1 day(s) total in store`.
  **Run 2 (Place in Space)**, same chain — `persisted — 2 day(s) total in store`,
  `sphere reparented to "OrbSpawner"`, and — the actual proof — a post-run
  `QueryRuntimeSceneTool` query for the sphere AFTER returning to Home found it alive and
  enabled under `OrbSpawner`; screenshotted showing a correctly-coloured (`#5B8DEF`, "peaceful")
  sphere.

Debug flags reset to shipped values; project saved.

## UI polish: text outline, adjustable theme, button overlap (2026-09-04)

User feedback, three asks: remove the black text outline, make the UI's look tunable in the
Inspector, and fix buttons reading as overlapping.

- **`UITheme.ts` rewritten** from a single `backgroundOpacity` knob into the whole wireframe
  UI's Inspector panel: title/body/button-label text size, text colour, text outline
  enabled/colour/width, panel + button frame thickness, panel + button corner roundedness, and
  a new `buttonForwardCm`. Background opacity stays LIVE (already-built panels update while
  dragging, via the existing registered-materials mechanism); everything else is read once per
  panel build (documented plainly in the file header) — changing PanelKit's build-time geometry
  live on already-built panels would need re-triangulating every rounded-rect mesh and
  re-flowing every Text's Wrap/Shrink layout on every existing panel, far more invasive for
  little gain over "change the slider, re-enter the screen." `PanelKit.ts` now reads every one
  of these from `UITheme` instead of its own hardcoded constants; `GenerateScreen.addFreeText`
  (the one text builder outside PanelKit, for the journal paragraph) reads the outline settings
  too. Per-instance recolours that already existed — a kept card's green outline, emotion
  swatches, a dimmed button — are separate imperative calls made AFTER construction and are
  untouched by any of this.
- **Text outline now OFF by default** (`textOutlineEnabled: false`, was unconditionally on
  everywhere) — directly fixes the "black outline" complaint; still there as an Inspector option
  for anyone who wants it back.
- **`buttonForwardCm` (default 0.5cm)** added to every button's local-Z placement in
  `PanelKit`'s `relayout()`, addressing "buttons read as overlapping the panel."
- **Two real bugs found and fixed while verifying**, both on `GenerateScreen`'s result panel
  specifically (screenshot showed the actual problem clearly, which the "move buttons forward"
  request was really pointing at):
  1. **The final reflection text landed directly on top of the Save button.** Its Y position was
     a fixed fraction of a guessed panel height, computed independently of where the button
     stack actually starts — correct with 2 buttons (Continue/Back, §9's original build), but
     never recomputed when §10 added a 3rd (Revise), which shifted the button stack up and put
     it right where the reflection text already sat. Fixed by replacing the fixed-fraction
     layout with the same explicit header/content/footer budget math ConfirmScreen and
     ReviewScreen already use — computed panel height, not guessed.
  2. **The done panel's title was stuck reading "Composing your day .."** — the loading panel's
     animated-ellipsis flag (`ellipsisActive`) was only ever cleared in the `OnDisableEvent`
     teardown, not when swapping from the loading panel to the done/error panel, so
     `onUpdate()` kept calling `.setTitle(loadingText + "...")` on the NEW panel every frame
     forever. Fixed by clearing the flag in the shared `destroyPanel()` every other panel-builder
     already calls first.
- Verified live: re-screenshotted the Generate result panel (3 moments, real Gemini generation)
  — crisp text with no outline, title reads correctly, Save/Revise/Back sit with clear
  separation from the paragraph and final reflection above them. Also re-screenshotted
  Review Today's moment panels — same crisp-text improvement, no button issues found there
  (the two real bugs were specific to Generate's custom free-text layout, not PanelKit itself).

Debug flags reset to shipped values; project saved.

## ⚠️ Design v2 restructure (2026-09-04)

`DESIGN.md` was rewritten (v1 archived to `DESIGN_v1.md`). Big shifts:

- **Emotion + reflection are now PER-MOMENT**, captured right after the object card — not
  once per day at the end. Each moment card holds: cut-out, confirmed label/OCR, one
  emotion, one reflection, capture time.
- **Capture is split from journal composition.** Home has **Capture a Moment** and
  **Review Today** (disabled when 0 moments). A user can capture one moment and leave.
- **One object is enough** — no "collect 1–5 to proceed" gate at capture time. The 1–5
  selection happens later, at **Review Today**.
- **Overall daily emotion** is picked explicitly at Review Today (not computed from moments)
  and sets the sphere colour.
- **Music / §7 song: dropped from MVP.**
- Object cards show a **background-removed cut-out** (Gemini segmentation, or a bbox crop as
  a first step).
- Save the day → sphere → **Keep Private** (default) / **Place in Space**.

Impact on already-built phases:
- **Phase 1** — revise now (see "Phase 1 v2 revision" below): Launch → **Home**; capture
  copy; card buttons **Keep / Retake / Remove**; editable label/text; cut-out thumbnail.
- **Phase 2** (`JournalSession`, multi-capture branching) — the "Add Another Trace / Create
  Today's Journal" panel becomes the **"Moment saved"** panel (Capture Another / Finish for
  Now / Create Today's Journal). Multi-select moves to Review Today. Needs rework.
- **Phase 3** (`ConfirmScreen`) — the per-trace confirm UI now lives on the single object
  card (§3) + folds into a per-moment flow; the batch "confirm all kept traces" screen is
  replaced by **Review Today** (§7). Needs rework.
- **Phase 4** (`ReflectScreen`, `FeelScreen`) — reflection + feeling become **per-moment**
  (§4–§5), emotion-specific questions; a separate **overall daily feeling** screen (§8) is
  new. Existing screens are reusable but re-sequenced. Needs rework.
- Phases 5+ (generation, orb, jar, persistence) — mostly intact, re-pointed at the new data
  model (per-moment records → one daily entry → one sphere).

### Phase 1 v2 revision — ✅ DONE (2026-09-04) — sections 1–3 only

Small, scoped pass. **Sections 4+ (per-moment emotion, reflection, Review Today, overall
feeling, privacy, monthly menu) were NOT touched. Phases 2–4 screens/wiring untouched.**

- **Launch → Home** (`LaunchScreen.ts`, still on FlowManager state `Launch`, still on
  `Screens/LaunchRoot` — no new enum value). Panel is now a heading + two actions:
  **Capture a Moment** (`captureHint` "Notice something meaningful around you." → `goTo(Scan)`)
  and **Review Today** (`reviewHint` "Turn today's moments into a journal entry." →
  `goTo(Confirm)` + log — Confirm/Review is reworked later). Review Today is **dimmed +
  inert while `JournalSession.keptCount() === 0`**; the panel rebuilds on
  `JournalSession.onKeptChanged` so it unlocks after the first Keep. "Open Memory Jar"
  button dropped (monthly container → palm-up menu, §12). New `@input journalSession`
  (wired → JournalSession) + OFF-by-default `@input debugSeedMoment` (Preview: seed one
  kept moment so the enabled state is screenshot-able). Panel grew 46×30 → 46×46 to stop
  the title/body/button overlap.
- **Capture copy** (`ScanScreen.ts`) — `promptText` → **"Hold still while I capture this
  moment."** Set as the code default AND on the scene component
  (`9cc5e92b-…` via VirtualScene modify / `scene-graphql` — stale-value trap).
- **Object card** (`MemoryCardSpawner.ts`):
  - Card buttons are now **Keep / Retake / Remove** (was Keep / Remove / Change Label).
    Retake = discard THIS card (destroy card + marker + line, splice, unkeep if kept) →
    `goTo(Scan)` (the old `scanAgain` logic, renamed `onRetake`; the chooser's "Scan Again"
    entry was removed).
  - **"Here's what I found. Is it correct?"** shown as the card body (`@input confirmPrompt`);
    replaced with `keptNote` ("Kept for today.") on Keep.
  - **Editable label** — the card **title is tappable** (new `PanelKit.setTitleTappable()` —
    invisible UIKit Button over the title band + a "✎" affordance) and opens the existing
    alt-labels chooser (altLabels + "Something Else" categories). No keyboard.
  - **Extracted-text line** clearly labelled (`@input ocrCaption` "Extracted text:"; "none
    found" when empty). No keyboard editor (later pass).
  - Thumbnail moved down (y 18 → 11, OCR y 6 → 2) to clear the new body line.
- **Background-removed cut-out — first step only** (`GeminiService.ts` + `MemoryCardSpawner`):
  `analyzeTrace` prompt + `TraceResult` now also return a tight normalized
  `box {x,y,w,h}` (0..1, top-left origin) or `undefined` (`parseBox()` clamps / rejects
  degenerate / whole-frame boxes). `MemoryCardSpawner.addThumbnail(panel, thumb, box)`
  crops the thumbnail to that box via the ImageMaterial's `baseTexUvScale` /
  `baseTexUvOffset` (V flipped) and matches the quad aspect to the crop. **Verified working
  in Preview** — Gemini returned `box 0.00,0.32 0.69x0.68` and the card showed a cropped
  framing. If a future material lacks the UV uniforms it logs
  `// TODO(v2): segmentation mask` and ships the full frame. Not a real mask — the hook for
  one later.
- **New PanelKit capability**: `addButton(label, cb, { dim })` greys a button's frame +
  label to read as unavailable; `setTitleTappable(cb)`.

Verified in Preview (no synthetic hand tool in this env — used OFF-by-default debug inputs,
consistent with the other screens): Home 0-moments shows Capture a Moment + a **dimmed**
Review Today; `debugSeedMoment` → `[Home] built — moments=1 reviewEnabled=true` and Review
Today renders bright; auto-capture → Gemini (`label="beige chair"`) → object card shows
"Here's what I found. Is it correct?" + Keep / Retake / Remove + "✎" title affordance +
cropped thumbnail; `Scan → Card`. Recompile clean, RunAndCollectLogs clean (only the known
transient `E [AudioOutput] … Sink Writer` reset noise). All debug flags reset to shipped
values (`FlowManager.debugStartState="Launch"`, `CaptureController.autoCaptureAfterSec=0`,
`LaunchScreen.debugSeedMoment=false`, `MemoryCardSpawner.debugAutopilot*`/`debugSeed*`=false,
`UITheme.backgroundOpacity=0.4` untouched). Project saved.

**Next small pass — per-moment emotion + reflection right after Keep (DESIGN.md §4–§5).**
After Keep on the object card: ask **"How does this make you feel right now?"** (Happy /
Peaceful / Difficult / Surprising [+ maybe Nostalgic / Excited / Unsure], single pick per
moment), then **one emotion-specific reflective question** (§5 table) answered by voice or
keyboard ("A few words are enough."). Store `emotion` + `reflection` **per KeptTrace**, not
per day — this needs `JournalSession.KeptTrace` to gain `emotion` / `reflection` fields and
a small per-moment flow (reuse `FeelScreen` / `ReflectScreen` logic, re-sequenced). Do NOT
build §6 ("Moment saved" panel) or §7 (Review Today list) in that pass.

## Architecture spine (built in Phase 0)

| Module | Responsibility |
|---|---|
| `Assets/Scripts/FlowManager.ts` | Screen state machine: Launch → Scan → Card → Confirm → Reflect → Feel → Generate → Review → Orb → Jar. `goTo(state)`, `next()/prev()`, `onScreenChanged` event, `debugStartState` input. |
| `Assets/Scripts/JournalEntry.ts` | Data model for spec §13 + `toJSON()/fromJSON()`, `monthKey()`. No scene access. |
| `Assets/Scripts/GeminiService.ts` | RSG wrapper. `analyzeTrace(Texture)` → `{label,confidence,text,date?,location?,altLabels[]}`; `generateJournal(payload)` → `{title,paragraph,finalReflection}`. Centralised prompts, lenient JSON parse + 1 retry, typed errors (Unrecognized / LowOcr / NetworkFail / GenFail). |
| `Assets/Scripts/PanelKit.ts` | Helper over SpectaclesUIKit: titled world-space panel + button row. `PanelKit.create(parent, opts)`. |

## Phase status

| Phase | Priorities | Status |
|---|---|---|
| **0 — Foundation & de-risking spikes** | — | ✅ **complete** (2026-09-03) |
| **1 — Vertical slice: capture → analyze → Memory Card** | 1, 2, 3 | ✅ **complete** (2026-09-04, +3 fix rounds & UI restyle) |
| **2 — Card actions & multi-capture** | 4 | ✅ **complete** (2026-09-04) |
| **3 — Evidence confirmation** | 5 | ✅ **complete** (2026-09-04) |
| **4 — Reflection & feeling** | 6, 7 | ✅ **complete** (2026-09-04) — §7 song deferred (optional) |
| 5 — Journal page generation | 8 | not started |
| 6 — Memory Orb transformation | 9 | not started |
| 7 — Memory Jar & orb viewing | 10, 11 | not started |
| 8 — Persistence & launch logic | 12 | not started |
| 9 — Error/fallback states & polish | §14 | not started |

---

## Phase 0 — Foundation & de-risking spikes ✅

**Packages installed:** RemoteServiceGateway@2.0.1, SnapDecorators@2.0.0, Utilities@2.0.0
(SIK 2.0.0 / UIKit 2.0.0 already present). RSG tokens generated + wired.

**Scripts:** `JournalEntry.ts`, `FlowManager.ts`, `GeminiService.ts`, `PanelKit.ts`,
`TraceJournalSpikeA_Capture.ts`, `TraceJournalSpikeB_Vision.ts`,
`TraceJournalSpikeD_Persistence.ts`, `TraceJournalSpikeE_Reflection.ts`.

**Scene:** `TraceJournal` root with `FlowManager`, `GeminiService`, `SpikeA` (+ `SpikeA_Marker`,
`SpikeA_Audio`), `SpikeB`, `SpikeD`, `SpikeE`.
**Assets:** `Assets/Materials/ImageMaterial.mat`, `MarkerSphereMesh`, `MarkerWhite`.

### Exit checks

| Spike | Result |
|---|---|
| 0.1 Scene + package foundation | ✅ pass |
| 0.2 Architecture spine (4 modules compile + init clean) | ✅ pass |
| 0.3 Spike A — pinch capture + marker | ✅ pass (capture SFX deferred — no Node.js) |
| 0.4 Spike B — Gemini Flash vision round-trip | ✅ pass — reliable JSON; **~23 s latency**; OCR quality high |
| 0.5 Spike D — persistence round-trip | ✅ pass — survived 13 Preview restarts |
| 0.6 Spike E — ASR reflection capture | ⚠️ wired; ASR is device-only, AR-keyboard fallback wired |

### Key findings (carry into Phase 1)

- **Gemini 2.5 Flash image + JSON latency ≈ 23 s.** Needs a real loading state in the Scan
  flow, and investigation: try `gemini-2.0-flash`, smaller capture resolution, or dropping
  `responseMimeType: application/json`.
- **Gemini OCR quality is high** (transcribed a dense Morse-code chart verbatim).
- **Preview has no depth** → `WorldQueryModule` marker uses a camera-forward fallback in
  Preview; real surface hits + normals only work on device.
- **ASR transcription is device-only** — not verifiable in plain Preview.
- **RSG tokens have ~1 h TTL** at edit time and are edit-time only; a published Lens needs
  its own RSG auth flow.
- **Fix applied (2026-09-03):** `GeminiService.analyzeTrace` no longer throws `LowOcr` when a
  trace has little/no text — OCR text is optional (spec: "if present"). It now returns a
  valid result with a soft `ocrUncertain` flag instead. In Preview the virtual camera sees
  no text, so every capture was hitting the old `LowOcr` throw and Spike B (log-only) showed
  nothing on screen → looked frozen. Phase 1's Scan/Card screen provides the visible feedback.

### Outstanding manual steps

1. **RSG token refresh** (recurring, ~1 h): Window → Remote Service Gateway Token → Generate (all three) → Ctrl+S.
2. **Capture sound:** install Node.js then re-run `/build-sfx`, or drop a short WAV on `TraceJournal/SpikeA/SpikeA_Audio` → AudioComponent → Audio Track.
3. **Spike E on device:** test hold-to-talk; if unreliable set `TraceJournal/SpikeE` → `forceKeyboard = true`.
4. **Spike A on device:** validates real `requestImage` still + `WorldQueryModule` surface hit.
5. Do not disable the `RemoteServiceGatewayExamples` root — its `RemoteServiceGatewayCredentials` child publishes tokens each session. (Sample panels already disabled.)

---

## Phase 1 — vertical slice ✅ (2026-09-03)

Working in Preview: start on Launch → **Create Today's Entry** → Scan screen (prompt +
head-locked cyan capture frame) → pinch/tap → frozen still + white marker → animated
"Finding the memory in this trace…" loading panel → real Gemini result → spatial Memory
Card (thumbnail, object label, "No text found" / OCR text, Keep/Remove/Change Label row)
+ white marker sphere + white line marker→card. Cap of 5 traces. `NetworkFail` /
`Unrecognized` show a one-panel error with **Try Again** that re-sends the same still.

### New scripts (all `Assets/Scripts/`)

| Script | Role |
|---|---|
| `ScreenRouter.ts` | `@component` — the ONLY place `FlowManager.onScreenChanged` becomes `.enabled` flips. Launch/Scan roots + 7 empty placeholder roots (Confirm…Jar). |
| `LaunchScreen.ts` | `@component` — welcome PanelKit panel; **Create Today's Entry** → `goTo(Scan)`, **Open Memory Jar** → logs "Phase 7". |
| `CaptureController.ts` | `@component` — promoted Spike A. Pinch (device) / Tap (editor) → device `requestImage` still (640×480 default) or Preview live-stream → `ProceduralTextureProvider.createFromTexture` freeze → centre marker point (WorldQuery hit / camera-forward fallback). Emits `onCapture: Event<CaptureResult>`. Debounce + busy guard. `autoCaptureAfterSec` debug hook. |
| `ScanScreen.ts` | `@component` — Scan view (prompt / loading / error panels) + capture→Gemini→Card orchestration. `inFlight` guard, animated ellipsis, trace cap, `debugLatencyProbe`. |
| `MemoryCardSpawner.ts` | `@component` — builds the spatial Memory Card (PanelKit + thumbnail `Component.Image` + muted OCR line + 3 stub buttons), white marker sphere, white marker→card line. Records scan order internally (never displayed). |
| `TraceGizmos.ts` | plain module — `makeReticle` (MeshBuilder line-loop), `makeGlowLine` (stretched marker sphere), `makeMarker`. Mesh/material passed in from `@input` (requireAsset can't resolve `Assets/`-root files). |

Edited `GeminiService.ts`: `analyzeTrace(tex, opts?: {model?, jsonMime?})` — optional per-call
model + JSON-mime override for the latency probe. Default behaviour unchanged.

### Scene changes

- `TraceJournal/Screens/` group with `LaunchRoot`, `ScanRoot` (+ child `Capture`),
  `ConfirmRoot`…`JarRoot` (empty placeholders). `TraceJournal/CardSpawner`,
  `TraceJournal/ScreenRouter`.
- **Spikes A/B/D/E SceneObjects disabled** — their logic is now promoted into real modules.
- **`RemoteServiceGatewayExamples → Guide_ReadAndDisable` disabled** — big blue guide panel
  was rendering in the middle of the view. RSG root + `RemoteServiceGatewayCredentials`
  left enabled (still publishes tokens).

### Gemini latency (Preview, 1392×1590 still)

| Model | JSON mime | Result |
|---|---|---|
| `gemini-2.0-flash` | on / off | **404 NOT_FOUND** — not accessible on this RSG project (~1.5 s to fail) |
| `gemini-2.5-flash` | on | 5–18 s (14.5 s median across runs) ✅ |
| `gemini-2.5-flash` | off (no `application/json`) | 15.6 s — **not faster**, kept mime on |

**Superseded — see "Model probe" below.** (Original Phase 1 choice was `gemini-2.5-flash`.)

### Model probe (2026-09-03, RSG on this project) — which Gemini model IDs work

Ran `ScanScreen.runLatencyProbe` against a single frozen preview still:

| Model ID | Available? | Latency | Notes |
|---|---|---|---|
| `gemini-3-flash-preview` | ✅ | **~4.8 s** | fastest working full model; sensible label — **now the default** |
| `gemini-2.5-flash-lite` | ✅ | ~1.8 s | fastest overall but "lite" → weaker at fine object ID (the mismatch complaint) |
| `gemini-2.5-flash` | ✅ | ~14 s (one 37 s outlier w/ transport retry) | previous default |
| `gemini-2.5-pro` | ✅ | ~12 s | most capable; not worth the latency here |
| `gemini-flash-latest` | ✅ | ~5.5 s | alias, currently 2.5-flash-class |
| `gemini-2.0-flash` | ❌ 404 | — | not enabled on this RSG project |
| `gemini-3-pro-preview` | ❌ 404 | — | not enabled on this RSG project |

**There is no "Gemini 3.5 Flash".** Gemini 3 Flash exists as `gemini-3-flash-preview` and it
works here. `GeminiService.model` default → **`gemini-3-flash-preview`** (was `gemini-2.5-flash`):
~3× faster and better labels. It's a *preview* model — the ID may change; fall back to
`gemini-2.5-flash` if it starts 404ing. `responseMimeType: application/json` kept on
(dropping it was slower in the Phase 1 test).

### Object/label mismatch — ROOT CAUSE FOUND & FIXED (2026-09-03)

User: "second time I scanned the speaker, but it said turntable still — and the captured
image showed the first image, totally same."

**The second capture was re-freezing the FIRST frame.** `CaptureController.getLiveCameraTexture()`
requested the camera, waited for one `onNewFrame`, then **removed its frame listener** and
cached the texture. With no active listener the camera provider stopped delivering frames,
so `ProceduralTextureProvider.createFromTexture()` kept copying the stale first frame — every
capture after the first produced an identical image → identical Gemini label.

Fix:
- `ensureCameraStream()` starts the camera once and keeps a **permanent** `onNewFrame`
  listener (increments `camFrameCount`) so the stream stays live.
- `getLiveCameraTexture()` now waits for a **fresh** `onNewFrame` on each capture (0.5 s
  timeout fallback) before returning, so `freeze()` copies current content.
- Camera stream is warmed in `onStart`. `[Capture] complete … camFrame=N` logs the frame
  counter for verification.

Verified in Preview: capture 1 (camFrame=55) → "turntable"; moved the preview camera; capture
2 (camFrame=364 — stream advancing) → "blank image" conf=1. Two captures, two different
frames, two different labels. Before the fix, capture 2 would have said "turntable" again.

Remaining (genuine model uncertainty, not a bug): on an ambiguous image Gemini still guesses.
`gemini-3-flash-preview` (now default) helps; Phase 2's **Change Label** (shows `altLabels`
+ "Something Else") is the designed correction path; consider surfacing `result.confidence`.

### Deferred to Phase 2 (card actions + multi-capture branching)

- Keep / Remove / Change Label are `console.log` stubs → wire to a live `JournalEntry`;
  Change Label shows `result.altLabels`.
- "Add Another Trace / Create Today's Journal" branching after the first kept card
  (Phase 1 just caps at 5 with a logged message).
- PanelKit polish: typography roles, billboard-to-user, tidy flex layout for the card
  (thumbnail + OCR line are currently hand-placed below PanelKit's flex band). Dark
  BackPlate on the near-black Preview background is low-contrast — fine with passthrough.
- Evidence confirmation screen = Phase 3; JournalStore = Phase 8.

### Phase 1 fixes (2026-09-03, post first device/preview test)

Reported: (1) second scan showed the first object's label; (2) card not next to the
object, connecting line looked like a stretched blob.

- **`ScanScreen`** — the hard `inFlight` gate silently dropped any pinch made while a
  5–18 s Gemini call was running, so the first object's late result looked like a stale
  label for the second scan. Replaced with an `activeCount` + `maxConcurrent = 3` model:
  captures now analyse concurrently, each `.then` closes over its own frozen still + marker,
  loading panel shows "Finding the memory in N traces…", `maxTraces` counts spawned +
  in-flight. Verified in Preview: two captures → `MemoryCard #1` and `#2`, no "ignoring
  capture" drop, zero runtime errors.
- **`CaptureController.computeMarkerPos`** — was reading the `WorldQueryModule` hit-test
  result synchronously; that callback is async, so on device it *always* fell back to a
  fixed 90 cm camera-forward point (marker never on the real object → card misplaced). Now
  returns a `Promise<vec3>` that waits for the hit callback, with an explicit-miss branch
  and a 0.25 s timeout → fallback (Preview has no depth). Capture now awaits it.
- **`TraceGizmos.makeGlowLine`** — was a sphere mesh scaled long/thin (an ellipsoid
  lozenge). Replaced with a MeshBuilder unit cube tinted with the marker material; `.set`
  spans it as a straight bar. Signature changed to `makeGlowLine(parent, baseMat, color?, w?)`.
- **`MemoryCardSpawner`** — card now billboards to the camera at spawn
  (`quat.lookAt(camPos - cardPos, up)`) instead of keeping a world-fixed facing.
- **`GeminiService`** (from the earlier Phase 0 follow-up) — `analyzeTrace` no longer throws
  `LowOcr` on empty/short OCR; returns a valid result + soft `ocrUncertain` flag.

### Phase 1 fixes, round 2 (2026-09-03 — "can't scan anything")

Root cause: stuck on the Launch screen. Capture only runs on the Scan screen (`ScanRoot`
disabled elsewhere), and the "Create Today's Entry" button was hard to hit.

- **`PanelKit` button layout** — buttons were sized by label length with no fit
  constraint, so "Create Today's Entry" (26 cm) and "Open Memory Jar" (26 cm) *overlapped*
  and clipped the panel edge. Now every button gets an equal share of the row width
  (`relayoutButtons()` on each add) → N buttons always fit, no overlap. Verified: the two
  Launch buttons now sit symmetric at x=±12.2, ~22.8 cm each, 1.6 cm gap.
- **`PanelKit` contrast** — `BackPlate` style `"dark"` → `"simple"` (flat solid grey, no
  gradient); the panel was near-invisible on the dark Preview backdrop. Body/title text now
  gets an explicit white fill + black outline for legibility across light/dark.
- **`CaptureController` watchdog** — a 5 s `DelayedCallbackEvent` clears the `busy` flag if
  the capture chain never settles, so a stalled frame-grab / marker-resolve can't lock the
  user out of scanning entirely.

Verified end-to-end in Preview: Launch button → Scan → tap → `[Capture] complete` →
`analyzeTrace OK` → `MemoryCard #1 spawned` → `Scan -> Card`, zero runtime errors.

**Preview interaction note:** the Launch/Card/error buttons are SIK `Button`s — clicking
them in the Preview panel needs the mouse to land on the (now visible, non-overlapping)
button. To skip the Launch screen while iterating, set `FlowManager.debugStartState` to
`"Scan"`.

### UI restyle — wireframe (2026-09-03)

User asked for: white outline instead of the translucent grey window, outlines on
button boundaries too, fully transparent interior, connector line landing on the panel
outline (not its back/centre), smaller panels, larger labels, less dead space.

- **New asset** `Assets/Materials/UILine.mat` — unlit, white, `twoSided`. Shared base for
  every outline.
- **`TraceGizmos.makeRectFrame(parent, baseMat, opts)`** — a constant-thickness rectangular
  border (triangulated ring, 8 verts) with a fully transparent interior. `.resize(w,h)`
  rebuilds the mesh so the bar width stays uniform; `.halfW`/`.halfH` expose extents.
- **`PanelKit`** — dropped `BackPlate`. Surface is now `makeRectFrame` (white outline, no
  fill). Buttons keep the UIKit `Button` for SIK interaction but its fill is hidden
  (`opacity = 0`) and a `makeRectFrame` child draws the white button boundary, resized with
  the button in `relayoutButtons`. `justifyContent: SpaceBetween` (title top, actions
  bottom, free content in the gap). Text bigger: title 48→56, body 39→44, button 34→44.
  `BUTTON_MIN_W` 9→4.5 so 3 buttons fit a narrow card row without overlap.
- **`MemoryCardSpawner`** — card 30×40 → 22×28; thumbnail/OCR repositioned into the middle
  gap; `edgePointToward()` computes the point on the card's outline rectangle facing the
  marker, and the connector line now terminates there instead of at the card centre.
- Panel sizes: Launch 52×30 → 34×14; Scan prompt/loading 46×20 → 32×13; Scan error → 34×17.

Verified in Preview (isolated captures): Launch, Scan prompt and Memory Card all render as
white wireframe panels with transparent interiors; 3 card buttons are separate white
outline boxes; connector attaches at the card edge. Zero runtime errors, project saved.

### UI restyle round 2 — bigger type + rounded corners (2026-09-03)

User: labels ~5x bigger; 20% rounded corners on every box.

- **`makeRectFrame`** now takes `cornerFraction` (default 0.2) and builds a rounded-rect
  ring (per-corner arcs, `CORNER_SEGMENTS` subdivisions). `twoSided` set on `UILine.mat` so
  winding is cosmetic.
- **`PanelKit` rewritten without UIKit FlexLayout** — the flex column would not lay out the
  large type / stacked buttons predictably. Layout is now hand-computed local offsets:
  title top-anchored, buttons bottom-anchored (a row, or a full-width **column** when
  `PanelOptions.buttonsVertical`). Every text element uses `Text.sizeToFit` +
  `horizontalOverflow: Wrap` + a `layoutRect` sized to its box, so labels fill their box up
  to a large `size` ceiling (title 220, body 170, button 190) and wrap/shrink for long
  strings. `Rect` / `HorizontalOverflow` / `VerticalOverflow` are ambient LS runtime types.
- **`MemoryCardSpawner`** uses `buttonsVertical: true` (Keep / Remove / Change Label stacked
  full-width so each label is large). Card grew to 34x72 to fit title + thumbnail + the
  three tall buttons.

> **GOTCHA that cost many iterations:** an `@input`'s code default only applies when the
> component is *first* attached. Once it exists in the scene, the **stored value wins** and
> editing the `.ts` default does nothing. `MemoryCardSpawner.cardHeightCm` (and
> `FlowManager.debugStartState`, `CaptureController.autoCaptureAfterSec`) had stale stored
> values — set them with `scene-graphql setProperty` on the ScriptComponent, not in code.
> Component id for CardSpawner's script: `04573ad7-d931-4c58-ad24-9d4abb5d8b07`.

Verified (isolated Preview): Launch (rounded panel, 2 big row buttons), Scan prompt, and the
Memory Card (rounded card, big title, 3 stacked rounded buttons with large labels) all render
cleanly with no overlap. Zero runtime errors, project saved.

Still rough (Phase 2 "PanelKit polish"): card internal layout is free-positioned
thumbnail/OCR; on the Card screen the Scan panel + capture reticle stay visible
(ScreenRouter one-screen-at-a-time is Phase 2). Tune sizes via the constants at the top of
`PanelKit.ts` (`TITLE_SIZE`, `BUTTON_LABEL_SIZE`, `BUTTON_HEIGHT`, `CORNER_FRACTION`, `PAD`).

### UI restyle round 3 — fill, rounder buttons, coplanar diagram, pop animation (2026-09-04)

- **10% backing fill.** New `Assets/Materials/UIFill.mat` (unlit, blend Normal, `(0,0,0,0.1)`,
  twoSided). `makeRectFrame` takes `fillMat` + `fillColor` and fans a solid rounded interior
  behind the outline. PanelKit passes it for the panel surface and every button.
- **Button corners rounder than the panel.** `PanelKit.BUTTON_CORNER_FRACTION = 0.5` (pill)
  vs panel `CORNER_FRACTION = 0.2`.
- **Smaller button labels.** `BUTTON_LABEL_SIZE` ceiling 190 → 110; the label's `layoutRect`
  is now 78% of the button width × 50% of its height, so text sits inset with margin.
- **White connector, in the card's plane.** `makeGlowLine` default colour → white; `.set(a,b,
  planeNormal?)` — when a plane normal is passed, the bar's thin axis aligns to it so the
  line reads as a flat in-plane segment.
- **Coplanar sphere / line / card.** `MemoryCardSpawner` now builds a shared plane through
  the marker sphere facing the camera (`planeUp`/`planeRight` from the camera normal). The
  card sits directly "above" the sphere along `planeUp` (`cardGapCm` gap), billboarded with
  local +Y = `planeUp`. The connector spans sphere → card bottom-centre entirely within that
  plane.
- **Pop-up animation.** `MemoryCardSpawner` runs an `UpdateEvent` tween list. On spawn the
  card starts at the sphere (scale 0.06) and eases out (`easeOutCubic`, `POP_SEC = 0.42 s`)
  to its position at full scale; the connector line extends from the sphere as it goes.

Verified face-on in Preview: card with faint fill, three pill-cornered buttons with inset
labels, white in-plane connector to the marker sphere; tween settles to scale 1 cleanly.
Zero runtime errors, project saved.

---

### UITheme knob (2026-09-04)

`Assets/Scripts/UITheme.ts` — a one-slider component (`backgroundOpacity`, 0–1) that drives
the alpha of every wireframe backing fill, live (polls the `@input` each frame and re-tints
all registered fill materials). `makeRectFrame` registers each fill material with it. Scene
object: `TraceJournal/UITheme` (script comp `89bd208f-d874-482b-984b-9663558e43c9`), shipped
at **0.35**. Adjust it in the Inspector — no code edit, no preview restart needed.

Gotchas hit:
- `@hint(...)` must be a single string literal, not a `+` concatenation, or the UI-decorator
  compiler throws "Expected string literal".
- The fill was originally pure **black** `(0,0,0)` — opacity changes were invisible against a
  dark backdrop ("the slider does nothing"). `FILL_COLOR` is now a dark neutral
  `(0.11, 0.12, 0.15)` so the slider produces visible change.

## Phase 1 — COMPLETE ✅ (2026-09-04)

All Phase 1 exit criteria met plus three rounds of user-directed fixes and a UI restyle.
Ready for Phase 2 (card actions wired to a live `JournalEntry`; "Add Another Trace / Create
Today's Journal" branching; ScreenRouter one-screen-at-a-time; PanelKit polish).

## Phase 2 — Card actions & multi-capture branching ✅ (2026-09-04)

Implements the second half of DESIGN.md §3 (MVP priority 4). Verified end-to-end in
Preview: Scan → capture → Gemini → Memory Card → **Keep** (session records evidence,
card turns green "✓") → **Change Label** (chooser panel with Gemini alts + Scan
Again + Something Else) → pick an alternative (card title + session label update) →
"Create Today's Journal" → **Confirm**. Also verified **Remove** (destroys card +
marker sphere + connector line, unkeeps from the session, promotes the next kept
trace to primary, drops back to Scan when the last card goes). Zero runtime errors
across 6 Preview refresh cycles.

### New script

| Script | Role |
|---|---|
| `Assets/Scripts/JournalSession.ts` | `@component` — single source of truth for today's in-progress `JournalEntry` + the ordered list of KEPT `KeptTrace` records (`order`, `label`, `altLabels`, `ocrText`, `thumb`, `isPrimary`). Public: `keep / unkeep / relabel / setPrimary / isKept / keptCount / keptTraces / primaryOrder / getEntry / logContents`, and `onKeptChanged: Event<number>`. First kept trace becomes primary; removing the primary promotes the next. `rebuildEntry()` keeps `entry.objectLabels` / `entry.keptOcrText` in sync. No scene access. Phase 3 reads `getEntry()` / `keptTraces()`. |

### Changed scripts

- **`MemoryCardSpawner.ts`** — the three card buttons now do real work:
  - **Keep** → `journalSession.keep(...)` + `applyKeptVisual()` (green outline + green title + "✓" prefix via new `PanelKit` `setSurfaceColor` / `setTitleColor`).
  - **Remove** → `journalSession.unkeep()` (if kept) + `destroyCard()` (card root, marker sphere, `GlowLine`, splice `cards[]`); when `cards` is empty → `flowManager.goTo(Scan)`.
  - **Change Label** → transient `LabelChooser` PanelKit parented to the card (right side): up to 3 `altLabels`, **Scan Again** (discard card → Scan), **Something Else** (rebuilds the chooser with general categories `object / receipt / ticket / note / packaging` — no keyboard, per §3). One chooser open at a time.
  - New **"Your traces" action panel** — head-locked PanelKit (parented to Camera Object), shown only when `keptCount ≥ 1` and the screen is Scan/Card. Buttons: **Add Another Trace** (→ Scan; dropped/rebuilt when `keptCount ≥ 5` with a "limit reached" note) and **Create Today's Journal** (`logContents()` → `goTo(Confirm)`). Rebuilt (not mutated) when the button set changes, since PanelKit buttons can't be removed after `addButton`.
  - New `@input`s: `flowManager`, `journalSession` (References), `actionPanelDistanceCm` (-104), `actionPanelYCm` (-22), `debugAutopilot` / `debugAutopilotRemove` (Debug — Preview-only card-action self-test; both **false** in the shipped scene).
- **`ScreenRouter.ts`** — `apply()` now enables exactly one screen root. **Card enables no root** (cards + action panel are on always-on objects). `scanVisible = screen === Scan` only.
- **`ScanScreen.ts`** — reticle enabled only on `Scan` (was Scan||Card). `handleCapture` drops any capture while `flowManager.current !== Scan`. New optional `@input journalSession`: when wired, the trace cap counts **kept** traces (removed cards free capacity) instead of ever-spawned cards.
- **`PanelKit.ts`** — `TitledPanel` gains `setSurfaceColor(vec4)`, `setTitleColor(vec4)`, `destroy()`.

### Scene changes

- New `TraceJournal/JournalSession` SceneObject + `JournalSession` ScriptComponent (`7b3d8d56-96f8-4104-bf81-22d981e3590f`).
- Wired: `MemoryCardSpawner.flowManager` → FlowManager, `MemoryCardSpawner.journalSession` + `ScanScreen.journalSession` → JournalSession.
- **`TraceJournal/Screens/ScanRoot/Capture` reparented to `TraceJournal`** (was under ScanRoot). CaptureController must keep running while ScanRoot is disabled on the Card screen; ScanScreen now gates captures by screen state instead.
- **`GeminiService.model` fixed `gemini-3.5-flash` → `gemini-3-flash-preview`** via `scene-graphql setProperty`. The scene had drifted to a non-existent id (404s); this is the id BUILD_PLAN + the handoff both name. Preview Gemini calls now return in ~4–6 s.
- New `@input` scene values set (all via `scene-graphql setProperty`): `actionPanelDistanceCm = -104`, `actionPanelYCm = -22`.
- Debug flags left at shipping values: `FlowManager.debugStartState = "Launch"`, `CaptureController.autoCaptureAfterSec = 0`, `MemoryCardSpawner.debugAutopilot = false`, `MemoryCardSpawner.debugAutopilotRemove = false`.

### Notes / gotchas

- **`@input` stale-value trap hit again.** `actionPanelDistanceCm` / `actionPanelYCm` kept their first-compile stored values when I edited the `.ts` defaults; fixed with `setProperty` and the code defaults were realigned to match. Confirmed: always set changed `@input`s with `scene-graphql setProperty`.
- **Preview has no synthetic hand tool** in this environment (`PreviewInteractTool` / `QueryRuntimeSceneTool` not available, and `CaptureController` uses a raw `TapEvent` in editor, not a SIK Interactable). Card-action verification was done with the `debugAutopilot` `@input` (fires the real `onKeep` / `onChangeLabel` / `applyLabel` / `onRemove` / Create-Journal handlers on a 1.5 s timeline after the first card spawns). Left in as an off-by-default debug affordance, consistent with `debugLatencyProbe` / `autoCaptureAfterSec`.
- Transient `E [AudioOutput] Can not Set Media Type for Sink Writer` appears once at lens reset — LS Preview audio-sink noise, not from `Assets/Scripts`, did not recur on most refreshes.
- Action panel is large (PanelKit type is sizeToFit-to-box); it no longer overlaps the card but still dominates the lower view. Tune via `actionPanelYCm` / the `PanelKit` size constants if Phase 3 wants it smaller.
- The `MemoryCardSpawner.cardTowardCameraCm` / `cardUpCm` `@input`s are still unused (dead since the Phase 1 coplanar-diagram rewrite) — not touched here.

### Phase 3 (evidence confirmation, DESIGN.md §4) should tackle

- Build `ConfirmRoot` for real: list every `JournalSession.keptTraces()` card under "Here's what I found. Is it correct?" with per-field confirm (object label, each OCR fragment Keep/Remove, detected date, detected location — dates/locations require explicit opt-in).
- Let the user re-pick the primary trace (`JournalSession.setPrimary(order)` already exists).
- Buttons: **Back to Scanning** (→ Scan) and **Confirm and Continue** (→ Reflect, Phase 4).
- Persist confirmed values onto `JournalSession.getEntry()` (`confirmedLocation`, and keep `objectLabels` / `keptOcrText` authoritative).
- `GeminiService.analyzeTrace` already returns `date` / `location`; `TraceResult` carries them but `MemoryCardSpawner` doesn't store them per-card yet — Phase 3 will need `KeptTrace` to also hold `date` / `location` (add when building §4).

## Phase 3 — Evidence confirmation ✅ (2026-09-04)

Implements DESIGN.md §4 (MVP priority 5). Verified end-to-end in Preview (via
debug seed + autopilot — no synthetic hand tool in this environment): seed 2
traces → `FlowManager Launch → Card → Confirm` → ScreenRouter enables ONLY
`ConfirmRoot` → per-trace label confirm/re-pick, per OCR-fragment Keep/Remove,
Date/Location opt-in (OFF by default), re-pick primary → **Confirm and Continue**
→ `JournalSession.applyConfirmation(...)` writes the entry → `Confirm → Reflect`.
Both the date/location-present path and the empty path were run; zero script
runtime errors (only the known transient `E [AudioOutput] … Sink Writer` noise).

### New script

| Script | Role |
|---|---|
| `Assets/Scripts/ConfirmScreen.ts` | `@component` on `TraceJournal/Screens/ConfirmRoot` (script comp `ebe8ace1-41f8-4f5d-827c-cea80238ccb8`). Builds the wireframe Confirm UI (PanelKit) from `JournalSession.keptTraces()` when its object wakes / is re-enabled and tears it down on disable. Header **"Here's what I found. Is it correct?"** + one panel per kept trace + a footer (**Back to Scanning** → Scan, **Confirm and Continue** → Reflect). PanelKit buttons can't be relabelled, so every toggle mutates a local view-model and rebuilds the tree (persists across rebuilds and a Back-to-Scanning round trip). Wires `flowManager`, `journalSession`; `panelDistanceCm` (-100), copy strings, `debugAutopilot` (Debug, OFF). |

### Changed scripts

- **`JournalSession.ts`**
  - `KeptTrace` gains `date?`, `location?` (from Gemini) and `confirmedOcr?` (fragments the user kept at the Confirm screen).
  - `keep(order, label, altLabels, ocrText, thumb?, date?, location?)` — two new optional params; stores them per trace.
  - New `applyConfirmation(input: ConfirmationInput)` — writes per-trace label + kept OCR fragments, and (only on explicit opt-in) `entry.confirmedLocation` / `entry.date`. Emits `onKeptChanged`.
  - `rebuildEntry()` now prefers `confirmedOcr` over the raw `ocrText` split once a trace has been confirmed, so `entry.keptOcrText` is fragment-level after §4.
  - Exports pure helper `splitOcrFragments(text)` (by newline, else sentence-ish) — shared with ConfirmScreen so fragment boundaries agree.
  - New exported types `TraceConfirmation`, `ConfirmationInput`.
- **`MemoryCardSpawner.ts`**
  - Keep now passes `result.date` / `result.location` through to `journalSession.keep(...)` (they were previously dropped).
  - New `syncCardVisibility()` — hides spawned cards + their marker/line on Confirm and later screens (they no longer float behind the confirmation panels); restored on Scan/Card.
  - New Debug `@input`s `debugSeedConfirm` / `debugSeedWithDateLoc` (both OFF in the shipped scene) — on start (deferred 0.2 s) seed 2 synthetic kept traces and jump Launch → Card → Confirm so the Confirm screen is testable in Preview without capture/Gemini.
- **`ScreenRouter.ts`**
  - New `@input confirmRoot` (`@allowUndefined`), wired to `Screens/ConfirmRoot` (id `5280ce08-8ae7-4dab-a48d-09a4c4002f0e`). `apply()` enables it only on `Confirm` (line runs after the `otherRoots` disable loop, so it wins even though ConfirmRoot is also listed in `otherRoots`). Log line now reports `confirm=`.

### Scene changes

- `TraceJournal/Screens/ConfirmRoot` gains a `ConfirmScreen` ScriptComponent (`ebe8ace1-…`); inputs `flowManager` → FlowManager, `journalSession` → JournalSession set via `scene-graphql setProperty` (REFERENCE).
- `ScreenRouter.confirmRoot` → ConfirmRoot, set via `scene-graphql setProperty` (REFERENCE).
- All new `@input` scalars kept code defaults (fresh component — no stale-value trap): `ConfirmScreen.panelDistanceCm = -100`.
- Debug flags confirmed at shipped values: `FlowManager.debugStartState = "Launch"`, `CaptureController.autoCaptureAfterSec = 0`, `MemoryCardSpawner.debugAutopilot / debugAutopilotRemove / debugSeedConfirm / debugSeedWithDateLoc = false`, `ConfirmScreen.debugAutopilot = false`, `UITheme.backgroundOpacity = 0.4`.

### Write-back contract (what lands on `JournalSession.getEntry()`)

- `objectLabels` — the confirmed (possibly re-picked) label per kept trace.
- `keptOcrText` — only the OCR fragments the user kept (fragment-level after §4).
- `confirmedLocation` — the location string **only if opted in**, else `""`.
- `date` — the detected date **only if opted in**, else the entry's own date (today), unchanged.
- primary — `setPrimary(order)` when the user re-picks; first kept stays primary otherwise.

### Notes / rough edges (Phase 4+ polish, not blockers)

- PanelKit's internal title/body band compresses when a trace panel has many buttons; on a trace with date+location+primary the "#N label" title sits close to the first button. Legible, but a PanelKit layout tweak (`TITLE_SIZE` / band math) would help.
- With 2 traces × (date+location+primary) the whole Confirm tree scales to ~0.64–0.72 to fit the fit-budget (108 cm V / 150 cm H). Fine for 1–3 short-OCR traces (the realistic case); 4–5 traces with long OCR will get small. A 2-row grid or pagination is the future fix.
- OCR fragments beyond `FRAG_CAP = 4` are auto-kept and only noted in the panel body ("+N more kept") — no per-fragment toggle for them.
- `labelConfirmed` toggle is advisory/visual for the MVP — every trace's label is still written (there is no "reject the whole trace" path in §4).
- Verification used the `debugSeedConfirm` + `ConfirmScreen.debugAutopilot` inputs because this environment has no `PreviewInteractTool` / `QueryRuntimeSceneTool` (same constraint noted in Phase 2). Both left OFF and consistent with `MemoryCardSpawner.debugAutopilot`.

### Phase 4 (personal reflection, DESIGN.md §5) should tackle

- Build `ReflectRoot` for real: **"What do you want to remember about today?"** with Speak / Skip, then Confirm / Try Again / Remove on the transcript (spec §5). Write `entry.reflection`.
- **Reflect can reuse the wired-but-disabled `TraceJournalSpikeE_Reflection` ASR / AR-keyboard logic** (ASR is device-only; keyboard fallback already wired — `forceKeyboard` input). Promote it into a `ReflectScreen.ts` `@component` the same way Phase 1 promoted the Scan/Capture spikes.
- Add a `reflectRoot` `@input` to ScreenRouter (mirror `confirmRoot`) and enable it on `Reflect`; drop `ReflectRoot` handling from the `otherRoots`-only path.
- §6 (feeling → orb colour) is the other half of Phase 4 — sets `entry.feeling` / `entry.orbColor`.
- Gemini journal generation (§8) already accepts `confirmedLocation` + `date` in `JournalGenInput`; Phase 5 just needs to pass `entry` through.

## Phase 4 — Reflection & feeling ✅ (2026-09-04)

Implements DESIGN.md §5 (personal reflection, MVP priority 6) + §6 (choose the
feeling, MVP priority 7). Verified end-to-end in Preview via the seeded
autopilot chain (no synthetic hand tool in this environment — same constraint as
Phases 2/3): `debugSeedConfirm` → Launch→Card→Confirm, `ConfirmScreen.debugAutopilot`
→ applyConfirmation → **Reflect**, `ReflectScreen.debugAutopilot` → type → Try Again
→ type → Remove → type → Confirm → **Feel**, `FeelScreen.debugAutopilot` → Happy →
Peaceful (single-select) → Continue → **Generate**. Also ran the Skip path
(`ReflectScreen.debugAutopilotSkip`) → `reflection="" -> Feel`. Zero script
runtime errors across every run; one screen visible at a time on Reflect and Feel
(`[ScreenRouter] … reflect=true feel=false`, then `feel=true`, then all-false on
Generate). Final `JournalSession.logContents()` shows
`reflection="Long walk by the river…"`, `feeling="peaceful"`, `orbColor="#5B8DEF"`.

### New scripts (all `Assets/Scripts/`)

| Script | Role |
|---|---|
| `ReflectScreen.ts` | `@component` on `TraceJournal/Screens/ReflectRoot` (script comp `20bfd0cb-cab6-47c2-aa34-badee2f0d4c5`). Promotes the ASR + AR-keyboard-fallback logic from `TraceJournalSpikeE_Reflection` (that spike stays disabled). Prompt **"What do you want to remember about today?"** with a two-phase view-model: **prompt** (Hold to Speak / Type instead / Skip) ↔ **captured** (Confirm / Try Again / Remove). Rebuilds the panel tree per phase (PanelKit buttons can't be relabelled — same pattern as ConfirmScreen). **Confirm** → `JournalSession.getEntry().reflection = <verbatim text>` → `goTo(Feel)`; **Skip** → `reflection = ""` → `goTo(Feel)`; **Try Again** → clear + re-arm capture; **Remove** → clear (reflection stays empty). ASR is device-only → the keyboard is the Preview path; `forceKeyboard` `@input` + auto-fallback after `asrErrorsBeforeFallback` ASR errors. Text is stored raw, no processing (spec §5). |
| `FeelScreen.ts` | `@component` on `TraceJournal/Screens/FeelRoot` (script comp `ab6652e5-6bca-48cc-bf15-c3962fe7fd38`). Prompt **"Today felt…"** + 5 single-select rows, each **colour swatch (`makeRectFrame` chip) + Material icon (tinted `Component.Image`) + label**: Happy `#F2C94C` (`sentiment_very_satisfied`), Peaceful `#5B8DEF` (`spa`), Difficult `#9B59B6` (`sentiment_dissatisfied`), Surprising `#E67E22` (`celebration`), Ordinary `#9AA0A6` (`sentiment_neutral`). Selecting writes `getEntry().feeling` (lower-case id) + `.orbColor` (hex). Separate nav PanelKit: **Continue** → `logContents()` → `goTo(Generate)` (blocked with a hint until a feeling is picked); **Back** → `goTo(Reflect)`. `showIcons` `@input` — icons fall back to swatch+label on any load failure (`iconTexture()` uses literal `requireAsset` paths — concatenated paths do NOT resolve). |

### Changed scripts

- **`ScreenRouter.ts`** — new `@input reflectRoot` / `@input feelRoot` (`@allowUndefined`), mirroring `confirmRoot`: enabled only on their own state, after the `otherRoots` disable loop. Log line now reports `reflect=` / `feel=`.
- **`JournalSession.ts`** — `logContents()` now also dumps `confirmedLocation`, `reflection`, `feeling`, `orbColor` so the post-§5/§6 entry state is verifiable in the log. No behaviour change.

### Scene changes

- `TraceJournal/Screens/ReflectRoot` gains a `ReflectScreen` ScriptComponent; `FeelRoot` gains a `FeelScreen` ScriptComponent (both added via VirtualScene, then `@input`s wired via VirtualScene `modify` `@component:`/`@sceneObject:` refs).
- Wired: `ReflectScreen.flowManager` + `FeelScreen.flowManager` → `FlowManager` (`d8b1114c-…`); `ReflectScreen.journalSession` + `FeelScreen.journalSession` → `JournalSession` (`7b3d8d56-…`).
- `ScreenRouter.reflectRoot` → `Screens/ReflectRoot` (`95b9c1dc-5f5a-4c90-8997-0e2328a6bf1d`), `ScreenRouter.feelRoot` → `Screens/FeelRoot` (`0737dead-e07a-4d0b-8cfc-5a8d8c2212f2`), both via VirtualScene `modify`.
- New assets: `Assets/Icons/{sentiment_very_satisfied,spa,sentiment_dissatisfied,celebration,sentiment_neutral}.png` (imported via `/icon-selector`).
- Debug flags confirmed at shipped values after verification: `FlowManager.debugStartState = "Launch"`, `MemoryCardSpawner.debugSeedConfirm / debugAutopilot / debugAutopilotRemove / debugSeedWithDateLoc = false`, `ConfirmScreen.debugAutopilot = false`, `ReflectScreen.debugAutopilot / debugAutopilotSkip = false`, `FeelScreen.debugAutopilot = false`, `CaptureController.autoCaptureAfterSec = 0`, `UITheme.backgroundOpacity = 0.4` (untouched).

### Write-back contract (what lands on `JournalSession.getEntry()`)

- `reflection` — the verbatim reflection text on Confirm, or `""` on Skip / Remove-then-Skip.
- `feeling` — the lower-case feeling id (`happy` / `peaceful` / `difficult` / `surprising` / `ordinary`).
- `orbColor` — the feeling's hex string (e.g. `#5B8DEF`), for the §10 Memory Orb.

### Notes / rough edges (Phase 5+ polish, not blockers)

- PanelKit's title/body band still compresses with many vertical buttons; the Reflect prompt and Feel options panels ship with **no static body** (title carries the prompt; transient status uses `setBody`) to avoid text overlapping the top button. The Feel "Chosen: X" echo lives on the nav panel body instead.
- No synthetic hand/keyboard tool in this environment → verification used the OFF-by-default `debugAutopilot` inputs (consistent with `MemoryCardSpawner` / `ConfirmScreen`). On device: `ReflectScreen.forceKeyboard` if hold-to-talk is unreliable.
- Feel `Back → Reflect` re-enters Reflect fresh (empty transcript) — reflection persistence across a Back round trip is not required by the spec.
- Ortho Preview captures render the wireframe UI low-contrast on the near-black backdrop (documented since Phase 1) — fine with passthrough on device.

### §7 song — DEFERRED (optional per DESIGN.md MVP scope)

Not built. When picked up: **"Is there a song that belongs to this memory?"** with Add Song / Skip, text entry (or ASR) for `songTitle` / `songArtist` on `JournalEntry` (fields already exist, both optional). Slots between Feel and Generate; `JournalGenInput` already carries the optional song fields.

### Phase 5 (journal page generation, DESIGN.md §8) should tackle

- `GeminiService.generateJournal(payload)` already exists → returns `{title, paragraph, finalReflection}` (model `gemini-3-flash-preview`).
- Build `GenerateRoot` for real: assemble the **confirmed-only** payload from `JournalSession.getEntry()` (`objectLabels`, `keptOcrText`, `confirmedLocation`, `date`, `reflection`, `feeling`, + optional song), show a loading state (~5 s, reuse ScanScreen's animated-ellipsis pattern), then transition to Review (§9 layout) with Make Shorter / Make More Poetic / Regenerate / Save / Back.
- Add `generateRoot` `@input` to ScreenRouter (mirror `reflectRoot` / `feelRoot`); enable on `Generate`.
- Persist `generatedJournalText` / `finalReflection` onto the entry; on failure preserve all confirmed cards + reflection (spec §14).

## Cut lines if time runs short

Fold/morph orb animation → simple scale; palm-up hand menu → always-visible button;
song metadata; multi-month navigation.

## Post-MVP polish (2026-09-04) — UI theme, button gradient, orb shader

The full MVP (§1–§11) was completed and verified across the sessions above (see
CLAD_PROMPTS.md entries 1–26 for the phase-by-phase build and verification —
those writeups predate this section and weren't individually mirrored here).
The two rounds below are follow-up polish requests against the finished MVP.

### Round A — adjustable UI theme, no text outline, button spacing (CLAD_PROMPTS.md #27)

- `UITheme.ts` rewritten from a single `backgroundOpacity` slider into a full
  Inspector panel for the whole wireframe UI's look: text size (title/body/
  button), text colour, text outline (on/off + colour + width, **default now
  OFF** — was always on and read as a heavy black smudge around small text),
  line colour, panel/button frame thickness, panel/button corner roundedness,
  and a new `buttonForwardCm` (extra local-Z offset so buttons don't read as
  overlapping the panel frame). `PanelKit.ts`'s every panel/button build now
  reads these getters instead of its own hardcoded constants.
- Found and fixed two bugs while screenshotting the fix: Generate's result
  panel had the final-reflection text landing on top of the Save button
  (fixed-fraction layout never recomputed when §10 added a 3rd button — now
  computed layout math), and its title stayed stuck on "Composing your day .."
  forever after the loading spinner finished (an animation flag never got
  cleared when swapping to the done panel — one-line fix in the shared
  teardown path).

### Round B — button gradient, transparent panel, orb shader (noise + Fresnel + live debug preview)

**Prompt (CLAD_PROMPTS.md #28):** gradient (light gray → transparent, horizontal)
on the button background; fully transparent panel background; a "shader" on
the Memory Orb with wavy noise, a glowing Fresnel outline, a transparent
center, and a real-time debug preview mode.

**Button gradient + transparent panel.** `Assets/Textures/ButtonGradient.svg`
(precise horizontal linear-gradient, `#D9D9D9` 85%→0% alpha) converted to a
texture via `ConvertSvgToTexture`, applied on a new dedicated
`Materials/UIButtonFill.mat` (Unlit, `ENABLE_BASE_TEX`). `TraceGizmos.makeRectFrame`'s
fill mesh gained real UVs (was UV-less) so the gradient maps correctly across
the rounded-rect shape, and a new `fillIgnoresThemeOpacity` option lets a
fill carry its own baked-in look without being dimmed by `UITheme`'s panel
opacity slider — `PanelKit.addButton` uses it. `UITheme.backgroundOpacity`
default `0.25 → 0` (panels now fully transparent; buttons keep their own
gradient, unaffected). Verified visually in Preview: room fully visible
through the panel, buttons show the gradient.

**Orb "shader."** Lens Studio's node-graph shader system (Fresnel, Noise,
Custom Code nodes) has no scriptable wiring API from outside the visual
Material Editor — confirmed by inspecting `editor.d.ts` (`Editor.Assets.Pass`
exposes no node-editing surface) and by live-probing several presets
(`ColorGradientMaterialPreset`, `CodeNodeMaterialPreset`,
`DefaultCustomCodePreset` all still require hand-wiring in the visual editor).
Used the real, scriptable substitute instead: `Materials/OrbGlass.mat`
(`UberPBRMaterialPreset`) with its built-in define-toggle features, set the
same way `ImageMaterial.mat`'s `ENABLE_BASE_TEX` is set elsewhere in this
project:
- `ENABLE_RIM_HIGHLIGHT` (+ `rimColor`/`rimIntensity`/`rimExponent`) — a real
  Fresnel grazing-angle term, for the glowing outline.
- `ENABLE_NORMALMAP` (+ a generated soft-noise texture,
  `Generated Textures/OrbNoiseNormal.png` via `GenerateTexture`) — perturbs
  the surface shading for the wavy look without per-frame mesh rebuilding.
- `blendMode: Normal` + a low `baseColor.a` (`centerAlpha`) — a translucent,
  see-through body independent of the rim glow.
- Slow continuous rotation (`quat.fromEulerAngles` driven by `getDeltaTime()`)
  substitutes for UV-scrolling, since the shader graph exposes no scriptable
  UV-scroll uniform to animate the static noise pattern directly.

**Bug found + fixed: the debug preview never ran off-screen.** The first
implementation put the live-tunable debug preview inside `OrbScreen.ts`,
whose SceneObject (`Screens/OrbRoot`) is disabled by `ScreenRouter` whenever
the user isn't on the Orb screen — and Lens Studio never fires `UpdateEvent`
on a disabled SceneObject, so the preview could never actually build or tick
unless the user happened to already be on the Orb screen (defeating the
point of a live preview). Same root cause as the earlier "Placed sphere
vanishes" bug (§11): logic that must outlive/ignore the current screen can't
live under a toggled screen root. Fixed by extracting the shared orb look
(`centerAlpha`/`rimColorHex`/`rimIntensity`/`rimExponent`/`normalTiling`/
`rotationSpeedDegPerSec`) *and* the whole debug-preview build/tune mechanism
into a new component, `Assets/Scripts/OrbLook.ts`, attached to the
pre-existing always-on `OrbSpawner` SceneObject (mirrors `UITheme.ts`'s
module-level-state-plus-live-component pattern). `OrbScreen.ts` now only
reads `OrbLook`'s getters (`applyOrbLook`, `getRotationSpeedDegPerSec`) when
building the real, saved orb — one look, one source of truth, and the debug
preview keeps ticking regardless of which screen is active.

**Verification.** Recompiled clean. Wired `OrbLook` onto `OrbSpawner` via
`VirtualScene apply` (`orbMesh` → `MarkerSphereMesh.mesh`, `orbMat` →
`OrbGlass.mat`). Flipped `debugPreviewOrb` on while the Lens sat on the
**Review** screen (not Orb) and confirmed via log
(`[OrbLook][Debug] preview orb built`) and a runtime screenshot that the
preview orb builds immediately, off-screen — the actual bug fix, proven.
Then live-dragged `centerAlpha` (0.28→0.1), `rimIntensity` (3.5→8→15), and
`rimColorHex`/`rimExponent` via `scene-graphql setProperty` with **no
recompile and no Lens reset**, and screenshotted the same running orb after
each change — visibly more see-through at lower alpha (background blending
through), visibly tinted/brighter rim at higher intensity/exponent — proving
the real-time preview genuinely works. Note on visual read: at the values
tested in this dim indoor Preview scene, the Fresnel rim reads as a soft
overall tint/brighten rather than a dramatic bright ring at the silhouette —
the settings are technically correct and demonstrably live (color/intensity/
exponent all visibly move the render), but how pronounced the "glow" looks
will depend on scene lighting on-device; `rimIntensity`/`rimExponent` are
live Inspector sliders on `OrbLook` if it needs punching up further.

### Changed / new files (Round A + B)

| File | Change |
|---|---|
| `UITheme.ts` | Rewritten into the full theme panel described above (Round A); `backgroundOpacity` default → 0 (Round B). |
| `PanelKit.ts` | Reads all of `UITheme`'s new getters; `addButton` uses `UIButtonFill.mat` + `fillIgnoresThemeOpacity`. |
| `TraceGizmos.ts` | `makeRectFrame` fill mesh gained UVs; new `fillIgnoresThemeOpacity` option. |
| `OrbScreen.ts` | Orb "shader" class-doc explaining the UberPBR substitute; `buildOrb` now calls `OrbLook`'s `applyOrbLook`/`getRotationSpeedDegPerSec`; old in-file debug-preview mechanism removed (moved to `OrbLook.ts`). |
| `OrbLook.ts` (new) | Always-on component on `OrbSpawner`: shared orb-look sliders + getters, and the live real-time debug preview (`debugPreviewOrb`, `debugOrbColorHex`). |
| `Materials/UIButtonFill.mat` (new) | Unlit, gradient-textured button fill. |
| `Materials/OrbGlass.mat` (new) | UberPBR, rim-highlight + normal-map + translucent — the orb "shader". |
| `Textures/ButtonGradient.svg` → `ButtonGradient_*.png` (new) | Source + converted button gradient texture. |
| `Generated Textures/OrbNoiseNormal.png` (new) | AI-generated soft-noise normal map for the orb's wavy surface. |

### Scene changes

- `OrbSpawner` (`1c33a753-…`) gains an `OrbLook` ScriptComponent (`3fb13fda-…`), `orbMesh` → `MarkerSphereMesh.mesh`, `orbMat` → `OrbGlass.mat` (`56df76ac-…`).
- Debug flags confirmed OFF / reset at shipped values after verification: `FlowManager.debugStartState = "Launch"`, `ReviewScreen.debugSeedMoments = false`, `OrbLook.debugPreviewOrb = false` (tuning left at `centerAlpha 0.25 / rimColorHex #BFE3FF / rimIntensity 5 / rimExponent 3`, matching the `.ts` defaults), `UITheme.backgroundOpacity = 0`.

### Notes / rough edges

- `normalTexUvScale` (used to drive normal-map tiling) is applied via a
  try/catch best-guess following this codebase's `xxxUvScale` naming
  convention — not individually confirmed as a real `UberPBR` uniform name;
  harmless no-op if wrong (tiling just stays at the material's own default).
- The Preview panel's world-space screen panels track the interactive preview
  camera's position at render time (not fixed at their original build-time
  spot) — worth remembering for future runtime screenshots: get far enough
  from the panel's forward direction (or navigate to a screen with no active
  panel) before framing a scene object of interest, or the panel will fill
  the frame.

## Round C — Place in Space: hand-follow + pinch-to-drop (2026-09-04)

**Prompt (CLAD_PROMPTS.md #29):** "after pressing btn, the ball follow the forward
direction of their hand, and use pinch to decide where to put it."

Previously "Place in Space" saved immediately, reparenting the sphere wherever it
happened to be sitting next to the panel (see the original §11 writeup). Rewrote
`OrbScreen.ts`'s placement path into three phases:

1. **Begin** — tapping "Place in Space" no longer saves. It swaps the panel for a
   short instruction panel (Cancel, and — Editor/Preview only — "Drop Here
   (Preview)") and enters a `placing` flag. On device it also subscribes to the
   dominant hand's `onPinchDown` (`SpectaclesInteractionKit.lspkg/Providers/
   HandInputData/HandInputData`).
2. **Follow** — every `onUpdate()` while `placing`, the sphere is moved to
   `origin + direction * placeDistanceCm` (default 60cm, an Inspector slider).
   `origin`/`direction` come from `BaseHand.targetingData` (`targetingLocusInWorld`
   / `targetingDirectionInWorld`) — the real ray SIK's own Interactors use to aim
   at UI — with the Camera Object's forward ray as the fallback used whenever
   there's no hand tracking (Editor/Preview) or the hand is briefly untracked.
3. **Finalize** — a pinch (device) or the Drop Here button (Editor/Preview) calls
   `finalizePlacement()`: unsubscribes the pinch listener, reparents the sphere to
   the always-on holder via `setParentPreserveWorldTransform` (**not** plain
   `setParent`, which only preserves LOCAL transform — the sphere would have
   jumped back near the panel's origin the instant it was reparented), then runs
   the unchanged `saveDay("placed")` persist/confirm path. Cancel instead calls
   `rebuild()`, which tears down the floating sphere and rebuilds a fresh
   pop-in sphere + the normal buttons panel.

### Bug found + fixed: pop-in tween crash on a fast double-build

Verifying this needed jumping straight into the Orb screen
(`FlowManager.debugStartState = "Orb"`), which turned up a latent, unrelated bug:
`OnStartEvent` and an immediate `OnEnableEvent` both called `rebuild()` in that
path, so the SECOND `buildSpherePanel()`'s `destroySphere()` destroyed the sphere
the FIRST build's still-running pop-in scale tween was animating — the tween's
closure still held that (now-null) `SceneObject`, and the next frame's
`obj.getTransform()` threw `Exception in HostFunction: Object is null`. Fixed by
giving each tween record an `obj: SceneObject` field (mirroring the spinners
array's existing pattern) so `onUpdate()` can skip and drop a tween whose target
was destroyed, instead of calling `step()` blind.

### Verification

Added `debugAutopilotPlace` (off by default, mirrors the existing
`debugAutopilot`): begin placement → finalize (pinch stand-in) → Done, on a 1s /
2s / 3.2s delay chain. Ran it via `debugStartState="Orb"` + the new flag:
log confirmed `[Orb] placed at {x,y,z}, reparented to "OrbSpawner"` →
`[Orb] persisted` → `[Orb] saved — privacy="placed"` → `Done -> Home`, with **zero
runtime errors**. A `QueryRuntimeSceneTool` lookup at the logged position found
the `MemoryOrb` alive, parented under `OrbSpawner` (not the toggled `OrbRoot`),
at full scale (18/18/18 — not stuck mid pop-in-tween), and a
`CaptureRuntimeViewTool` isolate screenshot confirmed it visually: a solid,
correctly-shaded sphere floating in empty space, not stuck back at the panel.
(Also tried `PreviewInteractTool`'s `Pinch`/`Poke` actions targeting the actual
`Btn_Place in Space` Interactable directly — both reported "Blocked by Collider
between camera and target," a pre-existing tool/scene quirk unrelated to this
change; the debug-autopilot path above was used instead, consistent with this
project's established Preview-verification approach for every other screen.)
All debug flags reset to shipped values afterward
(`FlowManager.debugStartState="Launch"`, `OrbScreen.debugAutopilotPlace=false`).

### Changed files

| File | Change |
|---|---|
| `OrbScreen.ts` | New `placing` phase (`beginPlacement`/`buildPlacingPanel`/`updatePlacementFollow`/`getAimRay`/`finalizePlacement`/`cancelPlacement`/`unsubscribePlacement`); `saveDay`'s "placed" branch simplified (reparenting now happens in `finalizePlacement`, with world transform preserved); new `cameraObject` @input (Editor/Preview ray fallback) + `placeDistanceCm` setting + placement copy fields; tween record gained an `obj` field to fix the crash above; new `debugAutopilotPlace` debug flag. |

### Scene changes

- `OrbScreen` (`c2cd03e6-…`) gains `cameraObject` → the scene "Camera Object" (`@id:00000000-0000-0065-0000-000000000064`), the same well-known reference `CaptureController`/`MemoryCardSpawner`/etc. already use.

### Notes / rough edges

- Placement is a fixed distance along the ray, not a world-surface hit-test (no
  WorldQuery snap-to-table) — matches the literal ask ("follow the forward
  direction… pinch to decide") without the added complexity/risk of a surface
  raycast; `placeDistanceCm` is a live Inspector slider if a different default
  throw distance is wanted.
- Uses the **dominant** hand (`HandInputData.getDominantHand()`, right by
  default) rather than a specific hand — consistent with
  `CaptureController`'s own hardcoded-right-hand pinch-to-capture convention,
  but automatically follows the system's dominant-hand setting rather than
  hardcoding right.
- `PreviewInteractTool`'s hand-simulated `Pinch`/`Poke` against this panel's own
  buttons hit a "Blocked by Collider" error in this environment (seemingly
  pre-existing / unrelated to this feature — the same panel/button system every
  other screen already uses). Worth another look if a future task specifically
  needs synthetic-hand testing of button taps; for now `debugAutopilot*` flags
  remain this project's verification method, as documented since Phase 2.

## Round D — card shrink-out, mic/keyboard icons, moment-saved spacing, Review placement (2026-09-05)

**Prompt (CLAD_PROMPTS.md #30):** Keep/Retake/Remove should shrink the memory
card smoothly toward its marker sphere before the next window is allowed to
pop up (also smoothly); the per-moment reflective-question buttons should
show a mic icon (Hold to Speak) / keyboard icon (Type instead), Skip stays
text, laid out horizontally; the "Moment saved for today." panel needs more
gap between the title and the first button; and the panel that pops up after
"Create Today's Journal" should spawn in front of the user, not billboard.

### 1. Card shrink-out + gated next window (`MemoryCardSpawner.ts`)

New shared `beginShrinkAndThen(card, after)`: animates the card's root (+ its
marker sphere, scaled down in lockstep, + its connector line, collapsed via
the same `GlowLine.set()` API the pop-in tween already uses) toward the
marker's own world position over `SHRINK_SEC` (0.28s), destroys the whole
card only once that finishes, and only THEN calls `after()`. Keep, Retake,
and Remove all route through it now:
- **Keep** — waits `KEEP_FLASH_SEC` (0.35s) so the green "Kept for today."
  state is actually visible, then shrinks, then hands off to
  `MomentEmotionReflect.begin(order)` — previously this fired the sub-flow
  panel immediately, with the "kept" card left floating forever in the
  background (never torn down).
- **Retake / Remove** — shrinks, then (Retake always / Remove only if it was
  the last card) `goTo(Scan)`.

A `card.shrinking` guard (checked in Keep/Retake/Remove/Change-Label) stops a
double-tap from firing a second action mid-animation.

**Bug found + fixed in the same pass:** the `Tween` interface had no way to
tell `onUpdate()` that a tween's target had been destroyed out from under it
— exactly the class of bug fixed in OrbScreen (Round C). Added an `obj:
SceneObject` field (skip + drop the tween if `isNull(tw.obj)`) and an
`onComplete?: () => void` hook (so shrink-then-destroy-then-continue can be
expressed as one tween instead of a second timer). Also reordered
`runAutopilot()`: Change Label → pick alternative now happens *before* Keep,
since Keep now destroys the card (there's nothing left to Change Label on
afterward) — `debugAutopilotRemove` now chooses Remove instead of Keep as the
autopilot's last step, rather than a separate post-Keep Remove.

### 2. Mic/keyboard icons, horizontal row (`MomentEmotionReflect.ts`)

Imported `mic` and `keyboard` via `IconSelector` (`Assets/Icons/{mic,keyboard}.png`,
same convention as FeelScreen's existing icons). New `decorateIcon(btnSO,
icon)` centers one on an otherwise-empty-label button
(`panel.addButton("", onTap)`), mirroring FeelScreen's `Component.Image` +
`ImageMaterial.mat` pattern. The reflective-question "prompt" panel: Hold to
Speak → mic icon, Type instead / Type (the already-on-keyboard branch) →
keyboard icon, Skip stays a text button; `buttonsVertical: false` so the row
is horizontal instead of stacked.

### 3. "Moment saved for today." spacing (`MomentEmotionReflect.ts`)

The title sat right on top of "Capture Another" (PanelKit anchors the title
from the panel's TOP and the button stack from its BOTTOM independently —
nothing enforces a minimum gap between them). `heightCm` 40 → 56: a taller
panel keeps the title in the same spot but pushes bottomY (and so the whole
button stack) further down, opening roughly one button-height of clear gap.

### 4. Smooth pop-in for this sub-flow's own panels

New reusable `PanelKit.popInTween(root, dur=0.25)`: sets the tiny starting
scale synchronously (no 1-frame flash at full size) and returns a `{obj, t0,
dur, step}` tween descriptor shaped to drop straight into any caller's own
tweens-array + onUpdate idiom (MemoryCardSpawner/OrbScreen/etc. already have
one). `MomentEmotionReflect` gained its own tweens array + `onUpdate()` (it
had neither before) and now calls `this.popIn(panel)` right after building
each of its four panels (emotion pick, question prompt, question captured,
moment saved).

### 5. Review spawns in front of the user, not billboarded (`ReviewScreen.ts`)

New `cameraObject` @input + `spawnInFrontOfUser()`: moves `this.sceneObject`
(ReviewRoot) to the Camera Object's CURRENT world position, and its
rotation to the camera's yaw only (pitch/roll stripped via
`toEulerAngles().y` + `quat.fromEulerAngles(0, yaw, 0)`, so the panel doesn't
tilt if the user's head was tilted up/down) — done ONCE per fresh screen
entry, called from `OnStartEvent`/`OnEnableEvent` specifically, NOT from the
generic `rebuild()` (which also re-runs on every Include/Exclude/relabel
toggle — repositioning there would re-snap the whole panel to the user's
live head position on every tap, which is a billboard in disguise, just a
stuttery one). Since the panel's own content already sits at a local -Z
offset (`panelDistanceCm`) from the root, this reproduces exactly what the
ORIGINAL static setup already did for a user who never left the scene's
default camera pose — just generalized to wherever the camera currently is.

### Verification

Ran the real flow once — capture → Gemini → card → `debugAutopilot`'s Change
Label → pick alternative → **Keep** → confirmed via log
(`[MemoryCard #1] Keep -> kept`) and screenshot that the card and its
marker/line are gone and only the scanned object remains visible → emotion
panel screenshotted at full pop-in scale → temporarily stretched the
`MomentEmotionReflect` autopilot's own delays out to 9999s (reverted right
after) to freeze on the reflective-question "prompt" panel long enough to
screenshot it: **mic icon / keyboard icon / "Skip" in a horizontal row** →
did the same to freeze on "Moment saved for today.": clear, roughly
one-button-height gap now visible above "Capture Another" → let the chain
continue to Create Today's Journal → Review, then confirmed via
`QueryRuntimeSceneTool` that `ReviewRoot`'s world position/rotation exactly
matched a deliberately-relocated (via `MovePreviewCamera`) Camera Object —
proving the placement math is correct, not just coincidentally identical to
the default pose. `PreviewInteractTool`/`InjectPreviewGesture` couldn't
directly tap these nested buttons in this environment (same pre-existing
"Blocked by Collider" limitation noted in Round C, plus `CaptureController`'s
global editor-mode tap-to-capture consuming raw taps) — verification used
`debugAutopilot` chains + temporary delay stretches, consistent with this
project's established Preview-testing approach.

### Notes / rough edges

- **New non-fatal observation:** a SIK-internal exception
  (`CursorViewModel`/`InteractableScoring`: "Exception in HostFunction: Object
  is null") appears in the log immediately after Keep's shrink destroys a
  card's Interactable buttons (and once after ReviewScreen's placement, in an
  earlier run, though that did not reproduce on a clean isolated retry — the
  MemoryCardSpawner case reproduced consistently). Doesn't break anything —
  execution continues normally on the very next line every time — but is a
  real, newly-surfaced side effect of destroying Interactables SIK's cursor
  system may still hold a cached hover/targeting reference to. SIK-internal,
  not this project's code; flagged for awareness rather than chased further.
- `SHRINK_SEC` (0.28s) and `KEEP_FLASH_SEC` (0.35s) are plain constants in
  `MemoryCardSpawner.ts`, not Inspector-exposed — easy to promote to @inputs
  later if they need per-project tuning.

## Round E — Vertex Distortion orb, emoji-only, button z-fight fix (2026-09-05)

**Prompt (CLAD_PROMPTS.md #31).**

### Orb — Vertex Distortion material (`OrbLook.ts`, `OrbScreen.ts`)

The user swapped Magic Dew for the asset-library **Vertex Distortion** graph
shader (`Vertex Distortion.lspkg/Vertex Distortion.mat`, id
`4aab6944-18fa-4955-afb6-2eef819bff8f`) — animated per-vertex noise, a real
wavy surface. `OrbScreen.orbMat` rewired to it (`OrbLook.orbMat` the user had
already rewired). `OrbLook.ts` rewritten:

- **Removed** every UberPBR rim / normal-map setting (`centerAlpha`,
  `rimColorHex`, `rimIntensity`, `rimExponent`, `normalTiling`) and the
  `hexToVec4` helper — the rim glow never actually read on-device/in-Preview.
- **Added** `waveStrength` / `waveSpeed` / `noiseScale` sliders → the graph's
  `strength` / `animatedSpeed` / `noiseScale` ports. `rotationSpeedDegPerSec`
  kept.
- `applyOrbLook(mat, colorHex)` now writes the day's feeling colour to the
  graph's **`Port_Albedo_N006`** port (VEC3) — verified in Preview: a debug
  orb driven from `#F2C94C` rendered clearly yellow, silhouette visibly
  wobbling from the vertex noise.

Note: the material is `blendMode: Disabled` (opaque) — the earlier
"transparent centre" is gone with this material. Not re-added (not asked this
round); flip `blendMode` → Normal + lower `Port_Opacity_N006` if wanted.

### Emotion pick — emoji only (`MomentEmotionReflect.ts`)

`EMOTIONS` gained an `emoji` field; the buttons are now `addButton(e.emoji,…)`
with **no text label and no colour swatch** (`decorateSwatch` + `hexToVec4` +
`UI_LINE_MAT`/`makeRectFrame` import all deleted). The emotion's colour still
travels to Review/Orb via `setMomentEmotion(id, hex)` — it's just not drawn on
the button. Title → "Pick a feeling right now." Verified in Preview that Lens
Studio's font renders full-colour emoji; `🥹` (nostalgic, a 2022 emoji)
swapped for `💭` as a safer glyph.

### Button background glitch — coplanar transparent z-fight

The "glitchy" flickering button fill was two+ transparent, non-depth-writing
quads sitting at (nearly) the same Z: our gradient fill quad and SIK's own
button-background `RoundedRectangle` quad (which `btn.opacity = 0` hides but
leaves in the draw list). Fix, four parts:

- `UIButtonFill.mat`: `twoSided` → **false** (a flat quad's front/back faces
  were themselves coplanar and sort-fighting) + `polygonOffset` **(-2, -2)**
  (deterministic depth bias toward camera).
- `PanelKit.addButton`: the `BtnFrame` (and so its gradient fill) pushed from
  localZ `0.05` → **`0.25`**, the label from `0.12` → **`0.45`** — the fill
  quad (`0.20`) is now nowhere near coplanar with SIK's quad at `z≈0`.
- `PanelKit.addButton`: in `btn.onInitialized`, **disable** the button
  object's own `RenderMeshVisual` (SIK's background quad) so there's just the
  one fill quad. Same phantom-quad disable added to `setTitleTappable` and
  `setPanelTappable`.

Verified from several steep off-axis angles — the button fills read clean and
stable, no tearing/flicker artifacts.

### Also this round (carried from Round D, wired now)

- `ReviewScreen.continueLabel` stored scene value pushed to "Create Journal"
  (the `.ts` default alone doesn't update an existing @input).

## Phase §12 — Monthly Container ("the Jar") — STARTED (2026-09-05)

DESIGN.md §12 / MVP priority 12. The `Jar` screen state + an empty `JarRoot`
placeholder already exist (FlowManager enum, ScreenRouter). Reads the
multi-day JSON array `OrbScreen` already persists to
`global.persistentStorageSystem.store` under `traceJournal.days` (§13
persistence is effectively already covered on the write side). Goal: a
palm-up-menu / button summons a container of one coloured sphere per completed
journal day; tap a sphere → its object previews + title/date; deliberately
unlock → the full journal paragraph + final reflection.

### Phase §12 — first working version (2026-09-05)

**New `Assets/Scripts/JarScreen.ts`** — `@component` on `Screens/JarRoot`
(component id `8f357e32-086c-4ef0-8308-4f58ecb8950d`).

- **Month grid** (`buildMonthView`): reads the persisted `traceJournal.days`
  `JournalEntryData[]`, sorts by date, and lays out one small sphere per day
  (up to 7 per row, wrapping) — each a `MarkerSphereMesh` + a `MarkerWhite.mat`
  clone tinted to that day's `orbColor` (the §8 feeling colour) — with a
  `prettyDate` caption under it and a full invisible `Button` over the holder
  as the tap target. Header shows the month name + day count; footer = a
  "Back to Home" button. Empty state ("No journals yet.") when the store is
  empty. `content` is scaled to fit vertical AND horizontal span.
- **Day detail** (`buildDayView`): date + generated title in the panel title,
  object LABELS as the "previews" line (cut-out thumbnails aren't persisted —
  labels-only is the pragmatic scope), and a "Reveal journal" button.
- **Reveal** (the design's "deliberately unlock the full journal entry"):
  flips `revealed`, rebuilds — the generated paragraph renders as a plain
  fixed-size (70) wrapped `Text` on the panel's contentAnchor (PanelKit's
  shrink-to-fit body renders a paragraph tiny — same lesson as
  GenerateScreen.addFreeText), the final reflection as the panel body.
- **Delete** a day → rewrites the store array (edit / move / export are
  DEFERRED per DESIGN.md).
- Nav: "Back to month" (detail → grid) and "Back to Home" (→ Launch).
- Debug: `debugSeedDays` (3 **in-memory-only** fake days — never written to
  the store, so turning it off leaves no pollution), `debugOpenFirstDay`
  (auto-open + auto-reveal the first day for screenshotting),
  `debugClearSavedDays` (one-shot store wipe — used once to clear a first-pass
  `putString` seed that HAD persisted; now off).

**Changed scripts**

- `ScreenRouter.ts` — new `jarRoot` @input; enables `JarRoot` only on the Jar
  state (mirrors `orbRoot`/`reviewRoot`); log line reports `jar=`.
- `LaunchScreen.ts` — new **"Revisit the Month"** button → `goTo(Jar)`,
  always available (Jar has its own empty state). Home panel `heightCm`
  46 → 58 to fit three stacked buttons.

**Scene changes**

- `JarRoot` (`d1e36757-…`) gains a `JarScreen` ScriptComponent — `flowManager`
  → FlowManager, `sphereMesh` → `MarkerSphereMesh.mesh`, `sphereMat` →
  `MarkerWhite.mat`.
- `ScreenRouter.jarRoot` → `Screens/JarRoot`.

**Verified in Preview** (`debugStartState="Jar"` + `debugSeedDays` +
`debugOpenFirstDay`): the month grid rendered 3 correctly-tinted day-spheres
(blue / orange / yellow) with date captions; the day detail showed
date + title + object-label previews; Reveal showed the full paragraph
(readable at size 70) + final reflection; Home now shows the three-button
layout with "Revisit the Month". No runtime errors. All debug flags reset to
shipped values; project saved.

**Known follow-ups (not blocking):** the detail-panel title text is wide
enough to clip at the panel edges from a dead-centre close view (fine head-on,
worth a `titleSize` trim); tapping a day-sphere couldn't be exercised via
`PreviewInteractTool` (the sphere mesh blocks the sim ray — the same
environment limitation hit elsewhere) so that path was verified via the
`debugOpenFirstDay` autopilot; §12's "month's emotional pattern" view is just
the row of colours for now (no chart); the palm-up summon gesture stays a
plain button (DESIGN.md cut line).

## Round F — card/emoji/thumbnail polish (2026-09-05)

**Prompt (CLAD_PROMPTS.md #32) — six small UI fixes.**

### New PanelKit options (all opt-in, default = old behaviour)

| option | effect |
|---|---|
| `buttonGridCols` | lay the action buttons out in a grid of N columns (rows stack from the bottom inset, reading order top-left first) — for a picker of many small same-size buttons |
| `buttonDropCm` | nudge the whole (bottom-anchored) button block further down |
| `frameless` | skip the surface frame + fill — just title/body/buttons floating |
| `contentDropCm` | shift the (top-anchored) title + body block down toward centre |

### The six fixes

1. **`MemoryCardSpawner.confirmPrompt`** default → `""` (+ scene value pushed). No more
   "Here's what I found. Is it correct?" on the card.
2. **`KEEP_FLASH_SEC` 0.35 → 3.0** — after Keep the card holds its green "Kept" state for
   ~3s, then the existing shrink-out runs. (`begin()` for the §4 sub-flow now fires ~3.3s
   after Keep.)
3. **Emoji picker → 5×2 grid.** `buildEmotionPanel` uses `buttonGridCols: 5` on a much
   shorter panel (heightCm 108 → 44). `EMOTIONS` grown 7 → 10 (added `grateful` 🙏 /
   `tired` 😴 / `proud` 💪, each with its own reflective question) so two full rows.
4. **Moment-saved panel.** heightCm 56 → 62 + `buttonDropCm: 4`; `buildKeptThumbsRow`
   thumbnails 1.5× (h 6→9, slot 7.5→11.25).
5. **Review screen.**
   - Footer: `frameless: true`, empty title — just the two buttons (`Back` /
     `Create Journal`). `setBody()` still surfaces the "select 1 to 5" hint (floats, no box).
   - Per-moment cards: `contentDropCm: 5` centres the title/body; `traceH` 62 → 44 kills the
     empty lower half; the thumbnail width is clamped to `panelW - 6` so a wide cut-out
     can't spill past the outline, and it's positioned just below the (dropped) text so the
     two read as one centred group.
6. **White sticker outline on every background-removed thumbnail** — new in `TraceGizmos`:
   `ThumbOutline` type, `addThumbBorder(parent, localPos, w, h, outline)` (a white
   `makeRectFrame` sibling for the bbox / full-frame tiers), and an `outline?` param on
   `makePolygonCutout()` (a radially-inflated white copy of the silhouette, z-behind, for the
   cut-out mesh tier). Wired into `MemoryCardSpawner` (both `buildThumb` — now returns a
   holder so image + border swap together on a segmentation upgrade — and `buildPolygonThumb`),
   `ReviewScreen.buildThumb`, and `MomentEmotionReflect.buildOneKeptThumb`.

### Verification

Ran the real capture → autopilot chain and the seeded-Review path. Confirmed: the 5×2 colour-
emoji grid; the 3-second Keep hold (log timing); the larger moment-saved thumbnail with the
button stack dropped; the frameless Review footer (two bare buttons, no "Ready?"); the
shorter, more-centred moment cards keeping the green outline + ✓ on chosen moments. The
outline object is built on every thumbnail; it just reads invisibly on the Preview test
capture (a white wall poster cropped to a white square). All debug flags reset; project saved.

## Round G — white outline scoped to the true cut-out only

Prompt #33: *"the White outline is added to the original thumbnail, instead of the removed
background one, fix it."*

The Round F `addThumbBorder()` rectangle was applied on the bbox-crop / full-frame tier,
which still shows the photo's background — so the outline framed the *un-cut* image. Fix:

- **`addThumbBorder()` removed from `TraceGizmos`** and from every caller
  (`ReviewScreen.buildThumb`, `MemoryCardSpawner.buildThumb`, `MomentEmotionReflect.buildOneKeptThumb`) —
  those fallback tiers now render with no border (NOTE comments mark why).
- **`makePolygonCutout()` reworked** so the white outline is a radially-inflated copy of the
  *actual silhouette mesh* (per-vertex outward scale by `outline.widthCm`), built as a child
  **before** the textured cut-out so it draws behind it; `depthWrite = true` on the cut-out
  material makes the texture occlude the inflated copy everywhere except the peeking rim.
  Outline sits at localZ −0.05.

Net effect: the sticker outline appears only when Gemini segmentation succeeds and the real
polygon cut-out tier is reached — it hugs the background-removed shape, never a rectangle
around the raw frame. Compiles clean; clean boot; project saved. (Hard to see in Preview —
segmentation usually times out there, so the cut-out tier is rarely reached.)

## Round H — end-of-flow polish (prompt #34)

Seven changes across the Review → Feel → Generate → Orb tail plus the card sub-flow.

### 1. ReviewScreen moment cards + footer
- `buildMomentPanel` body: **time and emotion share row 1** (`"19:27   ·   Peaceful"`);
  the reflection snippet is row 2.
- The frameless footer is repositioned by explicit math (BTN_H / PANEL_PAD mirror PanelKit's
  internal constants) so the **button row sits one button-height below the moment-card
  bottoms**. The footer no longer carries a body band — the rejected-tap hint ("include up
  to 5", "select 1 to 5") moved to the **header body** via a new `hintMsg` field, cleared on
  the next good toggle.

### 2. ScanScreen — segment before showing the card
`onAnalyzeSuccess` now awaits `gemini.segmentPrimary()` **before** `cardSpawner.spawn()`.
`spawn()` + `applySegmentation()` run in the same synchronous tick — before the pop-in
tween's first frame — so the card appears already wearing its cut-out + outline instead of
popping the raw capture and visibly swapping seconds later. A `pendingSpawns` counter keeps
the loading panel up during the wait; `SEG_SPAWN_TIMEOUT_SEC = 10` shows the card anyway if
segmentation stalls. Verified: real capture → `thumbnail path: CUTOUT` logged at spawn time,
no intermediate bbox render.

### 3. PanelKit `buttonsFrameless` + MomentEmotionReflect emoji grid
New `PanelOptions.buttonsFrameless` — `addButton` skips the wireframe frame and the gradient
fill quad, keeping just the label and a full-slot invisible tap target (`btnFrames` entries
may now be `null`; all call sites already null-guarded). MomentEmotionReflect's §4 5×2 grid
passes it: **bare emoji glyphs, no button chrome**, still tappable. Verified in Preview.

### 4. FeelScreen — spawn in front, no nav, auto-advance
- New `cameraObject` @input (wired to Camera Object) + `spawnInFrontOfUser()` (yaw-only,
  once per entry — mirrors ReviewScreen).
- The nav panel (title "Choose a feeling"/"Ready?" + Continue + Back) is **removed**; the
  feelings panel is the only panel.
- `select()` writes `entry.feeling`/`orbColor`, logs, and `goTo(Generate)` **immediately** —
  no confirm step, no Back from here.
- Panel down-scaled (`58 / feelingsH`) + nudged down 6cm; the removed nav used to pull the
  fit factor down. `doContinue`/`doBack`/`labelFor` deleted; autopilot simplified to one
  pick.

### 5. GenerateScreen loading panel
`buildLoadingPanel` gets `contentDropCm: 6` — "Composing your day…" is now vertically
**centred** in the panel instead of hugging the top. Verified in Preview.

### 6. GenerateScreen done panel — icon buttons
The Save / Revise / Back vertical text stack is replaced by **one horizontal row of four
Material-icon buttons**: `arrow_back` → Back, `refresh` → Regenerate, `edit` → Edit the
words, `save` → Save. New module `iconTexture()` + `decorateIcon()` (mirrors
MomentEmotionReflect). `openReviseChooser` deleted (Make-Shorter / Change-Tone dropped from
the UI; `currentStyleHint` → `styleHint` plumbing kept for debug/autopilot Regenerate).
Icons imported to `Assets/Icons/` (arrow_back / refresh / edit / save .png). Verified in
Preview with a full Gemini journal.

### 7. OrbScreen sphere panel
- Sphere raised to `sphereLocalY = 14`; the panel is positioned fully **below** it
  (`panelCY = sphereLocalY − radius − gap − panelH/2`), no overlap.
- `frameless: true` — **no window outline**.
- `buttonsVertical: false` — Keep Private / Place in Space are a **horizontal row**; panel
  width 38cm (≈ the title width) so the row isn't a full 44cm bar.
Verified in Preview.

### Verification & housekeeping
Real-capture chain (tap → analyze → segment → auto-Keep → §4) exercised for items 2 & 3;
seeded Review → autopilot → Feel autopilot → real Gemini journal exercised for items 1, 4,
5, 6; `debugStartState=Orb` for item 7. All debug flags reset (`debugStartState=Launch`,
Review/Feel `debugAutopilot=false`, `debugSeedMoments=false`, MemoryCardSpawner
`debugAutoKeepFirstCard=false`). Compiles clean; clean boot; `FeelScreen.cameraObject` wired
via VirtualScene; project saved.

## Round I — reticle brackets, softer copy, spawn-in-front, Orb placement rework (prompt #35)

### 1. Corner-bracket reticle
`TraceGizmos.makeReticle` rebuilt: four 「」corner brackets (`MeshTopology.Lines`, arm =
32% of the shorter half-dimension, arms point inward) instead of the closed light-blue
rectangle. Same colour / `ReticleOptions` / `setColor`.

### 2. Softer copy
MomentEmotionReflect §4 title `"Pick a feeling right now."` → **"What feeling sits with
you here?"** — gentle, unhurried; this app guides softly.

### 3. PanelKit `buttonScale` + moment-saved fit
New `PanelOptions.buttonScale` (default 1) scales button HEIGHT + label box. Wired through
`relayout` / `applyBtnSize` / `addButton` (all `BUTTON_HEIGHT` uses → `btnH`).
`MomentEmotionReflect.buildSavedPanel`: `buttonScale: 0.82`, `buttonDropCm` 4 → 1 — the
3-button stack now sits inside the box (bottom button had been ~1.4 cm past the edge).

### 4. LaunchScreen spawn-in-front
Added `cameraObject` + `spawnInFrontOfUser()` (yaw-only, mirrors ReviewScreen) + an
`OnEnableEvent` that re-places + rebuilds, so returning Home ("Finish for Now") drops the
menu in front of the user. `started` guard so OnEnable is inert before OnStart.

### 5. ReviewScreen thumbnail moved down
`buildThumb`: `localPos.y` −0.38 → **−0.48 × halfHeight**, `maxH` 0.62 → **0.55 ×
halfHeight** — the image was overlapping the (dropped) reflection line; now it sits clear
below it.

### 6. FeelScreen buttons + gradient
`buttonDropCm: -4` lifts the option stack. New `PanelOptions.buttonGradientFlip` →
`RectFrameOptions.fillFlipU` (mirrors the fill quad's U, `1 - u`) makes this screen's
button gradient run **right-to-left**.

### 7. GenerateScreen spawn-in-front
Added `cameraObject` + `spawnInFrontOfUser()` (OnStart + OnEnable) — the "Composing your
day…" and result panels now appear in front of the user.

### 8. GenerateScreen done panel — tighter + smaller buttons
`headerH` drops the extra `BTN_GAP`; `paragraphH` 34 → 26; `contentGap` 2 → 1.5 — title /
paragraph / reflection read closer (panel height ~64 vs ~78). `buttonScale: 0.82` on the
4-icon row.

### 9-11. OrbScreen "Place in Space" rework
The instruction window + Cancel / Drop-Here buttons are **removed**. New flow:
- **Follow phase** — the sphere detaches and follows the aim ray (the hand's forward ray,
  NOT snapped to a plane), with a **"Pinch to place"** `Text` label riding just above it
  (`showPlaceHint` + `updatePlacementFollow` keeps it camera-facing).
- **Pinch** — device: `GestureModule.getFilteredPinchDownEvent(1)` (the *filtered* variant,
  reliable while the hand is moving — the plain SIK `BaseHand.onPinchDown` used before never
  fired here, which is the "pinch not working" the prompt reported; same GestureModule
  family the capture flow uses). Editor/Preview: a `TapEvent` stands in, camera-forward ray
  drives the follow.
- **Confirm phase** — pinch freezes the sphere and shows a horizontal **Confirm / Reset**
  pair on it (frameless `buttonScale: 0.7` panel anchored at the sphere, camera-facing).
  Confirm → reparent to the always-on holder + save; Reset → drop the spot, resume
  following.
`endPlacement()` tears down the follow + pinch listener + on-sphere UI on Confirm or screen
disable. State: `placing` (following) / `awaitingConfirm` (frozen, Confirm/Reset up).
New copy inputs `placeHintLabel` / `placeConfirmLabel` / `placeResetLabel`; the old
`placeInstruction*` / `placeCancelLabel` / `placeDropHereLabel` inputs are unused.
`debugAutopilotPlace` updated to begin → onPlacePinch → Confirm → Done.

### Verification
Previewed: the 「」reticle; FeelScreen buttons lifted + right-to-left gradient; ReviewScreen
thumbnail clear of its text; GenerateScreen done panel tighter with the small 4-icon row
(real Gemini journal); the Orb follow phase ("Pinch to place" on the sphere) and the
Confirm/Reset pair after the tap-stand-in pinch, then placed-save → Home-in-front, end to
end. `cameraObject` wired on LaunchScreen + GenerateScreen via VirtualScene. All debug flags
reset; the persistent `traceJournal.days` store wiped of debug entries (JarScreen
`debugClearSavedDays`, one-shot); compiles clean; clean boot; project saved.

## Round J — Orb saved panel, Jar month cleanup + hover, orb matte look (prompt #36)

### 1. OrbScreen "Today is folded away." panel
- `buildSavedPanel` `heightCm` 24 → 34 — title / body / single button had been overlapping
  in the short panel.
- New `OrbScreen.spawnInFrontOfUser()` (yaw-only, mirrors ReviewScreen/GenerateScreen),
  called at the top of `buildSavedPanel` so the confirmation reads centred wherever the user
  ended up after Save / placement.
- `doneLabel` default "Done" → **"Okay"** (scene value pushed).

### 2. JarScreen month view
- Footer: `body` `"Pinch a sphere to open that day."` removed (the 0-days empty-state hint
  stays), `frameless: true` — the footer is now just the Back button, no window.
- `buildDaySphere`: the per-sphere tap `Button` gains `onHoverEnter` / `onHoverExit`
  (exposed on UIKit `Button` via `Element`). On hover the sphere's cloned material blends
  65% toward a light yellow (`vec4(1, 0.97, 0.7, 1)`); on exit it restores the stored
  `baseColor`. (Hover is hard to exercise in Preview — code-verified.)

### 3. Orb shader — matte + luminous (partial for prompt #36.3)
The requested white-centre → chosen-colour **radial** gradient is view-dependent (Fresnel)
and there is no camera/view node in the `Vertex Distortion` graph shader, so a true radial
gradient needs a graph-shader edit (add facing node → `mix(white, colour)` → Albedo). Not
attempted yet — pending a go/no-go on editing the 45 KB node graph.

Shipped from code (`OrbLook.applyOrbLook` + 3 new `OrbLook` Inspector sliders
`matteRoughness` / `glowColorAmount` / `glowWhiteAmount`):
- `Port_Roughness_N006` → 0.9 (**matte** — no plastic specular highlight; the "matte paper"
  half of the ask), `Port_Metallic_N006` → 0.
- `Port_Emissive_N006` → mostly the day colour + a little white — the orb reads as a
  luminous matte blob, lit side pushing toward white, grazing edges staying saturated (a
  cheap approximation of the reference look).
Verified matte in Preview (debug preview orb, blue). Radial gradient still to do.

### Verification & housekeeping
Previewed: the fixed "Today is folded away." panel with "Okay" (no overlap, spawned in
front); the Jar month view with no "pinch a sphere" line / frame; the matte blue debug orb.
`OrbScreen.doneLabel` scene value pushed. All debug flags reset; `traceJournal.days` store
wiped of test pollution (JarScreen `debugClearSavedDays`, one-shot). Compiles clean; clean
boot; project saved.

## Round K — Jar caption removal + Jar/Orb spawn-in-front (prompt #37)

1. **JarScreen month-view header** — the `"N days — one sphere each."` body line is gone
   (`""` for N > 0; `"No journals yet."` kept for N = 0).
2. **JarScreen** — new `cameraObject` @input + `spawnInFrontOfUser()` (yaw-only, mirrors the
   other screens) on OnStart / OnEnable; `JarContent` local Y nudged −8 cm so the top header
   clears the FOV now that the root is placed dead-ahead.
3. **OrbScreen** — `spawnInFrontOfUser()` promoted from inside `buildSavedPanel` to the
   OnStart / OnEnable handlers (kept in `buildSavedPanel` too, to re-place after a
   multi-second placement), so the **created-ball window** appears in front of the user, not
   only the saved-confirmation window.

Verified in Preview: Jar month view (month title only, tree centred in front) and the Orb
created-ball window centred in front. `JarScreen.cameraObject` wired. All debug flags reset;
`traceJournal.days` store wiped; compiles clean; clean boot; project saved.

## Round L — reticle bars, Jar FOV fix, orb creature eyes (prompt #38)

### 1. Thick white rounded reticle
`TraceGizmos.makeReticle` — each corner-bracket arm is a solid **stadium** (rounded-end
capsule, one shared triangle mesh + material). New `ReticleOptions.lineWidthCm` (~0.8).
Default colour changed to white; `ScanScreen` passes `color: white` + `lineWidthCm: 0.8`.

### 2. Jar "stuck / journal disappeared" — layout, not data loss
Reproduced the full save→Jar chain in Preview: the day **persists and displays** (`[Jar]
month view built — 1 day(s)`, no errors). The real cause: the Jar tree was ~86 cm tall
(header ~+42, Back button ~-44) and, after Round K placed the root dead-ahead, most of it
fell outside a headset FOV — looks empty, and the Back button is unreachable (a stray tap
lands on it → "went to menu"). Fix:
- `buildMonthView`: compact, vertically-symmetric layout — `headerCY`/`footerCY` derived
  from the grid half-height, header 14 cm, Back button frameless, fit-scale targets ~40 cm
  effective height. Removed the Round-K `content` −8 Y nudge.
- `buildDayView`: `h` 64/40 → 52/34, panel centred at y=0, **dropped the separate
  "Back to Home" footer** (it overflowed) — "Back to month" → the month view's Back button.

### 3. Orb creature eyes
`OrbScreen.buildOrbEyes()` — an `OrbEyes` holder (parented to the screen root, not the
spinning orb) with one `Component.Text` "—        —" (two lines), `EYE_COLOR` near-black,
`depthTest = false` so it always reads over the opaque wobbling orb. `updateOrbEyes()`
billboards it onto the orb's camera-facing surface each frame. Torn down in `destroySphere`
and `finalizePlacement` (the face is for the on-screen moment, not the parked world orb).

### What's left (answer to prompt #38.4)
All 12 MVP priorities are built and working (Home → Scan → Card → §4-§6 → Review → Feel →
Generate → Orb → Jar → persistence). Open / deferred:
- **Orb radial gradient shader** — white-centre → colour-edge needs a Fresnel node added to
  the `Vertex Distortion` graph shader (code can't do view-radial); matte + emissive shipped
  as the approximation.
- **§14 error/fallback polish** (Phase 9) — per-screen error states, offline handling,
  partial-failure recovery are still thin.
- **On-device testing** — hover highlight (Jar), hand-pinch placement (Orb), ASR reflection
  are device-only paths only reasoned about, not run on hardware.
- **Deferred by DESIGN.md** — §7 song screen (fields exist), real spatial anchoring for
  "Place in Space", multi-month Jar navigation, palm-up hand menu.
- **Cleanup** — prune dead `TraceJournalSpike*` / `ConfirmScreen` / `ReflectScreen` /
  legacy `ReflectionCapture` bits and unused `@input`s; the `debug*` inspector flags stay
  (all OFF).

Verified in Preview: thick white 「」reticle, Jar month view fits with the Back button
visible, orb creature face. Debug flags reset; `traceJournal.days` store wiped; compiles
clean; clean boot; project saved.

## Round M — reflection buttons, capture guard/spinner, Jar day stickers, copy/layout (prompt #39)

1. **MomentEmotionReflect** captured-reflection panel — `buttonsVertical: false`; buttons are
   now **Back** (`tryAgain`) / **Confirm** only (dropped Try Again + Skip).
2. **CaptureController** double-fire guard — `debounceSec` 0.8 → 1.6 (scene value pushed);
   device pinch → `getFilteredPinchDownEvent(1)` (filtered = one event on a moving hand).
   The "sometimes doesn't segment" is Gemini's two-call reality (label OK, no mask) → bbox /
   full-frame fallback; not a code fix.
3. **JarScreen day-detail stickers** — new `journalSession` @input (wired). `liveStickersFor(data)`
   returns the day's `KeptTrace`s **only when `journalSession.getEntry().id === data.id`**
   (textures aren't persisted, so only the just-saved day has them). `buildStickerRow` /
   `buildOneSticker` render them polygon-cutout → bbox → full-frame (mirrors ReviewScreen).
   Past days after a restart still show object labels.
4. **ScanScreen loading spinner** — loading panel loses its caption; `buildLoadingSpinner()`
   builds a ~270° arc (MeshBuilder triangles, `markerMat`) parked in the panel centre;
   `onUpdate` spins it while `ellipsisActive`.
5. `buildEmotionPanel` — `contentDropCm: 5` (drop "What feeling sits with you here?").
6. Jar day-detail non-revealed body = object labels only (no "Pinch Reveal journal…" line).
7. Jar month header + day-detail title get `contentDropCm` (2–6) so the month/date text
   reads centred.

### Verification
Previewed: horizontal Back/Confirm reflection panel; the centre arc spinner during
"Finding the memory…"; the Jar month header centred ("September 2026"); the revealed day
view (no pinch line, fits FOV). Day-detail stickers are code-verified only — same-session
live traces vanish on a Preview refresh and inject-taps can't drive Home→Jar. `debounceSec`
+ `JarScreen.journalSession` pushed via scene/VirtualScene. Debug flags reset; store wiped;
compiles clean; clean boot; project saved.

## Round N — Jar reveal overlap, orb eye motion, orb radial gradient (prompt #40)

1. **JarScreen.buildDayView revealed** — the closing reflection was in PanelKit's body band
   (top), overlapping the free-text paragraph. Now paragraph + `\n\n— {reflection}` are one
   wrapped Text block (size 70 → 52, panel h 52 → 58). No collision possible.
2. **OrbScreen eyes** — now a VERTICAL "|      |" `Component.Text`, `size ≈ d * 6` (~2.5x),
   on a child of the billboard holder. `updateOrbEyes()` drives: a vertical bob
   (`sin(t*2.1)`), a slow glance (`sin(t*0.7)`), and a blink (Y-squash to a 0.1 slit over
   ~0.09 s down / ~0.12 s up, every 2–5 s).
3. **Orb radial gradient — DONE in code (no graph edit).** `buildOrbGlow()`:
   `ProceduralTextureProvider.createWithFormat` bakes a 128px RGBA radial gradient once
   (white, alpha 1 at centre → 0 at rim, tight bright core `smoothstep(0.04, 0.82)` `^1.9`).
   A camera-facing quad textured with it (`ImageMaterial`, premultiplied alpha, `depthTest`
   off) is billboarded onto the orb's camera-facing side each frame → white centre, the
   coloured matte orb showing at the rim. `OrbLook.glowWhiteAmount` → 0 (redundant now;
   scene value pushed). The graph-shader Fresnel node is no longer needed.
   Verified in Preview with a blue orb: white core, blue rim, vertical blinking eyes.

Debug flags reset; `traceJournal.days` store wiped; compiles clean; clean boot; saved.

## Round O — capture-centre spinner, 50% reticle corners, round eye ends, keep face after placement, hide "Create Journal" when today saved, revisit real placed balls (prompt #41)

1. **ScanScreen head-locked spinner** — `buildLoadingSpinner()` parents the ~270° arc to
   the Camera Object at local `(0,0,-reticleDistanceCm+1)` (dead-centre of the capture
   frame, was in the loading panel). `ri 2.2 / ro 3.3 / seg 34`. Toggled by `ellipsisActive`
   (post-pinch processing), Z-spun in `onUpdate`. Loading panel shrank to a title band above.
2. **Reticle 50%** — `TraceGizmos.makeReticle` `armFraction` option (default 0.32);
   `ScanScreen` passes `0.16`. Corner brackets half as long. Preview-verified.
3. **Round eye ends** — `OrbScreen` eyes rebuilt as mesh stadium bars (`makeEyeBar`:
   rect + `CAP=7` semicircle caps, triangle fan) filled by a baked 4×4 near-black texture
   through `ImageMaterial` (premultiplied alpha, depth-test off). Same bob/glance/blink via
   `setEyeBar` Y-scale. Preview-verified — clean rounded caps.
4. **Face + glow persist after placement** — `finalizePlacement()` reparents the eye holder
   + glow disc onto the placed sphere with `setParentPreserveWorldTransform` (frozen pose),
   filters that sphere out of `spinners`, and registers it in the new module-level
   `sessionPlacedOrbs: Map<dayId, SceneObject>` (exported from OrbScreen). No longer
   destroyed. Preview-verified — parked orb keeps eyes + white core on Home after Done.
5. **ReviewScreen hides "Create Journal" when today is already saved** — `todayAlreadySaved()`
   scans `traceJournal.days` for an entry dated `JournalEntry.today()`. If found: the
   "Create Journal" footer button is replaced by "Revisit the Month" (→ Jar) and the header
   body reads "Today's journal is already saved." Prevents a second entry for the same day.
6. **JarScreen — revisit the real placed balls** —
   - `pops` tween list on `UpdateEvent` (ease-out cubic, staggered) scale-pops every day
     ball in from ~0.
   - Month view splits `this.days` into `placedDays` (have a live `sessionPlacedOrbs` entry)
     and `gridDays` (everything else). Placed days are NOT drawn in the panel grid — the
     real orb is re-enabled where the user parked it, popped in, and given an invisible
     `Button` tap child (tracked in `placedTaps`; destroyed on teardown — the orb belongs
     to OrbScreen). Grid days pop in as before.
   - `placedFullScale: Map<dayId, vec3>` remembers each placed orb's real scale.
   - `buildDayView` disables every placed orb except the opened day's ("display the chosen
     one only"). `restorePlacedOrbs()` (Back to month / OnDisable) re-enables + rescales all.
   - `deleteDay` also destroys that day's placed orb + prunes both maps.
   - World positions aren't persisted (DESIGN.md defers spatial anchoring), so this only
     applies to orbs placed in the current session; older days still use the panel grid.

### Verification
Preview-verified: rounded eye caps; face + glow stay on the orb after Confirm placement +
Done → Home; 50% reticle corners; Jar month view builds clean (0 errors) after a store
wipe. Code-verified only: the head-locked centre spinner (needs a live capture→vision
round-trip to reach the processing state) and the end-to-end revisit-placed-balls flow
(needs a real in-session placement then Home→Jar navigation, which inject-taps can't
drive). All `debug*` flags reset, `debugStartState` → Launch; `traceJournal.days` wiped;
compiles clean; clean boot; project saved.

### What's left (answer to "after finish those, what's left?")
- **§14 error / fallback polish** — Gemini failure copy, offline capture, ASR-unavailable
  paths are thin.
- **On-device pass** — hover highlight, pinch-to-place, filtered pinch debounce, ASR, and
  the head-locked spinner all need a real Spectacles run (Preview can't drive hands/vision).
- **Revisit-placed-balls** works only for the current session (no spatial persistence —
  deferred by design). Real anchoring is a separate feature.
- **§7 song screen** — still deferred / cut.
- **Multi-month Jar navigation** — only the current month bucket is shown.
- **Dead-code prune** — the old Confirm/Reflect spike scripts, unused `@input`s, and the
  now-removed `EYE_MAT_BASE` path can be cleaned up.
- **Copy / visual polish** — Preview orb placement lands right on the camera (no hand ray);
  fine on device.

## Round P — capture-only loading anim + reticle hide, eyes halved again, persisted Jar stickers, soft UI audio (prompt #42)

1. **ScanScreen — loading arc + capture frame lifecycle fix.** Both overlays are parented to
   Camera Object (so they're truly head-locked), which means ScreenRouter disabling ScanRoot
   doesn't hide them and ScanScreen's `UpdateEvent` stops running off-screen — the arc was
   left lit on the Card screen. New `syncReticle()` (bad name, drives both) is invoked from
   `applyScreen` (incl. the leaving branch), `showLoading`, `showPromptOnly`, `showError`,
   and `onUpdate`:
   - capture frame visible  ⇔  `onScan && !ellipsisActive`
   - loading arc visible     ⇔  `onScan && ellipsisActive`
   `onScan` is set in `applyScreen`. Preview-verified: pinch → corners gone + centre arc;
   card generated → arc gone on Card.
2. **OrbScreen eyes halved.** `buildOrbEyes`: `halfLen` `d*0.16→d*0.08`, cap radius
   `d*0.05→d*0.025` (min 0.2), `eyeGap` `d*0.34→d*0.17`. Preview-verified.
3. **StickerStore.ts (new) — persisted Jar day stickers.** GeneralDataStore is string/int
   only and the frozen-still Textures die on restart, so the Jar day view only had
   thumbnails for the session's own day. Now:
   - `OrbScreen.saveDay` → `persistStickers(entry.id, includedTraces)` base64-encodes each
     still (`Base64.encodeTextureAsync`, JPEG, `MaximumCompression`) into
     `traceJournal.thumbs.<entryId>` as `PersistedSticker[]` (`{order,b64,box?,polygon?}`).
   - `JarScreen.buildDayView`: `liveStickersFor` (in-memory, fast path) → else
     `readStickers(entry.id)` → `buildPersistedStickerRow` decodes each async
     (`Base64.decodeTextureAsync`) and lays it out (positions fixed up front from the record
     count). Shared renderer `buildStickerFromTex` (refactored out of `buildOneSticker`).
   - `prune()` keeps only the 8 most-recent days' blobs (by `date`); runs on every write.
     `deleteDay` calls `removeStickers`; the Jar debug wipe clears `traceJournal.thumbs.*`.
4. **UISound.ts (new) — soft click on every interactable.** Installed the asset-library
   **UI SFX Pack**; `UISound` (on always-on OrbSpawner) holds one `AudioComponent`
   (`bubble_low`, LowLatency, volume 0.5, 50 ms debounce) and exposes `playUISound()`.
   PanelKit's `addButton` / `setTitleTappable` / `setPanelTappable` all call it on trigger
   (so every screen's buttons + tappable panels + card title-edit are covered); JarScreen's
   day-sphere and placed-orb tap Buttons call it directly. The pack's instantiated `UISFX`
   demo object was deleted (assets kept).

### Verification
Preview-verified: reticle corners vanish on pinch + centre arc appears; arc gone on the
Card screen after generation; halved eyes (still round caps); clean boot with
`bubble_low.mp3` loaded, no runtime errors. Code-verified only: the persisted-sticker
round-trip (needs a full capture→journal→save then a Lens restart) and the click SFX
audibly firing (Preview inject-taps land as captures, not PanelKit button hits). All
`debug*` flags reset, `debugStartState` → Launch; `traceJournal.days` + `.thumbs.*` wiped;
compiles clean; project saved.

## Round Q — loading arc appearing on Scan-screen entry (prompt #43)

`CaptureController` fires captures screen-independently, so the pinch that presses "Capture
a Moment" on Home bled through into an `onCapture` the instant `ScanScreen` subscribed —
`handleCapture` called `showLoading()` for a capture the user never intended, so the loading
arc + panel were already up before any deliberate pinch.

Fix (`ScanScreen`): `applyScreen` stamps `scanEnteredAt = getTime()` on the transition into
Scan; `handleCapture` drops any capture within `entryGraceSec` (0.8 s) of that stamp,
logging `capture ignored — within screen-entry grace`. Deliberate pinches (always > 0.8 s
after arrival) are unaffected.

### Verification
Preview: capture injected immediately after landing on Scan → "ignored — within screen-entry
grace", corners stay, no loader; capture injected after the window → arc shows through to
card generation. Compiles clean; `debugStartState` → Launch; project saved.

## Round R — saved panel above the ball, Review 70%, tighter reveal-journal / Jar month (prompt #44)

1. **OrbScreen "Today is folded away" above the placed ball.** `finalizePlacement` stashes
   `lastPlacedWorldPos` + `lastPlacedRadiusCm`. `buildSavedPanel`, when `savedPrivacy ===
   "placed"` and those are set, makes a smaller panel (32×26 vs 40×34) and, after creation,
   sets `panel.root` world transform to `ballPos + (0, radius + halfHeight + 3, 0)` with the
   camera's yaw — the confirmation now hovers just above the parked ball. The private-save
   path is unchanged (still dead-ahead).
2. **ReviewScreen 70%.** `scale = 0.7 * Math.min(1, 112/spanV, 150/spanH)` — the fit math
   still caps to the FOV, then the whole tree is taken to 70%.
3. **JarScreen revealed day view tighter.** panel `h` 58 → 44; `pt.size` 52 → 56;
   `contentDropCm` 3 → 2; journal `layoutRect` narrowed to `-h*0.20 .. h*0.16` so the text
   sits between the title band and the buttons with small gaps.
4. **JarScreen month view spacing.** `headerCY` `+15 → +11`, `footerCY` `+17 → +11` — the
   per-day date caption and the "Back to Home" button now read close to the spheres
   instead of floating far below.
5. **"Is the ball saved?"** — clarified (no code): the journal *entry* and its persisted
   sticker thumbnails (Round P) survive a restart and show in the Jar; the ball's *room
   position* does not (spatial anchoring deferred), so an older day is a coloured sphere in
   the Jar grid. The real placed ball only shows at its spot within the same session.

### Verification
Preview-verified: reveal-journal is more compact with bigger text; month-view date + Back
button sit tight to the spheres; `[Review] built … scale=0.70`. Code-verified only: the
saved panel above the ball (Preview autopilot parks the ball on the camera; the panel is
on-screen ~1 s). Debug flags reset; store + thumbs wiped; compiles clean; project saved.

## Round S — parked balls persist across sessions (prompt #45)

The design deferred spatial persistence; the user asked for it. Pragmatic implementation
(world position + re-spawn, not a persistent spatial anchor):

- **`PlacedOrbStore.ts`** (new, plain module) — `traceJournal.placements` = `PlacedRecord[]`
  (`{id, px, py, pz, scale, colorHex}`). `readPlacements()` / `recordPlacement(id, pos,
  scaleCm, colorHex)` / `forgetPlacement(id)` / `clearPlacements()`.
- **`OrbScreen.finalizePlacement`** — on Confirm, `recordPlacement(eid, lastPlacedWorldPos,
  radius*2, entry.orbColor)` alongside the existing `sessionPlacedOrbs` registration.
- **`PlacedOrbs.ts`** (new `@component`, on the always-on OrbSpawner) — in `onAwake`
  (deliberately before OnStart so `sessionPlacedOrbs` is populated before JarScreen's first
  build), reads the store and for each record that isn't already live this session, builds
  a restored creature-orb: sphere (mesh + `applyOrbLook(colorHex)`), camera-facing glow
  disc, two rounded dark eye bars. `UpdateEvent` billboards the glow + eyes toward the
  camera and runs the bob / glance / blink for every restored orb. Each is put in
  `sessionPlacedOrbs`, so "Revisit the Month" treats it as a real placed ball.
  `@input orbMesh / orbMat / cameraObject` wired to the same assets OrbScreen uses;
  `@input debugClearPlacements` one-shot wipe.
- **`JarScreen.deleteDay`** → `forgetPlacement(id)`; the `debugClearSavedDays` wipe also
  removes `traceJournal.placements`.

Eye-bar / glow-disc recipe is duplicated from OrbScreen (the two texture bakers
`eyeTexture` / `radialGlowTexture` are now `export`ed and shared) — ~60 lines of builder
copied rather than refactoring the working in-session creature code.

**Caveat** (in `PlacedOrbStore.ts` doc): world position is relative to the device tracking
origin, only approximately stable across sessions without a Spatial Anchor. Same-room it
lands close; true anchoring is a separate feature.

### Verification
Two-session Preview test: session 1 → `[PlacedOrbStore] recorded …`; session 2 (fresh) →
`[PlacedOrbs] restored 1 parked ball(s)`, creature-orb back at its spot, and the Jar month
view shows it as the placed orb ("Your placed orbs are around you…") not a grid sphere.
No runtime errors. Debug flags reset; day + thumb + placement stores wiped; compiles
clean; project saved.

## Round T — app-wide font knob, saved-panel spacing, Review-Today-across-sessions (prompt #46)

1. **UI font — one slot.** `UITheme` gains a `font` @input (`Asset.Font`, `@allowUndefined`)
   + `applyFont(t: Text)` export (`_font` synced each frame like the other build-time
   fields). Called at every `createComponent("Component.Text")` site: PanelKit.makeText,
   GenerateScreen.addFreeText, JarScreen (date caption + revealed journal), MemoryCardSpawner
   OCR line, OrbScreen place hint, ReviewScreen tick. Empty slot = LS built-in font.
   Imported **Manrope** via FontSelector and wired it to `UITheme.font`.
2. **`OrbScreen.buildSavedPanel` "placed" variant** 32×26 → 40×38, `titleSize: 110` — the
   title / "Placed in space." / "Okay" stack was overlapping after Round R shrank it.
3. **`LaunchScreen` Review Today across sessions.** `todaysSavedEntry()` reads
   `traceJournal.days` for an entry dated today. `reviewEnabled = moments > 0 ||
   todaysSavedEntry() !== null`. Tap: live moments → Review as before; else saved-today →
   `requestJarDay(id)` + `goTo(Jar)`. `JarScreen` module exports `requestJarDay(id)`; its
   OnStart/OnEnable consume `_pendingDayId` once to open straight to that day's detail view.

### Verification
Preview: Home text renders in Manrope after wiring the slot; cold start with a saved-today
entry logs `[Home] built — moments=0 reviewEnabled=true`. Saved-panel sizing is math-checked
(body bottom ≈ -1.2, button top ≈ -6.4 → ~5 cm gap). Debug flags reset; day + thumb +
placement stores wiped; compiles clean; clean boot; project saved.

## Round U — "Add to Today's Journal" (append new moments to an existing day) (prompt #47)

Once a day's journal was saved, a later capture (esp. in a new session — fresh entry id)
had no way into it, and #42/#46 hid the create path. New append flow:

- **`DayStore.ts`** (new) — `readSavedDays` / `todaysSavedEntry` / `findSavedDay` /
  `findSavedById`. Single owner of `traceJournal.days` reads; Launch/Review private helpers
  fold in.
- **`JournalSession`** — `hydrateForAppend(data)` adopts the saved entry's id (persistEntry
  then upserts) + feeling/colour; `isAppending()`, `getAppendBase()` (re-reads store so
  successive adds stack).
- **`MomentEmotionReflect`** "Moment saved" panel — primary button is **"Add to Today's
  Journal"** when `todaysSavedEntry()` exists (hydrate → Review); else "Create Today's
  Journal". Autopilot step 5 mirrors it.
- **`LaunchScreen`** "Review Today" — new moments + saved-today → hydrateForAppend → Review;
  no new moments + saved-today → Jar day view (Round T behaviour kept). Body line adapts.
- **`GenerateScreen.runGeneration`** — append mode: `entry.generatedJournalText =
  base.text + "\n\n·  ·  ·\n\n" + newParagraph`; title kept; objectLabels / keptOcrText /
  selectedMomentIds merged. Regenerate re-appends onto the *saved* base each time (no
  double-append).
- **`ReviewScreen`** — append mode bypasses the "already saved / Revisit" state; button
  reads "Add to Journal", header "Which of these to add to today's journal?".
- **`StickerStore.persistStickers(id, traces, append?)`** — append keeps existing thumbs,
  adds new ones, caps at 8.
- **`OrbScreen.finalizePlacement`** — destroys any prior ball for the same entry id before
  registering the new one.
- **`JarScreen.buildDayView`** — revealed panel height grows with journal text length
  (>380 chars → +4 cm per 90, cap 62) so an appended entry's text clears the buttons.

### Verification
Two-session Preview run (Review-seed autopilot chain, `debugSeedMoments` also hydrates for
append when today is saved): session 1 saved `trace_…pn19`; session 2 →
`hydrateForAppend -> adopting saved entry trace_…pn19` → generate → `[Orb] persisted — 1
day(s) total in store` (upsert, id = session 1's, NOT a 2nd entry). Jar day view screenshot
shows original + `·  ·  ·` + appended paragraph + reflection. Debug flags reset; day +
thumb + placement stores wiped; compiles clean; clean boot; project saved.

## Round V — Generate-screen overflow on an appended (long) entry (prompt #48)

Not a double-append (Regenerate rebuilds `savedBase + · · · + fresh` from the store, so it
replaces the new part). The bug: `GenerateScreen.buildDonePanel` used a fixed
`paragraphH = 26`, so an appended entry (original + separator + addition ≈ 130 words)
overflowed onto the reflection band and the icon buttons.

- `paragraphH` now grows: `jLen > 620 ? min(52, 26 + ceil((jLen-620)/120)*5) : 26`.
- After building, if `H > 66` the whole panel is scaled `66/H` so a tall (appended) panel
  still fits the FOV.

### Verification
Preview append run stopped on the Generate screen: `[Generate] showing result … words≈133
panelH=68.7`; screenshot shows original / `· · ·` / addition / reflection with the
back·regen·edit·save row clearly separated below — no overlap. Regenerate replaces only the
addition. Debug flags reset; day/thumb/placement stores wiped; compiles clean; clean boot;
saved.

## Round W — paragraph font slot; glow-over-eyes fix (prompt #49)

1. **`UITheme.paragraphFont`** (+ `applyParagraphFont` / `getParagraphFont`, falls back to
   `font`). Applied only to prose: `GenerateScreen.addFreeText` (journal paragraph +
   reflection) and `JarScreen` revealed journal text. `import { applyFont, applyParagraphFont }`.
   Imported **Lora** (serif), wired to the `paragraphFont` slot.
2. **`OrbScreen.finalizePlacement`** reparents the glow BEFORE the eyes now (was eyes then
   glow) so the eyes are the later sibling and render on top of the white core. Plus
   `radialGlowTexture` peak alpha `0.92 → 0.85` with a soft dip for `d < 0.16` — extra eye
   contrast on a bright orb. `PlacedOrbs` was already glow-then-eyes (unchanged).

### Verification
Preview: revealed Jar journal renders in Lora serif while the chrome stays the user's
display font; a freshly-placed orb and a session-restored orb both show dark eyes clearly
over the white glow core. Debug flags reset; day/thumb/placement stores wiped; compiles
clean; clean boot; project saved.

## Round X — Review popup height; placement-phase rework (prompt #50)

### 1. Review popup sat too high (`ReviewScreen`)
The panel already spawns at the camera and rotates yaw-only (upright / vertical to ground),
but the moment-card tree is top-weighted, so the readable mass floated above the sight
line. `rebuild()` now offsets the content holder down by `vDrop = -(headerCY - traceH/2)`
(× the fit scale) after the scale is applied, re-centring the header + cards on the eye
line. Panel stays upright and directly ahead.

### 2. "Place in Space" follow-phase rework (`OrbScreen`)
- **`billboardHint(ballPos)`** — the "Pinch to place" text is parked just above the
  floating ball and re-oriented every frame with `quat.lookAt(camPos - hintPos, up)` (true
  billboard; was fixed-yaw).
- **Fixed pinch↔ball gap** — new module consts `PLACE_MIN_CM = 25`, `PLACE_MAX_CM = 320`.
  `updatePlacementFollow()` builds a target from `placeHitPos || (origin + dir*placeDistanceCm)`,
  clamps its distance from the aim origin into `[PLACE_MIN_CM, PLACE_MAX_CM]`, and eases
  `followPos` toward it (`k = min(1, dt*9)`) before `sphere.setWorldPosition(followPos)`.
- **Curved tether** — `buildPlaceTrace()` makes a `PlaceTrace` child (RenderMeshVisual +
  `UILine.mat` clone, depthTest/Write off, twoSided). `updatePlaceTrace(a, b)` rebuilds a
  camera-facing ribbon along a quadratic Bézier hand→ball with a downward sag control
  point (`mid + (0, -min(30, span*0.16), 0)`), 22 segments, `halfW = 0.35`, world-space
  verts, `MeshBuilder` interleaved `position`(3)+`texture0`(2), `MeshTopology.Triangles`,
  `UInt16`. `hidePlaceTrace()` on pinch-confirm / reset / `endPlacement`.
- **WorldQuery surface snap** — new fields `worldQuery = require("LensStudio:WorldQueryModule")`,
  `placeHitSession`, `placeHitPos`. `ensurePlaceHitSession()` (called from `beginPlacement`)
  creates + `start()`s a hit-test session unless `global.deviceInfoSystem.isEditor()`. Each
  frame `updatePlacementFollow()` runs `placeHitSession.hitTest(origin, origin + dir*PLACE_MAX_CM, cb)`;
  a hit sets `placeHitPos = hit.position + normal*radius` (ball rests ON the surface). No
  hit / Editor → the fixed-distance ray point. Hit-test is async ~5 Hz — the follow reads
  the last cached `placeHitPos`, same pattern as `CaptureController`.

### Verification
`ReviewScreen`: Preview screenshot — moment-card panel centred on the sight line, upright,
directly ahead. `OrbScreen`: full `debugAutopilotPlace` chain ran in Preview with zero
runtime errors (begin → `[Orb] placing — sphere follows the aim ray + snaps to room
surfaces (WorldQuery)` → pinch stand-in → Confirm → `[PlacedOrbStore] recorded
trace_… @ (0,0,-60)` → Home). WorldQuery returns nothing in the Editor (no depth) so the
surface-snap and the near-end-on tether are on-device-only; the billboard hint, the
distance clamp and the ribbon build are code-verified + compile clean. Temporary autopilot
step delays used to catch the follow window (10.0 / 11.2 / 12.4 s) were reverted to
2.2 / 3.4 / 4.6 s.

Debug flags reset (`debugStartState` → Launch, `debugAutopilotPlace` → false, all other
`debug*` already false); `traceJournal.days` + thumbs + placements wiped via JarScreen
`debugClearSavedDays` one-shot; compiles clean; clean boot (`(start) -> Launch`,
`moments=0`, `restored 0 parked ball(s)`); project saved.

### Round X follow-up — placement preview reworked to hand-anchored + surface-only (prompt #50 clarification)

User clarified the intended model: the tether is hand→ball, the ball follows the
hand but can only rest on a real surface, and the pre-pinch follow ball *is* the
placement preview (pinch commits it).

- **`getPinchAnchor()`** (new) — dominant hand `thumbTip`+`indexTip` midpoint
  (`HandInputData`), camera fallback in Editor / when untracked. Both the tether
  `updatePlaceTrace(anchor, ball)` and the WorldQuery `hitTest(anchor, anchor+dir*MAX)`
  now start here instead of `getAimRay().origin` (the targeting locus).
- **`placeLastGoodHit`** (new field, reset in `beginPlacement` / `resetPlacement`) —
  target priority is `placeHitPos (this frame) → placeLastGoodHit → rayFallback`, so
  losing the surface for a frame parks the ball on the last real spot rather than
  flinging it to `placeDistanceCm` in mid-air. Mid-air hover is now only the
  pre-first-hit bootstrap (+ Editor).
- `PLACE_MIN_CM` clamp measured from the pinch anchor.
- Confirm/Reset step unchanged.

### Verification
`debugAutopilotPlace` Preview run: no script errors, `[Orb] placing — preview ball
tracks the hand + rests on the room surface (WorldQuery), tethered to the pinch` →
pinch stand-in → Confirm → `[PlacedOrbStore] recorded trace_… @ (-69.5,-17.8,-80)`
(Editor camera-forward fallback, camera had drifted) → Home. Hand joints + WorldQuery
surface are device-only. Debug flags reset (`debugStartState` → Launch,
`debugAutopilotPlace` → false); `traceJournal.days` + thumbs + placements wiped;
compiles clean; clean boot; project saved.

### Round X follow-up 2 — placement ray/anchor rework + regenerate unifies the appended day (prompt #50 clarifications)

**Placement (`OrbScreen`).** Two device bugs in the previous pass:
- tether "ran to the ground" — raw `thumbTip`/`indexTip` keypoints return the
  tracking origin unless the hand skeleton is fully up.
- ball "not moving along the surface" — the WorldQuery ray *started* at that hand
  point, so it kept falling outside the camera frustum and `hitTest` returned null.

Fix (mirrors `CaptureController`'s working pattern):
- `updatePlacementFollow()` casts `hitTest(camPos, camPos + handDir·MAX)` — ray
  **origin at the camera** (always in frustum), **aimed by the hand direction**.
- `getPinchAnchor()` → `getHandAnchor(camPos, dir)` — returns
  `targetingData.targetingLocusInWorld` (wrist-anchored, reliable; same source as
  `getAimRay`), camera-relative fallback in Editor. Tether + `PLACE_MIN_CM` clamp
  use this.
- `placeLastGoodHit` held when the ray leaves a surface for a frame (kept).
- `updatePlaceTrace` sag `min(30, span·0.16)` → `min(9, span·0.06)`.

**Regenerate unifies (`GenerateScreen`).** `runGeneration(unifyAppend = false)`:
- auto-fire after "Add to Today's Journal" → `unifyAppend=false` → old journal
  kept + new moment(s) joined with `· · ·` (unchanged).
- `regenerate()` → `runGeneration(true)` → `reconstructBaseMoments(appendBase)`
  (saved day's labels+OCR as one synthetic moment, its prose as another) prepended
  to the new moments; `.then` REPLACES `entry.generatedJournalText = result.paragraph`,
  title/reflection from the result. "the old one gone."
- `mergeAppendEvidence(entry, base, traces, newIds)` — label/OCR/id union rebuilt
  from stable `base` + `traces` each call (fixes `keptOcrText` growing on repeat
  regenerates).
- new imports: `JournalEntry, JournalEntryData` from `./JournalEntry`.

**Scene fix:** `GeminiService.model` was `gemini-3.5-flash-preview` (404, model
doesn't exist) — blocked all generation. Set to `gemini-3-flash-preview`.

### Verification
Two-session Preview autopilot (Review-seed → Feel → Generate → Orb-place chain):
session 1 saved a day; session 2 `hydrating for APPEND` → first gen 133 words
(old + `· · ·` + new) → autopilot Regenerate → `generateJournal start — 5 moment(s)`
→ `OK :: title="Quiet Corners and Ceramic Mugs"` → `showing result — words≈48`
(133-word glued text replaced) → Save → `[Orb] persisted — 1 day(s) total in store`
(upsert). Zero script errors. Placement ray/anchor/hold changes are device-only
(Editor has no depth or hand joints) — compile-clean + full autopilot ran clean.
Debug flags reset; `traceJournal.days`/thumbs/placements wiped; clean boot; saved.

### Round X follow-up 3 — placement uses hand keypoints; popup heights matched to the prior window; edit-panel overlap (prompt #50 clarifications)

**Placement (`OrbScreen`) — "following the eyes not the hand".** Root cause:
`getAimRay()` / `getHandAnchor()` used `hand.targetingData`, which is `null`
unless the SIK interactor stack populates it — this project doesn't run that
stack, so the aim silently fell back to the camera-forward ray and the tether
anchored near the floor. Fix:
- new `getHandPose(camPos)` — reads the dominant hand's TRACKED KEYPOINTS
  (`getPalmCenter()` → `middleKnuckle` → `wrist` for pos; `indexKnuckle`→`indexTip`,
  else `wrist`→`middleKnuckle`, else `camera`→hand for dir). Backed by
  `ObjectTracking3D`, works whenever hand tracking is on. `null` in Editor / when
  untracked.
- `updatePlacementFollow()` casts `hitTest(hand, hand + dir·MAX)` (ray FROM the
  hand) and `updatePlaceTrace(hand, ball)` (tether FROM the hand). `getHandAnchor`
  removed.

**Popup vertical placement — match the "previous window" (MomentEmotionReflect,
camera-local y ≈ −4).**
- `ReviewScreen`: `scale` factor 0.7 → 0.55; content Y now anchors the header's
  TOP edge `HEADER_TOP_CM` (9) above the sight line (`contentY = HEADER_TOP_CM -
  (headerCY + headerH/2)·scale`) instead of the old `vDrop`.
- `FeelScreen`: fit cap `58 → 50`; `contentY = 12 - (feelingsH/2)·scale` anchors
  the panel's top edge just above the sight line (was a flat `-6`).
- `GenerateScreen`: loading / error / edit-prompt / edit-captured panels
  `localPosition.y` `0 → -6`.
- Scene: `FeelScreen.promptText` `"Today felt…"` → `"Today felt"`.

**Edit-panel overlap (`GenerateScreen.buildEditPanel`).** Title / body / vertical
button stack overlapped in the 40- and 50-cm panels. `heightCm` 40 → 54 (prompt)
and 50 → 56 (captured), plus `buttonScale: 0.82` on both — clears the stack off
the body text.

### Verification
Preview screenshots: Review at scale 0.55 (header + 3 cards + 2 buttons all in
frame, on the sight line); Feel showing "TODAY FELT" with no ellipsis, whole
panel in view; Generate loading "COMPOSING YOUR DAY …" sitting just below centre.
Review→Feel→Generate autopilot: no script errors. Hand-keypoint placement is
device-only (Editor has no hands) — compile-clean, autopilot place chain clean.
Edit-panel gap geometry-verified. Debug flags reset; `traceJournal.days` /
thumbs / placements wiped; clean boot; project saved.

### Round X follow-up 4 — confirm-UI billboard; Editor cursor-follow preview; tether device-only (prompt #50)

**`OrbScreen` Confirm/Reset + hint facing away.** `faceHolderAtSphere` (yaw-only,
build-time) → `orientConfirmHolder()` called every frame while `awaitingConfirm`:
positions the row under the frozen ball, rotation = `cameraObject` world
rotation (screen-aligned, no `lookAt` flip). `billboardHint` switched from
`quat.lookAt(camPos - pos, up)` to the camera's world rotation too (lookAt with
world-up flips when looking straight down at a floor-level ball).

**Editor cursor-follow.** New `editorCursor: vec2`, updated from `TouchMoveEvent`
/ `TouchStartEvent` (Editor only). `updatePlacementFollow()`: when `getHandPose()`
is null and in the Editor, `camComp.screenSpaceToWorldSpace(editorCursor,
placeDistanceCm)` gives the target and the ball eases to it — preview follows the
mouse at a fixed distance (device still uses the hand + WorldQuery).

**Tether device-only.** `buildPlaceTrace()` early-returns in the Editor;
`updatePlacementFollow` only calls `updatePlaceTrace()` when `hp` (hand) or
`placeLastGoodHit` (surface) is driving. Editor = cursor-follow, no line.

### Verification
Preview screenshot of the confirm phase — Confirm / Reset square-on and readable.
`debugAutopilotPlace` chain: no script errors, Editor unproject branch clean.
Cursor-follow is interactive-only (no mouse injection in this harness) —
compile-clean, path runs. Debug flags reset; autopilot step delays restored
(3.4 / 4.6); stores wiped; clean boot; project saved.

### Round X follow-up 5 — placement UI billboards track camera POSITION, not just rotation (prompt #50)

`quat.fromEulerAngles(0,yaw,0)` and (follow-up 4) copying the camera's world
rotation both only track head *rotation* — stepping past the ball, or an euler
flip under pitch, left the Confirm/Reset row, the "Pinch to place" label and the
"Today is folded away." panel facing away.

New `OrbScreen.faceCameraFlat(t, worldPos)`: per-frame
`t.setWorldRotation(quat.lookAt(flatten(camPos - worldPos), vec3.up()))` — the
same camera-facing convention as `updateOrbEyes` (which has never mis-faced),
flattened to stay upright / avoid the look-straight-down gimbal flip. Wired into
`onUpdate` for `orientConfirmHolder` (while `awaitingConfirm`), `billboardHint`,
and the placed-ball saved panel (`savedPanelRoot` / `savedPanelAnchor`, cleared
in `teardownPanel`).

### Verification
Preview default camera: Confirm / Reset square-on and readable. Editor-camera
orbit can't exercise it (script reads the fixed scene Camera Object). Same
`lookAt(camPos - pos)` as the working orb-eye billboard. Compile-clean; autopilot
place chain clean. Debug flags reset; autopilot delays restored (3.4 / 4.6);
stores wiped; clean boot; project saved.

### Round X follow-up 6 — WorldQueryHit-based placement; Jar day panel spawns above the tapped ball (prompt #50)

**`OrbScreen` — placement rebuilt on the Asset Library WorldQueryHit package.**
Installed `WorldQueryHit.lspkg`; deleted its auto-instantiated
`World_Query_Hit_Example` object.
- `ensurePlaceHitSession()` → `createHitTestSessionWithOptions({filter:true})`.
- `updatePlacementFollow()` → SIK hand-ray interactor
  (`SIK.InteractionManager.getTargetingInteractors()`), cast
  `hitTest(startPoint(+3cm), endPoint)`, rest on `hit + normal*radius`; hold
  `placeLastGoodHit` on a miss; `placeDistanceCm` hover before first hit / Editor.
- Drop = interactor trigger-release edge (`InteractorTriggerType` → None) with a
  0.4 s arm delay + "saw trigger held" guard. `GestureModule` pinch field,
  `subscribePinch`/`unsubscribePinch`, `getHandPose` deleted;
  `subscribePlaceTap` (Editor TapEvent) kept.
- Visible tether hand→ball from `interactor.startPoint` every frame
  (`updatePlaceTrace`, `halfW` 0.35→0.7). Editor: cursor follow, no tether.
- Imports: `SIK`, `{ Interactor, InteractorTriggerType }`.

**`JarScreen` — day journal above the pressed ball.** New `lastTapWorldPos` /
`lastTapWorldRadius`, set in both tap handlers (grid sphere + room-placed orb)
before `openDay()`. `buildDayView()` positions `panel.root` in world space above
that ball (bottom edge just clear of it), clamped: X within ±22 cm of the camera
X, panel top ≤ camera Y + 24 cm. Null (opened via `requestJarDay` / "Review
Today") → panel stays centred. Reset at the top of `buildMonthView` and in the
`_pendingDayId` branches.

### Verification
`debugAutopilotPlace` Preview run: clean on the new SIK/WorldQuery path, no
errors (device-only interactor path; Editor uses the cursor fallback). Jar:
`debugSeedDays` + `debugOpenFirstDay` → `[Jar] day view built … above-ball=true`,
screenshot confirms the panel floats above the ball's position. Debug flags
reset; example object removed; stores clean; boot clean; project saved.

### Round X follow-up 7 — first-capture sticker race; window heights; WorldQuery placement proof (prompt #50)

**`ScanScreen.onAnalyzeSuccess` — first capture no cut-out.** `spawnCard`'s
`if (done) return` discarded a `segmentPrimary` result that arrived AFTER the
`SEG_SPAWN_TIMEOUT_SEC` safety timeout had already shown the card (common on the
cold first call). Now the late result upgrades the live card via
`applySegmentation` (re-finds the card, reaches an already-kept trace).
`SEG_SPAWN_TIMEOUT_SEC` 10 → 16.

**Window heights — top-anchored to the sight line.** `HEADER_TOP_CM ≈ 9`:
- `GenerateScreen.buildDonePanel`: `panelY = 9 - (H/2)*s`, scale cap 66 → 60.
- `ConfirmScreen`: `contentY = 9 - (headerCY + headerH/2)*scale`.
- `ReflectScreen`: `content.y = 9 - panelH/2`.
- `OrbScreen.buildSavedPanel`: non-placed `localPosition.y = 9 - savedH/2`.
(Review/Feel already done; Scan reticle title intentional.)

**Placement = WorldQueryHit (proof).** Confirmed no `GestureModule` pinch /
`subscribePinch` / `getHandPose` remain. `WorldQueryHit.lspkg` in `Packages/`;
`WorldQueryModule` is a code `require` (no scene object). Added
`[Orb] WorldQuery hit-test session started` on begin and a throttled
`[Orb][WorldQuery] follow — interactor/session/hit` diagnostic in
`updatePlacementFollow`.

### Verification
Generate done-panel screenshot: title + paragraph + reflection + 4 buttons all
in frame. `debugAutopilotPlace` clean; Editor logs `interactor=no session=no`
(no SIK hand / depth in Editor — device: yes/yes/surface). Sticker fix is
logic-only in Editor. Debug flags reset; stores wiped; clean boot; project saved.

### Round X follow-up 8 — placement follows the SIK cursor in Preview, not just the camera (prompt #50)

`OrbScreen.updatePlacementFollow` had `isEditor() ? null : getPlaceInteractor()`,
so in Preview it fell back to a camera-forward unproject (head-only). SIK's
`MouseInteractor` (which drives the Preview cursor + pinch dot) is registered in
the Editor and its ray follows the mouse — so:
- drop the `isEditor()` gate; `getPlaceInteractor()` is called always.
- `getPlaceInteractor()`: no longer requires `isTargeting()` (MouseInteractor
  only reports it while held); first `isActive()` interactor with
  `startPoint`/`endPoint`, from `getTargetingInteractors()` then
  `getInteractorsByType(All)`.

The follow ball is now positioned by the interactor's ray, so SIK shows its
cursor during placement (same dot as on UI buttons).

### Verification
Preview placement + injected cursor moves: `[Orb][WorldQuery] follow` diagnostic
went `interactor=no` → `interactor=yes`; screenshot shows the ball tracking the
cursor. Autopilot place flow clean. Flags reset; delays restored; stores wiped;
clean boot; saved.

### Round X follow-up 9 — saved panel spawns in front; 20 cm gesture→ball trace (prompt #50)

- `OrbScreen.buildSavedPanel`: removed the `placedNearBall` above-the-ball
  positioning; "Today is folded away." now spawns in front of the player
  (`spawnInFrontOfUser` + top-anchor) like the other windows. Placed ball
  unchanged.
- `PLACE_TETHER_CM = 20`. `updatePlaceTrace` → straight camera-facing ribbon,
  `min(20, dist)` long, from the pinch point toward the ball. `buildPlaceTrace`
  builds in the Editor too; in the Editor the trace anchor is offset
  down-right of the cursor (the Preview "hand" is the camera) so it's visible in
  recordings. Drawn while a gesture interactor drives the follow.

### Verification
Preview: cursor drives the ball, short line ribbon renders toward it (near-end-on
in Editor). `debugAutopilotPlace` clean; saved panel builds in front. Flags
reset; delays restored; stores wiped; clean boot; saved.

## Round Y — remaining MVP items (prompt #51: no device test, no song screen)

**§12 multi-month Jar navigation.** `monthKey(iso)` helper; `JarScreen.monthKeys`
/ `monthIdx`. `buildMonthView` buckets `days` by month, renders one month, and
adds a `[Prev] [Back] [Next]` footer (dim at ends, hidden if 1 month).
`monthIdx = -1` on fresh open → newest; kept across month↔day. Placed orbs
outside the browsed month are hidden. `debugSeed` extended to Aug+Sep.

**§14 hung-request fallbacks.** `GEN_WATCHDOG_SEC` / `ANALYZE_WATCHDOG_SEC` = 55.
`GenerateScreen.runGeneration` + `ScanScreen` analyzeTrace: DelayedCallbackEvent
watchdog → error panel / clear busy state if the promise never settles; `.then`
/`.catch` guarded by a `settled` flag.

**Not done (intentional):** §7 song screen (cut); real spatial anchoring
(persistence stand-in kept); palm-up Jar menu (device-only); orb gradient shader
(graph edit); `TraceJournalSpike*` prune (inert, risk).

### Verification
Full autopilot chain (Review→Feel→Generate→regenerate→Orb) clean. Jar Preview:
month label + filtered count + dim states correct. Flags reset; stores wiped;
clean boot; saved.

## Round Z — orb view-radial gradient (prompt #52)

Graph-shader Fresnel is unsafe to author blind. Instead: `tintedOrbGradient(hex)`
in OrbScreen — per-colour 128px RGBA bake (cached), white→bright-day-colour by
`d≈0.42`, alpha `1 → 0` over `d 0.5→0.94`, centre dip for the eyes. Used by
`buildOrbGlow(hex)` and `PlacedOrbs.buildGlow(d, hex)` (fallback to the old white
`radialGlowTexture`). Camera-facing disc, so it's a real view-radial white-core
→ colour-edge gradient without touching the graph.

### Verification
Preview Review→Feel→Generate→Orb: no errors; #5B8DEF orb shows white core →
blue rim → clean edge, eyes legible. Flags reset; stores wiped; clean boot; saved.

## Round AA — glow 50%, saved panel above ball, faster segmentation (prompt #53)

- `OrbScreen.tintedOrbGradient`: `GLOW_ALPHA_SCALE = 0.5` on the baked alpha.
- `OrbScreen.buildSavedPanel`: restored `placedNearBall` — "Today is folded away."
  anchored above `lastPlacedWorldPos` + `faceCameraFlat` per frame (kept-private
  still front-anchored). Reverses #51's "in front of the player".
- `GeminiService.segmentPrimary`: `SEGMENT_MODEL = "gemini-2.5-flash-lite"`,
  `encodeJpg(..., CompressionQuality.LowQuality)`, 2→3 attempts — so the cut-out
  call lands inside RSG's deadline more often (the "raw capture, no sticker"
  cause). `encodeJpg` gained an optional quality arg.

### Verification
Autopilot Review→Feel→Generate→Orb+place: clean; glow visibly softer; `[Orb]
"Today is folded away" spawned above the ball`. Flags reset (`debugPreviewOrb`
was stray-on); stores wiped; clean boot; saved.

## Round AB — Jar reveal-journal distance + height (prompt #54)

`JarScreen.buildDayView` above-ball block: instead of `(ball.x, py, ball.z)`,
place along the camera→ball horizontal bearing at `max(dist, READ_CM=85)`, so a
close ball no longer puts the panel in the player's face. Vertical gap bumped
(`ball.y + radius + halfHeight + 10`), FOV-top cap `camY + 32`.

### Verification
Preview seeded day, auto-open+reveal (temp hook for `lastTapWorldPos`): clean,
`above-ball=true`, panel at readable distance + above the ball. Hook reverted;
flags reset; stores wiped; clean boot; saved.

## Round AC — a sapling on every orb (prompt #55)

New `Assets/Scripts/Sapling.ts`: procedural stick-and-leaves plant (tapered stem
quad + up to 5 diamond leaves, unlit alpha `ImageMaterial.mat` clones, depth-test
off). `momentCountToStage(n) = min(5, floor(n))`. `sessionOrbStage` Map remembers
per-day stage so a re-open animates prev→new. `buildSapling(parent, dCm,
{scaleMul?})` → `{ setStage, snapToStage, place(spherePos,radiusCm,camPos?),
update(dt), destroy }`. Stem full-length by growth≈0.55; leaf `i` unfurls over
`[i/5 .. (i+1)/5]` with ease-out-back.

- **OrbScreen** (animated): `buildOrbSapling` in `buildSpherePanel` —
  `snapToStage(min(prev,stage))` + `setStage(stage)`; `onUpdate` place+update;
  `finalizePlacement` reparents onto the placed sphere (frozen); `destroySphere`
  frees it.
- **PlacedOrbs**: `buildRestored` — stage from `findSavedById(rec.id)
  .selectedMomentIds.length`, `snapToStage`, `scaleMul 1.25`; driven by the
  existing per-orb update loop.
- **JarScreen**: `buildDaySphere` — stage from `entry.selectedMomentIds.length`,
  `scaleMul 1.6`, `snapToStage`, static (dies with the day holder).
  `surfacePlacedOrb` untouched (those orbs carry their own sapling already).

### Verification
Autopilot Review(3)→Feel→Generate→Orb: `sapling — stage 0 -> 3`; tree = Stem +
Leaf1-3 on, Leaf4-5 off. Jar `debugSeedDays`: grid saplings stage 2/1/2 for the
3 September days. No compile/runtime errors. All debug flags reset; stores wiped;
clean boot; project saved.

## Round AD — sticker cut-out via PNG-mask trace; sapling append-growth + softening (prompt #56)

- **GeminiService**: `SEGMENT_MODEL` `gemini-2.5-flash-lite` → `gemini-2.5-flash`;
  current Gemini models answer `mask` with a base64 PNG, not a polygon, so the
  cut-out had silently degraded to the bbox rectangle. New `maskPngToPolygon` +
  `traceMaskContour` (Moore-neighbour boundary trace of the decoded PNG) turn the
  mask into the ~24-pt image-space polygon the downstream cut-out + StickerStore
  already expect. `parsePolygonMask` also tolerates a stringified array.
- **OrbScreen.buildOrbSapling**: animate from
  `max(sessionOrbStage, saved-on-disk moment count)` → new count, so appending
  captures to an existing journal grows the sapling by the number added
  (`stage 1 -> 4, savedPrev=1`).
- **Sapling.ts**: `roundLeafMesh` (soft blade) replaces the diamond; muted
  sage/spring-green tints; idle stem lean + per-leaf rustle via a `swayT`
  accumulator; taller stem + higher leaves + higher root anchor so leaves clear
  the orb.

### Verification
Live capture → `mask PNG 256x256 traced -> 24 outline pts` → `CUTOUT (polygon,
24 pts)`. Append autopilot → `sapling — stage 1 -> 4`. No compile/runtime
errors. Flags reset; stores wiped; clean boot; project saved.
