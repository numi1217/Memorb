# Trace Journal — CLAD Prompt Log

A verbatim record of the prompts given to the Lens Studio CLAD agent while building
Trace Journal, with a one-line note on what each produced. Newest at the bottom.

Build plan and phase status: `BUILD_PLAN.md`. Full spec: `DESIGN.md`.

---

## Session 1 — 2026-09-03 / 04

### 1. Plan the build order
> Plan the build order — sequence the MVP's 12 priorities into an incremental, testable build

→ Produced the phased plan in `BUILD_PLAN.md` (architecture spine + Phases 0–9, each with
an exit check).

### 2. Start building (no 5.15 downgrade)
> not downgrading this time, and now you can start building

→ **Phase 0** — foundation + de-risking spikes. Installed Remote Service Gateway; created
`FlowManager`, `JournalEntry`, `GeminiService`, `PanelKit`, and Spike A/B/D/E scripts.
Verified capture, Gemini round-trip, persistence, ASR wiring.

### 3. "frozen after i pinched"
> it said frozen after i pinched, what happend

→ Diagnosis: `GeminiService.analyzeTrace` threw `LowOcr` on images with no text (the Preview
camera sees no text), and the log-only spike showed nothing. Fix: no-text is a valid result
with a soft `ocrUncertain` flag, not an error.

### 4. yes
> yes

→ **Phase 1** — the vertical slice. `ScreenRouter`, `LaunchScreen`, `CaptureController`,
`ScanScreen`, `MemoryCardSpawner`, `TraceGizmos`. Pinch → freeze + marker → "Finding the
memory…" → Gemini → spatial Memory Card.

### 5. Laggy label + misplaced card + bad line
> now i have two problems: 1. the detected label is laggy. when i scanned the second obj, the
> logger showd the first object label. 2. the spawned page is not next to the object. and the
> line looks stretched from the circle, not a straight line.

→ Fixes: `ScanScreen` `inFlight` gate replaced with concurrent analyses (each result bound to
its own capture); `CaptureController.computeMarkerPos` made async (WorldQuery callback is not
synchronous); `makeGlowLine` changed from a stretched sphere to a box mesh; Memory Card
billboards to the camera.

### 6. "i cant scan anything now"
> i cant scan anything now

→ Diagnosis: stuck on the Launch screen — the two welcome buttons were sized by label length,
overlapped, and clipped the panel. Fixes: equal-share button widths; `BackPlate` style
`dark → simple` for contrast; a 5 s capture watchdog so a stalled capture can't lock scanning.

### 7. Mismatch + Gemini 3.5 Flash?
> the scanned object, title, and picture are still mismatch sometimes. but the detection is
> quick now, thank you. i also wonder if it's doable that using gemini 3.5 flash?

→ Ran a model probe: no "Gemini 3.5", but `gemini-3-flash-preview` works and is faster
(~4.5 s vs ~14 s). Switched the default. (Mismatch cause found next prompt.)

### 8. Second scan shows the first object
> why there's no Gemini 3.5 Flash?
> and it's still mismatch sometimes. what's the problem?
> in second time i scanned the speaker, but it said the turntable still. (look at the logger
> after 23:02:42)
> and the captured image showed the first image, totally same.

→ Root cause: `CaptureController.getLiveCameraTexture` removed its frame listener after the
first frame, so the camera texture stopped updating and every later capture re-froze frame 1.
Fix: keep a permanent frame listener and wait for a fresh frame per capture. (Gemini
versioning: 1.0 → 1.5 → 2.0 → 2.5 → 3, no 3.5.)

### 9. Wireframe restyle
> okie i think it works now, thank you. now can you make the ui used white outline instead of
> half tranparent window. applied to the btn boudaries also. and wite totally transparent
> backgourd. also, i want to make the line connect to the window outline directly. insteand of
> connect to the back of the window. also, you could make the window smaller, the label could
> be larger, there are too many blank space now.

→ `makeRectFrame` (white outline, transparent interior, replaces `BackPlate`); buttons get
their own outline; connector lands on the panel edge; smaller panels; bigger text.

### 10. 5× labels + rounded corners
> make the label text much more bigger, around 5 times, and add round corner (20%) to every
> box boundaries.

→ `makeRectFrame` gains rounded corners (`cornerFraction`, default 0.2). PanelKit rewritten
without UIKit FlexLayout (hand-computed layout); text uses `sizeToFit`; card buttons stack
vertically. (Debugging the "code default ignored" issue: an `@input`'s stored scene value
wins over the `.ts` default once the component exists.)

### 11. Fill, rounder buttons, coplanar diagram, pop animation
> make the background has 10% transparency and the text of btn become smaller. the btn round
> cornoer should be rounder than the memory card. also add a smooth transision animation when
> the memory card pop up. the connection line should also bewhte, and in the same plane as the
> memory card. so maybe cosider spawn the memory card from the extension of the sphere (so
> sphere, line, and memory card are all in the same plane)
>
> then we can move to the next phase

→ `UIFill.mat` (10% backing fill); button `cornerFraction 0.5`; smaller inset button labels;
white in-plane connector; `MemoryCardSpawner` builds a shared plane through the sphere and
pops the card out from it with an ease-out tween.

### 12. Fill to 25%, then Phase 2
> the background is too transparent for me now, add it to 25%. then starting phase two. btw,
> i need to generate a clad prompt md file to record my prompt

→ `FILL_COLOR` alpha 0.10 → 0.25. This file created. **Phase 2** (card actions & multi-capture)
built: `JournalSession`, Keep/Remove/Change-Label wired, "Add Another Trace / Create Today's
Journal" branching, `ScreenRouter` one-screen-at-a-time.

### 13. Expose background opacity in the Inspector
> make me adjust the background opacity in inspector

→ New `Assets/Scripts/UITheme.ts` — a `backgroundOpacity` slider component on
`TraceJournal/UITheme` that live-drives every wireframe fill's alpha. (Hit the LS
`@hint` "must be a single string literal" compiler quirk.)

### 14. Slider does nothing / use a UI panel?
> the background color doesnt change at all. or should you use the ui panel and render the
> outline

→ The slider mechanism was fine (logs showed it reading the value); the fill was **pure
black**, so alpha changes were invisible against a dark backdrop. Changed `FILL_COLOR` to a
dark neutral so the slider produces visible change.

### 15. Make the fill black again; next step; keep this log updated
> just make the fill color black
> and what's the next step
> just an heads-up, rememer to update the prompt md file everytime i prompted

→ `FILL_COLOR` back to `(0,0,0)` per request (opacity change stays subtle by nature). Next
step confirmed: **Phase 3** — evidence confirmation (DESIGN.md §4). This log will be updated
on every prompt from here on.

### 16. Actually make the fill white; start Phase 3
> oh i meant make the color white, i forgot the black is totally transparent
> and yes start phase 3

→ `FILL_COLOR` → `(1,1,1)` (white frosted panel — the slider is now visibly effective; the
scene's `backgroundOpacity` had also been stuck at 0). **Phase 3** (evidence confirmation, §4)
built: new `ConfirmScreen.ts` — per-trace label confirm + per-OCR-fragment Keep/Remove +
opt-in date/location + re-pick primary + Back to Scanning / Confirm and Continue → writes to
the `JournalEntry` and advances to Reflect.

### 17. Next phase; is OCR working?
> ok next
> so is ocr working now

→ OCR: the pipeline is fully wired (Gemini `text` → card → Confirm fragments → entry) and
Phase 0 proved Gemini's OCR is strong. But every Preview capture logs `textLen=0` because the
LS Preview camera has no text in frame — real OCR needs a device camera or a webcam/image
with text. **Phase 4** (reflection §5 + feeling §6) built: `ReflectScreen.ts` + `FeelScreen.ts`.

### 18. Restructure the routine (design v2) — revise Phase 1 only, small steps
> [full revised UX flow pasted] … Move emotion selection to each object … Separate capturing
> from journal composition (Capture a Moment / Review Today) … Allow one object … Ask the
> reflective question immediately … Make the archive private by default … Remove music from
> the MVP … One sphere = one day.
> just start revising the phase1 for now. dont do too much works at once

→ `DESIGN.md` rewritten (v1 → `DESIGN_v1.md`); `BUILD_PLAN.md` gains a "Design v2 restructure"
section. Then a **focused Phase 1 v2 revision**: Launch → **Home** (Capture a Moment / Review
Today, Review disabled at 0 moments); capture copy → "Hold still while I capture this moment";
object card buttons → **Keep / Retake / Remove**; tappable title for label edit; background-removed
cut-out thumbnail (bbox crop first). Emotion/reflection-per-moment and Review Today are LATER.

### 19. Per-moment emotion + question; real segmentation mask
> yes, do next step please.
> and, also try to do the Object segmentation mask for Background-removed object thumbnail.
> using the tech here: https://ai.google.dev/gemini-api/docs/image-understanding

→ Next pass builds **§4 per-moment emotion** ("How does this make you feel right now?" —
Happy/Peaceful/Difficult/Surprising) + **§5 emotion-specific reflective question** (voice/keyboard,
"A few words are enough") right after Keep, storing emotion + colour + reflection on the moment,
then §6's "Moment saved / Capture Another / Finish for Now / Create Today's Journal" panel.
Plus a **real Gemini segmentation-mask cut-out**: request `box_2d` + `mask` (base64 PNG per the
Gemini image-understanding docs), `Base64.decodeTextureAsync` → alpha mask, composite via an
unlit `opacityTex` material; falls back to the bbox crop then the full frame.

### 20. Finish the background-remove part, then stop
> [pasted the full v2 flow again, near-identical to #18/#19 with minor copy tweaks]
> now finished the background remove part
> and finish that, stop and tell me what to do next

→ The Phase-19 builder had hit its session rate limit mid-run (no final report) but had already
written nearly everything to disk. Finished directly rather than re-spawning: recreated
`Assets/Materials/ImageMaterial.mat` (the interrupted session deleted it without recreating it —
would have broken thumbnails/icons on 3 scripts), added a missing retry to
`GeminiService.segmentPrimary`. **Part A (§4-§6) verified complete** — real hand-pinch on
"Peaceful" produced the correct emotion-specific question. **Part B (segmentation) is fully
implemented with a clean 3-tier fallback**, but Gemini's segmentation response has never once
beaten the Remote Service Gateway's ~30s request deadline in this Preview environment across 3
test runs (`Deadline Exceeded` / connection-termination) — `analyzeTrace` on the same image
succeeds in 5-8s, so it's specific to the heavier segmentation call. Every card still gets a
good thumbnail via the bbox-crop fallback. Stopped here per the request; see BUILD_PLAN.md for
options if segmentation is worth revisiting, and the suggested next pass (§7 Review Today).

### 21. Why did segmentation fail? Try the thinking-budget fix
> why the segment failed?
> try that one change, try to make the segmentation works

→ Diagnosis pass: added per-attempt timing to `segmentPrimary` and re-tested. Both attempts hit
`Deadline Exceeded` at **exactly 30.06s / 30.07s** — precise enough to confirm a fixed RSG
client-side transport deadline, not model "thinking" time. Tried the suggested
`thinkingConfig: { thinkingBudget: 0 }` fix: **no change**, same ~30.0s cutoff. Reported the
null result plainly rather than guessing further.

### 22. Redirect: use Gemini's polygon segmentation, not a PNG mask
> [pasted Gemini segmentation docs + recommended process: capture → ask for label/box/polygon →
> use the polygon to build an alpha mask → crop to bbox → display the cutout] "Use this prompt:
> Identify the main object in the centre of the image. Return only valid JSON: {"label": ...,
> "box_2d": [ymin,xmin,ymax,xmax], "mask": [[x1,y1],...]}. Coordinates must be normalized from 0
> to 1000... The easiest implementation is: Spectacles image → Gemini returns polygon mask →
> Backend applies mask and creates transparent PNG → Lens displays PNG as the object thumbnail"

→ Root cause found: the 30s deadline tracks **output token volume**, not generation time — a
base64-PNG mask needs thousands of output tokens; `thinkingBudget:0` only skips reasoning
tokens, never touched it. Rewrote the pipeline around the user's polygon prompt, but instead of
a backend PNG step, triangulated the polygon into an actual cut-out **mesh** (ear-clipping in
`TraceGizmos.triangulatePolygon` + `makePolygonCutout`, sampling the captured still directly via
per-vertex UVs) — no backend, no raster mask, nothing to decode. `segmentPrimary` now completes
in **2.87s–4.02s**, well under the deadline. Found and fixed two more bugs during verification:
Gemini's `mask` points are actually `[y, x]` (matching `box_2d`'s order), not `[x, y]` as the
prompt's own field names suggest — reading them backwards silently produced a mirrored,
self-intersecting "bowtie" outline; and the cutout mesh was invisible from the front (backface
culling from the local Y-flip) — fixed by making its material two-sided. Verified in Preview
with a real capture: a correctly shaped stool/chair cutout on the Memory Card, screenshotted.
See BUILD_PLAN.md for the full writeup.

### 23. Build §7 Review Today
> yes

→ New `ReviewScreen.ts` (DESIGN.md §7): lists every kept moment chronologically (thumbnail,
label, emotion swatch, capture time, reflection snippet) with Include/Exclude · Change label ·
Remove controls, a live "(N/5 selected)" count, and a Continue gated to 1–5 selected. New
`JournalSession.includedInJournal` field + `setIncluded()`/`includedOrders()`. Wired onto the
existing empty `ReviewRoot` object via a new dedicated `ScreenRouter.reviewRoot` input. Found and
fixed two stale stub-routes left over from the v2 restructure: "Review Today" and "Create
Today's Journal" both still pointed at the retired `Confirm` screen; `FeelScreen`'s Back button
still pointed at the retired `Reflect` screen — all three now point at/from `Review` correctly.
Verified in Preview with 3 seeded moments (screenshot) and a debug-autopilot run confirming the
full Review → Feel transition. See BUILD_PLAN.md for the full writeup.

### 24. Review Today thumbnails should be background-removed too
> The memory cards showed in the review session should also put the background removed
> version instead of the full captured image

→ Root cause: MemoryCardSpawner never recorded which crop rect / polygon was behind a card's
current thumbnail anywhere `JournalSession` could see — the cut-out is a live UV-crop/mesh trick
on the card, not a saved texture. Fixed by mirroring that shape: `JournalSession.keep()` gains
`box01`/`polygon01` params + new `updateThumbShape()` (reaches an already-kept trace when
segmentation resolves AFTER Keep — the common case); `ReviewScreen.buildThumb` rewritten to
replicate the card's own fallback ladder (cutout mesh → UV-cropped crop → full frame) against
the same frozen still. Verified with a real capture where Keep fired before segmentation
resolved (the harder timing order) — log confirms the post-Keep sync, and the Review screenshot
now shows the actual cut-out shape instead of a rectangle. See BUILD_PLAN.md for the full writeup.

### 25. Build §8 and §9
> okay then do the step 8 and 9

→ §8 (overall daily emotion) was already built (`FeelScreen.ts`) — just needed its copy aligned
to the spec's exact prompt and its Back button repointed from the retired `Reflect` screen to
`Review`. §9 (generate the daily journal) is new: `GeminiService.generateJournal` rewritten from
its stale v1 shape (single day-level reflection/feeling) to the real v2 shape — a list of the
SELECTED moments (label/OCR/emotion/reflection each) plus the one day feeling, with the prompt
tightened to explicitly forbid inventing anything not in that evidence and to the literal 60-90
word paragraph the spec asks for. New `GenerateScreen.ts` auto-fires the call on entry and shows
title + paragraph + final reflection. `JournalEntry` gained the `title` field the spec always
asked for but the data model never had. Found and fixed a real bug along the way: a long
paragraph rendered completely blank (Text component had the correct data but PanelKit's own
`sizeToFit`+`Shrink` technique — fine for short labels — silently failed on many wrapped lines);
switched to a plain fixed-size wrap. Verified twice end-to-end with real Gemini calls (12.31s and
9.33s, 77 and 76-word paragraphs, both within spec) — second run screenshotted post-fix showing
the full readable journal page. See BUILD_PLAN.md for the full writeup.

### 26. Build §10 and §11
> yes

→ §10 (Review the journal): a "Revise" chooser on the Generate result panel holds Edit the
words (verbatim dictate/type via the shared ReflectionCapture helper, no Gemini), Make Shorter /
Change Tone (regenerate with a new `styleHint` on `generateJournal` — changes HOW it's written,
never WHAT it's grounded in), and Regenerate. §11 (Save the day): new `OrbScreen.ts` folds the
entry into a real coloured sphere (colour = the §8 daily feeling) with Keep Private / Place in
Space, persisting to a small multi-day JSON store. Found and fixed a real bug while wiring
Place in Space: the sphere would have vanished the instant the user left the screen, because it
was parented under the same SceneObject ScreenRouter disables on navigation — fixed by
reparenting a Placed sphere to a new always-on holder object right before saving. Verified live
twice end-to-end (Keep Private and Place in Space), including a post-navigation scene query that
found the Placed sphere still alive and correctly coloured after returning Home. See
BUILD_PLAN.md for the full writeup.

### 27. Remove text outline, adjustable UI theme, fix button overlap
> 1. remove the black outline of the word
> 2. could you make a adjustable ui script so that i can revise the ui layout, text size, color,
> box outline width etc. in the inspector?
> 3. move the btn on the panel a bit foward as they are now a bit overlapped.

→ `UITheme.ts` rewritten into a full Inspector panel for the wireframe UI's look: text size/
colour/outline, frame thickness, corner roundedness, and a new button-forward-Z offset —
`PanelKit.ts` reads all of it now instead of its own hardcoded constants. Text outline OFF by
default (was always on) fixes #1. A screenshot taken while verifying #3 turned up two real bugs
on Generate's result panel: the final reflection text was landing directly on top of the Save
button (a fixed-fraction layout that was never recomputed when §10 added a 3rd button), and the
panel's title was stuck reading "Composing your day .." forever (the loading spinner's animation
flag never got cleared when swapping to the done panel). Both fixed — one with proper computed
layout math, one with a one-line flag reset in the shared teardown path. Verified live:
re-screenshotted Generate's result panel and Review Today's moment panels — crisp text, correct
titles, clean button separation. See BUILD_PLAN.md for the full writeup.

### 28. Button gradient + transparent panel; orb shader with noise, Fresnel, debug preview
> add a gradient color (light gray to transparent, horizontal) to the button background color,
> and make ui panel background color totally transparent.
> make a shader to the orb. add noise to the surface so it's a bit wavy. add a debug mode that
> make me can preview the orb visual in real time. also add a frensel effect so the outline is
> glowing and the center of the orb should be transparent also

→ **Buttons/panel**: new `Textures/ButtonGradient.svg` (light-gray → transparent, horizontal),
converted to a texture and applied via a new `UIButtonFill.mat`, wired into `PanelKit.addButton`
with a new `fillIgnoresThemeOpacity` flag so the button's own gradient isn't dimmed by the
panel's opacity slider; `UITheme.backgroundOpacity` default 0.25 → 0 (panel now fully
transparent, buttons keep their gradient). Verified in Preview — room visible through the panel,
buttons show the gradient. **Orb "shader"**: Lens Studio's shader graph (Fresnel/Noise/Custom
Code nodes) has no scriptable wiring API from outside the visual Material Editor (confirmed via
`editor.d.ts` and live probing) — used the real substitute instead: `Materials/OrbGlass.mat`
(`UberPBRMaterialPreset`) with `ENABLE_RIM_HIGHLIGHT` (a genuine Fresnel rim-light —
color/intensity/exponent) for the glowing edge, `ENABLE_NORMALMAP` with a generated soft-noise
texture for the wavy surface, `blendMode: Normal` + a low `baseColor.a` for the see-through
center, and slow continuous rotation (no scriptable UV-scroll uniform) to make the static noise
read as alive. Found and fixed a real bug along the way: the first debug-preview implementation
lived inside `OrbScreen.ts`, whose SceneObject (`OrbRoot`) is disabled by `ScreenRouter` whenever
the user isn't on the Orb screen — and a disabled SceneObject's `UpdateEvent` never fires, so the
preview could never actually build/tick off-screen (the exact ask). Fixed by extracting the
shared look + the whole debug-preview mechanism into a new always-on component, `OrbLook.ts`,
attached to the pre-existing always-on `OrbSpawner` object; `OrbScreen` now just reads its getters
when building the real, saved orb — one look, one source of truth. Verified live: flipped
`debugPreviewOrb` on with the Lens sitting on a *different* screen, confirmed the preview orb
built immediately (log + screenshot), then live-dragged `centerAlpha`/`rimIntensity`/
`rimColorHex`/`rimExponent` via scene-graphql with no rebuild/reset and watched the same running
orb visibly change each time (more see-through, tinted rim) — the real-time preview works exactly
as asked. Settled on `centerAlpha 0.25 / rimIntensity 5 / rimExponent 3` as the shipped defaults
after that tuning pass. See BUILD_PLAN.md for the full writeup.

### 29. Place in Space — hand-follow + pinch to drop
> now for the 'place in space' feature, i want it to be like after pressing btn, the ball follow
> the forward direction of their hand, and use pinch to decide where to put it

→ `OrbScreen.ts`: tapping "Place in Space" no longer saves immediately — it detaches the sphere
and enters a **placing** mode. Every frame the sphere is repositioned along the dominant hand's
real targeting ray (`BaseHand.targetingData` from SIK's `HandInputData`, the same ray the
Interactors use to aim at UI) at a fixed `placeDistanceCm` out, so it visibly follows wherever
the hand points; a pinch (`BaseHand.onPinchDown`) commits it in place. The sphere is then
reparented to the always-on holder with `setParentPreserveWorldTransform` (not the plain
`setParent` the old code used) so it does not jump from wherever it was just dropped, and the
normal save/persist path runs from there. A "Cancel" button backs out without saving. Since
there's no real hand tracking in the Editor/Preview, that environment also shows a
"Drop Here (Preview)" button doing the same finalize using the Camera Object's forward ray
instead — device behaviour is unchanged (that button never appears there). Found and fixed a
real latent bug while testing via `debugStartState="Orb"`: jumping straight into the Orb screen
made `OnStartEvent` and an immediate `OnEnableEvent` both call `rebuild()`, so the pop-in tween
from the first sphere build kept running after `destroySphere()` tore that sphere down for the
second build, throwing `Object is null` — fixed by tagging each tween with its target object and
skipping/dropping it once that object is destroyed (same guard the spinners loop already had).
Verified with a new `debugAutopilotPlace` debug flag (mirrors `debugAutopilot`, off by default)
that drives begin → finalize → Done end-to-end: log confirms `[Orb] placed at {x,y,z} …
reparented to "OrbSpawner"`, a runtime scene query found the sphere alive, correctly parented,
full-scale, and a screenshot confirmed it visually — floating in empty space, not stuck at the
panel, wavy shader intact. All debug flags reset afterward. See BUILD_PLAN.md for the full
writeup.

### 30. Card shrink-out, mic/keyboard icons, moment-saved spacing, Review spawn placement
> when press keep, retake or remove on the memory card, make sure the memory card play a smooth
> scale down animation, so it disappear smoothly (shrink towards the white sphere attatched to
> the object)
> after the memory card anmation end, then next window is allowed to pop up, with a smooth
> transition animation also
>
> what was unexprectd about this moment: hold to speak -> replace with microphone icon, type ->
> replace with keybaord icon, skip -> stay the same, then layout them horizontally
>
> -moment saved for today: move the options btns below a bit, approximately add one btn height
> between the text and the first btn.
>
> after pressing 'create today's journal', make the pop-up windown spawn in front of the user,
> but not billboard, just spawned in front of where the user is

→ Four related fixes across the Keep/Retake/Remove → per-moment sub-flow → Review handoff:

1. **Card shrink-out, gated next window.** `MemoryCardSpawner.ts`: Keep/Retake/Remove now all
   route through a new shared `beginShrinkAndThen(card, after)` — the card (+ its marker sphere
   + connector line) shrinks and slides toward the marker's own world position over ~0.28s, THEN
   the card is destroyed, and ONLY THEN does `after()` run (momentFlow.begin() for Keep;
   `goTo(Scan)` for Retake/last-Remove) — the next window can no longer pop up over/under a card
   still mid-animation. Keep gets an extra ~0.35s "kept" flash first so the green confirmation is
   actually visible before the shrink starts. Found and fixed a bug in the SAME pass: the tween
   array had no way to detect a target destroyed out from under a still-running tween (the exact
   OrbScreen class of bug from #29) — added the same `obj` guard + a new `onComplete` hook.
2. **Mic/keyboard icons, horizontal row.** `MomentEmotionReflect.ts`'s reflective-question
   "prompt" panel: Hold to Speak → mic icon, Type instead / Type → keyboard icon (both imported
   via IconSelector, same pattern as FeelScreen's existing icons), Skip stays text; the row is
   now `buttonsVertical: false` (horizontal) instead of stacked.
3. **Moment-saved spacing.** The "Moment saved for today." panel's title sat right on top of
   "Capture Another" — `heightCm` 40 → 56 opens roughly one button-height of clear gap (buttons
   anchor from the panel's bottom inset, title from the top, so a taller panel pushes the whole
   button stack down without moving the title).
4. **Smooth pop-in for every window this sub-flow builds**, plus a new reusable
   `PanelKit.popInTween()` (a small scale-up tween descriptor any script's own tweens-array/
   onUpdate loop can push) used for all of MomentEmotionReflect's panels.
5. **Review spawns in front of the user, not billboarded.** `ReviewScreen.ts` — the screen most
   often entered right after "Create Today's Journal" — now moves its OWN root to match the
   Camera Object's CURRENT world position + yaw (pitch/roll stripped) ONCE, every fresh screen
   entry (`OnStartEvent`/`OnEnableEvent`, deliberately NOT inside the generic `rebuild()` also
   used for Include/Exclude toggles, which would otherwise re-snap the panel on every tap). Not
   parented to the camera (that would be a literal billboard) — a one-time snapshot placement.

Verified end-to-end via a real capture → Gemini → card → autopilot chain (Change Label → pick
alt → Keep → shrink confirmed in logs/screenshots → emotion pick → question panel screenshotted
showing the mic/keyboard/Skip row → confirm → moment-saved panel screenshotted showing the
opened-up gap → Create Today's Journal → Review, confirmed via `QueryRuntimeSceneTool` that
ReviewRoot's world transform now exactly matches a deliberately-relocated Camera Object). One
non-fatal observation: a SIK-internal `CursorViewModel`/`InteractableScoring` exception
("Object is null") appears in the log right after Keep's shrink destroys a card's Interactable
buttons — doesn't break anything (the very next line always continues normally) but is a real,
newly-observed side effect of destroying Interactables that a cached cursor/hover reference still
pointed at; noted for awareness, not chased further (SIK-internal, not this project's code). All
debug flags reset afterward. See BUILD_PLAN.md for the full writeup.

### 31. Vertex Distortion orb, emoji-only, button-glitch fix, then Phase §12

> i removed the magic dew. i use vertex distortion material instead.
> remove the rim settings of the orb spawner if it's not working.
> apply the color chagne to the new orb based on the user's choice as well (i can only find
> color change setting in vertex distortion shader)
> for emoji, only keep emoji, remove the text
> and the button background color looks still broken now, how to fix it? it's glitchy
> after finish those, start next phase

→ **Orb**: rewired `OrbScreen.orbMat` + `OrbLook.orbMat` to the asset-library **Vertex
Distortion** graph shader (`Vertex Distortion.lspkg/Vertex Distortion.mat`, id `4aab6944-…`) —
it wobbles the actual sphere vertices with animated noise (a real wavy surface, not a normal-map
fake). `OrbLook.ts` rewritten: all the UberPBR rim / normal-map settings removed (the rim never
read here), replaced with `waveStrength` / `waveSpeed` / `noiseScale` sliders wired to the
graph's `strength` / `animatedSpeed` / `noiseScale` ports. `applyOrbLook(mat, colorHex)` now
writes the emotion colour to the graph's `Port_Albedo_N006` port, so the real saved orb takes
the day's feeling colour (verified: a yellow debug orb rendered correctly from a `#F2C94C`
hex). **Emoji**: the emotion-pick buttons are now the emoji ONLY — no text label, no colour
swatch (`decorateSwatch` + its helpers deleted). Confirmed in Preview that Lens Studio's font
renders full-colour emoji; swapped `🥹` (nostalgic, a 2022 emoji) for `💭` as a safer glyph.
Title simplified to "Pick a feeling right now." **Button glitch** (coplanar transparent-quad
z-fighting — the "glitchy" flicker as the head moved): four-part fix — `UIButtonFill.mat`
`twoSided` → false (kills the front/back self-fight on a flat quad) + a `polygonOffset` of
(-2,-2) (deterministic depth bias), and in `PanelKit.addButton` the gradient fill is pushed
well forward of SIK's own button-background quad (localZ 0.05 → 0.25, label 0.12 → 0.45) AND
that SIK quad's `RenderMeshVisual` is now actually disabled (`opacity:0` left it in the draw
list still sort-fighting). Same phantom-quad disable applied to `setTitleTappable` /
`setPanelTappable`. Verified from several steep angles — fills read clean and stable.

**Next phase started: §12 Monthly Container ("the Jar").** [see BUILD_PLAN.md]

### 32. Card polish, emoji grid, Keep hold, moment-saved sizing, frameless Review footer, thumbnail outlines

> 1. remove: here's what i found. is it correct?
> 2. after pressing keep, the window stay for 3 secs, then close
> 3. pick a feeling: arrange the emojis horizontally, each row has 5 emojis, 2 rows, if not
>    enough add to 10
> 4. moment saved for today: lower the buttons a bit, and scale the image a bit, 1.5x
> 5. after 'create today's journal', remove the 'ready?' text and the outline, just keep the
>    two btns. and the memory card, the text and the image are in the upper side of the
>    boundary, make them in the center, and the image is overflowed, bigger than the outline,
>    make sure it's inside box
> 6. add the white outline to all background removed picture

→ 1. `MemoryCardSpawner.confirmPrompt` default `""` (+ scene value pushed) — the card no
longer shows the "is it correct?" line. 2. `KEEP_FLASH_SEC` 0.35 → **3.0** — after Keep the
card holds its green "Kept" state for 3s, then shrinks/closes (verified: the §4 sub-flow now
`begin()`s ~3.3s after Keep). 3. **New `PanelKit` option `buttonGridCols`** — `buildEmotionPanel`
uses `buttonGridCols: 5` on a shorter panel; `EMOTIONS` grown from 7 → **10** (added grateful
🙏 / tired 😴 / proud 💪) so it fills a clean 5×2 emoji grid. 4. **New `PanelKit` option
`buttonDropCm`** — moment-saved panel `heightCm` 56 → 62 + `buttonDropCm: 4`; the kept-object
thumbnails scaled **1.5×** (h 6 → 9, slot 7.5 → 11.25). 5. **New `PanelKit` option
`frameless`** — the Review footer is now just the two buttons (Back / Create Journal), no
"Ready?" text, no outline. **New `PanelKit` option `contentDropCm`** — the per-moment cards
drop their title/body ~5cm so text + thumbnail read centred instead of top-hugging; `traceH`
62 → 44 (no more empty lower half); the thumbnail width is now clamped to the inner panel
width so a wide cut-out can't spill past the card outline. 6. **New TraceGizmos `ThumbOutline`
+ `addThumbBorder()` + an `outline` param on `makePolygonCutout()`** — every background-removed
thumbnail (polygon cut-out: a radially-inflated white silhouette behind it; bbox / full-frame:
a white `makeRectFrame` border) now gets a white sticker outline. Wired into MemoryCardSpawner,
ReviewScreen, and MomentEmotionReflect's kept-thumb row; `MemoryCardSpawner.buildThumb` now
returns a holder so the image + border tear down together on a segmentation upgrade.

Verified in Preview: the 5×2 emoji grid (colour emoji render), the 3-second Keep hold (log
timing), the enlarged moment-saved thumbnail + lowered buttons, the frameless Review footer
(two bare buttons), and the shorter/centred moment cards with the green outline + ✓ on chosen
ones. (The test capture happened to be a white wall-poster, so its white outline is invisible
against the white crop — the border object is created regardless and shows on any coloured
object.) All debug flags reset; project saved. See BUILD_PLAN.md.

### 33. White outline only on the real cut-out, not the raw thumbnail

> the White outline is added to the original thumbnail, instead of the removed background
> one, fix it

→ The rectangular `addThumbBorder()` border was landing on the bbox-crop / full-frame
thumbnail tier — which still contains the photo background — so it read as "an outline on
the original thumbnail". Fix: **`addThumbBorder()` deleted**; the white sticker outline is
now produced *only* by `makePolygonCutout()` (reached only when Gemini segmentation returns
a real silhouette polygon). That function was reworked so the outline is a radially-inflated
copy of the **actual cut-out silhouette mesh**, built as a child *before* the textured
cut-out (draws behind), with `depthWrite = true` on the cut-out material so the texture
occludes the inflated copy everywhere except the peeking rim. The bbox-crop / full-frame
fallback paths in `ReviewScreen`, `MemoryCardSpawner`, and `MomentEmotionReflect` now carry
no border at all (NOTE comments left in place). Compiles clean, clean boot. Project saved.

### 34. End-of-flow polish: Review rows, card-wait-for-segmentation, emoji frameless, Feel autoadvance, loading centre, journal icons, Orb layout

> after pressing today's journal, put time + emotion on one row, two btns right below the
> memory card with ~one btn-height gap · before segmentation+outline done, don't show the
> captured card (it currently shows the raw capture then swaps seconds later) · remove the
> emoji button backgrounds, keep just the tappable emoji · after 'create journal' spawn the
> feeling window in front of the player, and remove the 'choose the feeling' nav + two btns
> so picking a feeling advances immediately · centre the 'composing your day…' text · after
> the journal finishes, replace the text buttons with icons (back arrow / regenerate /
> pen-edit / save) · after save, put the window BELOW the ball, drop the window outline,
> two btns horizontal, scaled to about the text width

→ **1. ReviewScreen moment cards** — time + emotion now share row 1 (`"19:27   ·   Peaceful"`),
reflection is row 2. The frameless footer is repositioned so the button row sits one
button-height below the card bottoms (explicit math mirroring PanelKit's PAD/BTN_H); the
rejected-tap hint moved from the (now too-short) footer to the header body (`hintMsg`).
**2. ScanScreen** — `segmentPrimary` is now awaited BEFORE `cardSpawner.spawn()`; the card
is built already wearing its cut-out + outline (spawn + applySegmentation run in the same
tick, before the pop-in tween's first frame — verified: `thumbnail path: CUTOUT` logs at
spawn time, no visible bbox→cutout swap). A `pendingSpawns` counter keeps the loading panel
up during the wait; a 10s safety timeout shows the card anyway if segmentation stalls.
**3. New PanelKit option `buttonsFrameless`** — MomentEmotionReflect's 5×2 emotion grid now
renders bare emoji glyphs (no wireframe frame, no gradient fill), still full-slot tap
targets. **4. FeelScreen** — gained `cameraObject` + `spawnInFrontOfUser()` (mirrors
ReviewScreen); the nav panel (title + Continue/Back) is gone; `select()` writes the feeling
and `goTo(Generate)` immediately. Panel down-scaled (the nav used to pull the fit factor
down). **5. GenerateScreen loading panel** — `contentDropCm: 6` centres "Composing your
day…" vertically (was top-hugging). **6. GenerateScreen done panel** — the Save/Revise/Back
text stack is replaced by one horizontal row of 4 Material-icon buttons: `arrow_back`→Back,
`refresh`→Regenerate, `edit`→Edit-the-words, `save`→Save. The multi-option Revise chooser
(`openReviseChooser`) is deleted; Make-Shorter / Change-Tone `styleHint` plumbing stays for
debug/autopilot. Icons imported to `Assets/Icons/`. **7. OrbScreen sphere panel** — sphere
raised (`sphereLocalY = 14`); the panel sits fully below it (`frameless`, no outline); Keep
Private / Place in Space are a horizontal row on a 38cm-wide panel (≈ title width, not a
full 44cm bar).

Verified in Preview: Review rows + footer gap (seeded moments); the segment-then-spawn
sequence (real capture → `CUTOUT` at spawn, no swap); the frameless emoji grid (real
capture → auto-Keep → §4 panel); FeelScreen in front of the user with no nav; the centred
"Composing your day…"; the Orb sphere-above-panel layout. Icon-button done panel: layout
math only (needs a full Gemini journal to render). All debug flags reset; project saved.

### 35. Corner-bracket reticle, softer copy, layout nudges, Home/Generate spawn-in-front, Orb placement rework

> after 'capture the moment', use 「」corner brackets instead of the light-blue box · softer,
> gentler wording for "pick a feeling right now" (and similar) · moment-saved: btns spill the
> box, scale them down · after "Finish for Now" spawn the Home menu in front of the user ·
> after "Create Journal" the review thumbnail overlaps the text, move it down · "today
> felt..." btns a bit higher + gradient right-to-left · after choosing a feeling, "composing
> your day…" should spawn in front of the user · generated-journal panel: text blocks too far
> apart, pull together + scale the btns down · "place in space": the pinch isn't working —
> make it behave like the surface-capture flow (free space, same pinch) · remove the placement
> button + window; show "Pinch to place" on the ball, then Confirm/Reset horizontally on it

→ **1. `makeReticle` (TraceGizmos)** rebuilt as four 「」corner brackets (`MeshTopology.Lines`,
arms = 32% of the shorter half-dim, pointing inward) instead of a closed rectangle.
**2. Copy** — MomentEmotionReflect §4 title `"Pick a feeling right now."` → `"What feeling
sits with you here?"` (gentle, unhurried). **3. New `PanelKit` option `buttonScale`** —
MomentEmotionReflect's moment-saved panel uses `buttonScale: 0.82` + `buttonDropCm` 4→1 so
the 3-button stack sits inside the box (was overflowing the bottom edge). **4. LaunchScreen**
gained `cameraObject` + `spawnInFrontOfUser()` + an `OnEnableEvent` rebuild, so returning
Home (e.g. "Finish for Now") re-places the menu in front of the user. **5. ReviewScreen
`buildThumb`** — thumbnail `localPos.y` −0.38 → −0.48 × halfHeight and `maxH` 0.62 → 0.55 ×
halfHeight, so it clears the (dropped) reflection line instead of overlapping it.
**6. FeelScreen** — `buttonDropCm: -4` lifts the option stack; **new `PanelKit` option
`buttonGradientFlip`** (→ `RectFrameOptions.fillFlipU`, mirrors the fill's U) runs this
screen's button gradient right-to-left. **7. GenerateScreen** gained `cameraObject` +
`spawnInFrontOfUser()` (OnStart + OnEnable), so the "Composing your day…" / result panels
appear in front of the user. **8. GenerateScreen `buildDonePanel`** — `headerH` drops the
extra gap, `paragraphH` 34→26, `contentGap` 2→1.5 (title/paragraph/reflection read closer);
`buttonScale: 0.82` on the icon row. **9-11. OrbScreen "Place in Space" rework** — the
instruction window + Cancel/Drop-Here buttons are gone. The sphere follows the aim ray (the
hand's forward ray, NOT plane-snapped) with a **"Pinch to place"** label above it; the pinch
now uses `GestureModule.getFilteredPinchDownEvent` (the *filtered* variant, reliable while
the hand moves — the plain SIK `onPinchDown` used before never fired here), same family the
capture flow uses; Editor/Preview falls back to a `TapEvent` + camera-forward ray. A pinch
freezes the sphere and shows a horizontal **Confirm / Reset** pair on it (Confirm → reparent
+ save; Reset → resume following).

Verified in Preview: the 「」reticle (corner brackets, not a box); FeelScreen buttons lifted +
right-to-left gradient; ReviewScreen thumbnail clear of the text; the OrbScreen follow phase
("Pinch to place" on the sphere) and the Confirm/Reset pair after the (tap-stand-in) pinch,
plus the placed-save + Home-in-front chain end to end. Icon-button Generate panel + tighter
text: pending the current Gemini run's screenshot. All debug flags reset; store's debug
`jar_*`/placed days cleared; project saved.

### 36. Orb saved panel fix + "Okay", Jar month view cleanup + hover highlight, orb matte look

> 1. "today is folded away" — text/button overlap; spawn this window in front of the player;
>    "Done" → "Okay"
> 2. "revisit the month" — remove the "pinch a sphere…" text + window; highlight a sphere
>    (light yellow) on hover
> 3. can the orb shader do a white-centre → chosen-colour radial gradient + a matte-paper
>    effect, like the reference image?

→ **1. `OrbScreen.buildSavedPanel`** — `heightCm` 24 → 34 (title / body / button no longer
overlap); `spawnInFrontOfUser()` (new method on OrbScreen) called at the top so the
confirmation lands in front of the user; `doneLabel` default "Done" → **"Okay"** (scene value
pushed). **2. `JarScreen`** month view — the footer keeps only the Back button: body
`"Pinch a sphere to open that day."` removed (empty-state hint stays for 0 days) and
`frameless: true` (no window). Each day-sphere's tap `Button` gains `onHoverEnter` /
`onHoverExit` handlers that blend the sphere material 65% toward a light yellow
(`#FFF7B3`-ish) on hover and restore its day-colour on exit. **3. Orb shader** — a true
*view-radial* white-centre → colour-edge gradient needs a Fresnel/facing node added to the
`Vertex Distortion` graph shader (not doable from code — no camera/view node in that graph).
What was shipped from code (`OrbLook.applyOrbLook` + 3 new Inspector sliders): `Port_Roughness`
→ 0.9 (**matte** — kills the plastic specular highlight, the "matte paper" half) +
`Port_Metallic` → 0 + a faint `Port_Emissive` (mostly the day colour, a little white) so the
orb reads as a luminous matte blob, lit side toward white / edges saturated. Verified matte
in Preview; the radial gradient is pending a decision on editing the graph shader.

All debug flags reset; the persistent `traceJournal.days` store wiped again (test pollution
from the Orb private-save autopilot); compiles clean; clean boot; project saved.

### 37. Jar caption removal + Jar/Orb spawn-in-front

> 1. revisit the month — remove "one sphere one day each"
> 2. the pop-up window should spawn in front of the player too, as well as the created-ball window

→ **1. `JarScreen.buildMonthView` header** — body `"N days — one sphere each."` removed
(now `""` for N > 0; the "No journals yet." empty-state line stays for N = 0).
**2. Spawn-in-front:**
- `JarScreen` gained `cameraObject` + `spawnInFrontOfUser()` (yaw-only) called on OnStart /
  OnEnable, so the month + day-detail panels appear in front of the user. Content nudged
  down 8 cm so the top header clears the FOV.
- `OrbScreen` now calls `spawnInFrontOfUser()` on OnStart / OnEnable (not just inside
  `buildSavedPanel`), so the **created-ball window** (sphere + Keep Private / Place in
  Space) is placed in front of the user too, same as the saved-confirmation window.

Verified in Preview: the Jar month view (month title only, no caption, whole tree centred in
front) and the Orb created-ball window centred in front. `JarScreen.cameraObject` wired via
VirtualScene. All debug flags reset; `traceJournal.days` store wiped of test pollution;
compiles clean; clean boot; project saved.

### 38. Thick white reticle, Jar-fits-FOV fix, orb creature eyes

> 1. make the scanning-box lines wider, rounded ends, white
> 2. after creating a journal, "revisit this month" got stuck / journal disappeared / went to
>    menu / saw nothing — what's wrong?
> 3. add two lines on the ball so it looks like a creature
> 4. what's left?

→ **1. `TraceGizmos.makeReticle`** rebuilt: each 「」bracket arm is now a solid **stadium bar**
(rounded-end capsule, `MeshTopology.Triangles`, `lineWidthCm` option ~0.8) instead of a 1px
`Lines` hairline; default colour **white**; ScanScreen passes white + `lineWidthCm: 0.8`.
**2.** Could NOT reproduce data loss in Preview — the full chain (Review → Feel → Generate →
Orb → Save → Home → Jar) persists the day and `[Jar] month view built — 1 day(s)` reads it
back with no error. The real problem: the Jar layout was **too tall for a headset FOV** —
header at ~+42, Back button near ~-44 — so after the Round-K spawn-in-front it rendered
mostly off both edges (looks like "nothing there", and the Back button is unreachable so a
stray tap → "went to menu"). Fix: `buildMonthView` / `buildDayView` rebuilt with a compact,
vertically-symmetric layout (header/grid/Back centred, ~40 cm effective height); removed the
Round-K −8 content nudge; dropped the redundant day-view "Back to Home" footer. **3.**
`OrbScreen` draws a `OrbEyes` holder — a `Component.Text` "—        —" (two lines), dark,
`depthTest = false` so it always reads on the opaque wobbling orb — billboarded onto the
orb's camera-facing side every frame (`updateOrbEyes`), torn down with the sphere / on
placement. **4.** See BUILD_PLAN "What's left" — the 12 priorities are all built; open items
are the orb radial-gradient shader (needs a graph edit), §14 error/fallback polish, on-device
testing of the hover/pinch/ASR paths, the deferred §7 song + real spatial anchoring +
multi-month Jar, and some dead spike/Confirm/Reflect code to prune.

All verified in Preview (thick white reticle, Jar fits with Back visible, orb creature face).
Debug flags reset; store wiped; compiles clean; clean boot; project saved.

### 39. Reflection Back/Confirm, double-capture guard, Jar day stickers, capture spinner, copy/layout nudges

> 1. after typing/speaking a mood: buttons horizontal, keep only Back / Confirm
> 2a. the first pinch sometimes captures twice · 2b. sometimes one object doesn't segment
>     (label is still right)
> 3. in "revisit this month", opening a sphere should show that day's stickers (bg-removed
>    images), all of them
> 4. after capturing, show a small animation in the centre of the loading window
> 5. "What feeling sits with you here?" — lower the text a bit
> 6. remove "Pinch 'Reveal journal' to…" text
> 7. the month/date text sits in the upper part of the window — centre it

→ **1.** `MomentEmotionReflect` captured-reflection panel — `buttonsVertical: false`, buttons
now just **Back** (= re-record) / **Confirm** (was Confirm / Try Again / Skip vertical).
**2a.** `CaptureController` — `debounceSec` 0.8 → **1.6** (scene value pushed) + device pinch
switched to `getFilteredPinchDownEvent` (the filtered variant stays one event on a jittery
hand). **2b.** Inherent to the two separate Gemini calls — `segmentPrimary` sometimes
returns no polygon while `analyzeTrace`'s label is fine; the card falls back to the bbox
crop / full frame. Not a code bug (documented). **3.** `JarScreen` gained a `journalSession`
@input (wired). The day-detail view now renders that day's **cut-out stickers** (polygon
cut-out → bbox crop → full frame, same tiers as ReviewScreen) — but ONLY when the day is the
one still held live by JournalSession (i.e. the day you just saved this session; textures
aren't persisted to disk, so a past day after a Lens restart still shows the object labels).
**4.** `ScanScreen` — the loading panel drops its caption line and shows a small white ~270°
**arc spinner** in its centre, rotated every frame while the panel is up. **5.**
`buildEmotionPanel` gets `contentDropCm: 5`. **6.** the day-detail non-revealed body is just
the object labels — no "Pinch Reveal journal…" line. **7.** Jar month header +
day-detail title get `contentDropCm` so the month/date text reads centred, not top-hugging.

Verified in Preview: the horizontal Back/Confirm reflection panel, the centre spinner while
"Finding the memory…", the Jar month header centred, the day view without the pinch line.
The day-detail stickers are code-verified only (can't be screenshotted — same-session live
traces are lost on a Preview refresh, and inject-taps can't hit PanelKit buttons to navigate
Home→Jar without one). Debug flags reset; store wiped; compiles clean; clean boot; saved.

### 40. Jar reveal overlap, orb creature-eye motion, orb radial gradient (finally)

> 1. "Reveal journal" — the closing reflection ("I'll bring this to tmr…") overlaps the
>    journal paragraph
> 2. make the eye stroke 2.5x bigger, add motion so it looks alive, make it vertical, add a
>    blink animation
> 3. do the orb radial gradient (white centre → colour edge) — the Fresnel graph-shader
>    node you said it needs

→ **1.** `JarScreen.buildDayView` revealed — the reflection is no longer in PanelKit's body
band (which sat on top of the paragraph). Paragraph + `\n\n— {reflection}` are now ONE
wrapped Text block (`pt.size` 70 → 52, `h` 52 → 58), so they can't collide. **2.**
`OrbScreen` eyes: `Component.Text` "|      |" (VERTICAL strokes), `size ≈ d * 6` (~2.5x the
old dash), on a child of the face holder so it can be animated without breaking the
billboard — a gentle vertical **bob** + slow side-to-side **glance** + a **blink** (Y-squash
to a slit every ~2–5 s). **3.** Done in code, no graph edit: `buildOrbGlow()` bakes a
128px radial white→transparent texture once (`ProceduralTextureProvider`) and lays it on a
camera-facing quad over the orb via `ImageMaterial` (premultiplied-alpha, depth-test off) —
so the centre reads white and the coloured orb shows at the rim. A true **view-radial
white-centre → colour-edge gradient**, billboarded each frame. `OrbLook.glowWhiteAmount`
dialled to 0 (the disc is the white now; scene value pushed). Verified in Preview with a
blue orb — white core, blue rim, plus the vertical blinking eyes.

Debug flags reset; store wiped; compiles clean; clean boot; project saved.

### 41. Loading spinner in capture centre, 50% reticle corners, round eye ends, keep face after placement, no "Create Journal" when today is saved, revisit real placed balls

> 1. the loading animation is after player pinch to capture, and it's in the middle of the
>    capture screen. and the capture corner is too wide, maybe decrease it to 50%
> 2. the eyes of creature, the end of the line is hard, i want it to be round
> 3. after confirm the placement, the frensel effect and the eyes disappear
> 4. pressing "review today" in the menu, there shouldn't have "create journal" if there's
>    already a journal for today
> 5. if player choose to revisit this month, they will see all the balls, which are also
>    stay in where they were placed with a smooth transition animation. once they pick a
>    specific one, display the chosen one only.
> 6. after finish those, what's left?

→ **1a.** `ScanScreen.buildLoadingSpinner()` — the ~270° arc is now parented to the
**Camera Object** at local `(0, 0, -reticleDistanceCm + 1)`, i.e. head-locked dead-centre
of the capture frame (was inside the loading panel). Bigger (`ri 2.2 / ro 3.3 / seg 34`).
`onUpdate` still toggles it on `ellipsisActive` (the post-pinch "processing" state) and
Z-spins it. The loading panel shrank to a title-only band above it. **1b.**
`TraceGizmos.makeReticle` gained an `armFraction` option (default 0.32); `ScanScreen`
passes `0.16` → corner brackets are half as long. **2.** `OrbScreen` eyes rebuilt as
**mesh stadium bars** (`makeEyeBar`: rectangle + `CAP=7` semicircle end-caps, triangle
fan) instead of a `Text` "|" — the ends are genuinely round now. Filled by a runtime-baked
4×4 near-black texture through `ImageMaterial` (premultiplied alpha). `updateOrbEyes` /
`setEyeBar` drive the same bob / glance / blink (Y-scale) per bar. Verified in Preview —
clear rounded caps. **3.** `finalizePlacement()` no longer destroys the face + glow — it
`setParentPreserveWorldTransform`s the eye holder and the glow disc onto the placed sphere
(frozen in their last camera-facing pose), stops that sphere's spin, and registers it in a
new module-level `sessionPlacedOrbs` map (`dayId -> SceneObject`). Verified — the parked
orb keeps its eyes + white core on the Home screen after Done. **4.** `ReviewScreen` reads
`traceJournal.days`; if an entry is dated today it hides "Create Journal" (would double-
write the day), swaps in a "Revisit the Month" button and a "Today's journal is already
saved." header line. **5.** `JarScreen` month view: days with a `sessionPlacedOrbs` entry
are **not** drawn in the panel grid — the real placed orb is re-enabled where the user
parked it, scale-popped in from ~0 (`pops` tween list on `UpdateEvent`, ease-out cubic,
staggered), and given an invisible `Button` tap child (tracked in `placedTaps`, destroyed
on teardown — the orb itself is OrbScreen's). Grid spheres for older-session days also
pop in. Opening a day hides every placed orb except that day's; "Back to month" /
leaving the Jar restores them all to full scale via `placedFullScale`. `deleteDay` also
retires that day's placed orb. **6.** answered in chat (see BUILD_PLAN Round O).

Debug flags reset (`debugStartState` → Launch, all `debug*` bools false); `traceJournal.days`
store wiped; TypeScript compiles clean; clean boot (no runtime errors); project saved.
Preview-verified: rounded eye caps, face + glow persist after placement, 50%% reticle
corners, Jar month view builds clean after wipe. Code-verified only: the head-locked
centre spinner (needs a live capture→vision round-trip to enter the processing state) and
the full revisit-placed-balls flow (needs a real in-session placement then Home→Jar, which
inject-taps can't drive).

### 42. Loading anim only on capture (+ reticle hides), eyes half again, sticker thumb missing in Jar, soft audio on every interactable

> only when player pinch to capture the object, the loading animation shows and capture
> corner outline disappear, and after memory card generated, the loading icon and animation
> should gone. / now the eyes are way too big, scale it down to the half / and i didnt see
> the creature image in the revist month (… the small subnail which initially there) / now
> add a round, soft audio effects to every interactable UI

→ **1.** `ScanScreen` — the head-locked capture frame + loading arc both live under Camera
Object (not ScanRoot), so ScreenRouter disabling ScanRoot never touched them and this
script's `UpdateEvent` stops firing off-screen — the arc was staying lit on the Card
screen. New `syncReticle()` is called from every state change (`applyScreen`, `showLoading`,
`showPromptOnly`, `showError`, `onUpdate`): capture frame = on-Scan AND idle; loading arc =
on-Scan AND processing. Verified in Preview: pinch → corners vanish + arc appears centre;
card generated → arc gone on the Card screen. **2.** `OrbScreen.buildOrbEyes` — `halfLen`
`d*0.16 → d*0.08`, cap radius `d*0.05 → d*0.025`, `eyeGap` `d*0.34 → d*0.17` (all halved).
Verified — smaller, still round-capped. **3.** New `StickerStore.ts` — on save,
`OrbScreen.saveDay` base64-encodes (JPEG, max compression) the included moments' frozen
stills into `traceJournal.thumbs.<entryId>`; `JarScreen.buildDayView` now falls back to
these (async `Base64.decodeTextureAsync`) when the live `JournalSession` textures are gone
(i.e. after a Lens restart — the case where the Jar day view showed no sticker).
`prune()` keeps only the 8 most-recent days' blobs; `deleteDay` + the debug wipe clear
them. **4.** New `UISound.ts` (on always-on OrbSpawner) plays one soft "bubble_low" click
(installed the **UI SFX Pack** from the asset library) on every interactable: PanelKit
routes `addButton` / `setTitleTappable` / `setPanelTappable` through `playUISound()`, and
JarScreen's two standalone Buttons call it directly. 50 ms debounce, volume 0.5.

Debug flags reset (`debugStartState` → Launch, `debugAutopilotPlace` / `debugClearSavedDays`
false); `traceJournal.days` + thumbs wiped; compiles clean; clean boot (bubble_low.mp3
loads, no errors); project saved. Code-verified only: the persisted-sticker round-trip
(needs a full capture→journal→save then a restart) and the click SFX firing (inject-taps
can't hit PanelKit buttons in Preview — they register as captures).

### 43. Loading animation shows the moment you enter the Scan screen (before any pinch)

> now after i press 'capture the moment' i still see the loading animation, fix it.

→ Root cause: `CaptureController` runs independently of the screen roots, so the very pinch
that presses "Capture a Moment" on Home is still in flight when we land on the Scan screen
and fires an unintended `onCapture` — `ScanScreen.handleCapture` ran `showLoading()` for a
capture the user never meant. Fix: `ScanScreen` records `scanEnteredAt` whenever the Scan
screen becomes active (`applyScreen`), and `handleCapture` ignores any capture that arrives
within `entryGraceSec` (0.8 s) of that — so the loading arc only ever appears on a
deliberate pinch. Verified in Preview: a capture right after arrival logs "ignored — within
screen-entry grace" and the four corners stay put with no loader; a capture after the grace
window shows the arc normally through to card generation.

Debug flags reset (`debugStartState` → Launch); compiles clean; clean boot; project saved.

### 44. Saved panel above the placed ball, Review at 70%, tighter reveal-journal + Jar month spacing, "is the ball saved?"

> after placing the ball, the 'today is folded away' window is too far, make it just right
> above the ball / when i press 'review today', can the whole page scale down a bit? to
> 70%? / reveal journal: scale up the journal text a bit, and make the gap between title,
> text, and btns smaller / revisit this month: the date and 'back to home' are a bit too
> far from each other now / and is it working now that everyday's ball will be saved? today
> i opened it i didnt see the ball i placed before

→ **1.** `OrbScreen.finalizePlacement` now records `lastPlacedWorldPos` + `lastPlacedRadiusCm`;
`buildSavedPanel`, for a "placed" save, floats the (smaller, 32×26) "Today is folded away"
panel at `ballPos + (0, radius + halfHeight + 3, 0)` facing the camera yaw — just above the
parked ball instead of dead-ahead at `panelDistanceCm`. **2.** `ReviewScreen` content scale
is now `0.7 × Math.min(1, fit…)` (`[Review] built … scale=0.70`). **3.** `JarScreen`
revealed day view: panel `h` 58 → 44, `pt.size` 52 → 56, `contentDropCm` 3 → 2, journal
text band pulled into the gap between the title band and the button row. **4.** month view
`footerCY` offset +17 → +11 and `headerCY` +15 → +11 — the date caption + "Back to Home"
now sit close to the spheres. **5.** Answered: the day's *entry* + (since #42) its sticker
thumbnails ARE saved and reappear in the Jar; the ball's *world position in the room* is
NOT persisted across sessions (spatial anchoring is deferred by DESIGN.md), so a past day
shows as a coloured sphere in the Jar grid, not a ball floating where you left it. Within
one session the real placed ball is shown at its spot.

Debug flags reset (`debugStartState` → Launch, all `debug*` bools false); `traceJournal.days`
+ thumbs wiped; compiles clean; clean boot. Preview-verified: reveal-journal spacing, month
view spacing, Review scale=0.70 in the log. Code-verified only: the saved panel's position
above the ball (the autopilot places the ball at the camera in Preview and the panel window
is ~1 s).

### 45. Past placed balls reappear where they were left, across sessions

> yes, i want past balls to reappear where you placed them across sessions

→ New `PlacedOrbStore.ts` (plain module) persists each parked ball's WORLD position +
diameter + day colour under `traceJournal.placements`, keyed by entry id.
`OrbScreen.finalizePlacement` calls `recordPlacement(...)` on Confirm. New `PlacedOrbs.ts`
component on the always-on OrbSpawner, in `onAwake` (before any screen builds), reads the
store and rebuilds each ball at its saved spot — matte tinted orb + white-core glow disc +
two rounded dark eyes, billboarded to the camera and blinking each frame (same look
OrbScreen gives a fresh placement). Each restored ball is registered in `sessionPlacedOrbs`
so "Revisit the Month" surfaces it exactly like a same-session placement.
`JarScreen.deleteDay` → `forgetPlacement(id)`; the Jar debug wipe also clears
`traceJournal.placements`. Wired `PlacedOrbs` (orbMesh / orbMat / cameraObject) onto
OrbSpawner.

CAVEAT (documented in `PlacedOrbStore.ts`): the saved position is relative to the device
tracking origin, which is only approximately stable session-to-session without a persistent
spatial anchor. Same room, it lands close; drift-free anchoring would need Spatial Anchors
(separate feature).

Verified in Preview across two sessions: session 1 places + `[PlacedOrbStore] recorded …`;
session 2 (fresh refresh) `[PlacedOrbs] restored 1 parked ball(s)` and the creature-orb is
back at its spot; opening "Revisit the Month" shows that day as the real placed orb ("Your
placed orbs are around you — tap one to open its day.") not a grid sphere. Debug flags
reset; `traceJournal.days` + thumbs + placements wiped; compiles clean; clean boot; saved.

### 46. App-wide UI font, saved-panel spacing, "can't Review Today in a new session"

> 1. where can i custom my ui font? i want to pick a new one to replace all texts
> 2. "today is folded away" window now overlapped with okay, seperate them a bit
> 3. when i start a new session, i cant review today, but i already created one for today

→ **1.** New single knob: `UITheme` component now has a **Font** @input. `UITheme.applyFont(t)`
is called at every runtime Text creation — PanelKit.makeText (all panel titles / bodies /
button labels) plus the six free-text spots (GenerateScreen paragraph, JarScreen date
caption + revealed journal text, MemoryCardSpawner OCR line, OrbScreen place hint,
ReviewScreen ✓). Set the Font slot (drop a .ttf in Assets/ or import via the Font panel /
`/font-selector`) and every UI text picks it up on the next screen build. Imported
**Manrope** and wired it as the current font — swap the slot for any other.
**2.** `OrbScreen.buildSavedPanel` "placed" panel grew 32×26 → 40×38 with `titleSize: 110`
so "Today is folded away." / "Placed in space." / "Okay" no longer overlap (they were
colliding after Round R shrank it).
**3.** `LaunchScreen` — "Review Today" is now enabled when `keptCount() > 0` **OR** today's
journal already exists in the §13 store (`todaysSavedEntry()`). In a fresh session with no
live moments it routes to the Jar opened straight on today's day view (new
`JarScreen.requestJarDay(id)` consumed in OnStart/OnEnable). Verified: cold start with a
saved-today entry → `[Home] built — moments=0 reviewEnabled=true`.

Debug flags reset (`debugStartState` → Launch, all `debug*` false); stores wiped; compiles
clean; clean boot; project saved. Font change verified in Preview (all Home text renders in
Manrope).

### 47. "Add to Today's Journal" — capture a new moment after the day's journal exists

> if i capture a new one while i already captured one before and created the journal, i
> cant add the new one to the journal, and if i press 'review today' i can only see the old
> journal and old sticker. how to solve? if i capture a new one, i want a new btn: add to
> today's journal (something like this, you can pick a good word for me)

→ Cause: a new session starts a fresh JournalEntry (new id), and #42/#46 then blocked the
create-journal path once today was saved — so new moments had nowhere to go.

Fix — a real **"Add to Today's Journal"** path:
- New `DayStore.ts` (one place to read `traceJournal.days`): `readSavedDays`,
  `todaysSavedEntry`, `findSavedById`. LaunchScreen/ReviewScreen's private copies fold into it.
- `JournalSession.hydrateForAppend(data)` adopts today's saved entry's **id** (so the save
  UPSERTS, not adds a 2nd entry) + its feeling/colour; `isAppending()` / `getAppendBase()`
  (re-reads the store each call so a 2nd add builds on the 1st).
- `MomentEmotionReflect` "Moment saved" panel: when `todaysSavedEntry()` exists, the primary
  button is **"Add to Today's Journal"** — it `hydrateForAppend`s then → Review. (Falls back
  to "Create Today's Journal" for a brand-new day.)
- `LaunchScreen` "Review Today": with new live moments AND today already saved → also
  `hydrateForAppend` → Review; with no new moments → open the Jar on today (unchanged).
- `GenerateScreen`: in append mode the new paragraph is joined onto the saved one with a
  `·  ·  ·` separator; title kept; object labels / ocr / selectedMomentIds merged.
- `ReviewScreen`: append mode shows the normal create flow ("Add to Journal" button, "Which
  of these to add…" header) instead of the "already saved / Revisit" state.
- `StickerStore.persistStickers(id, traces, append)` — append keeps the existing thumbs and
  adds the new ones (cap 8).
- `OrbScreen.finalizePlacement` retires any prior ball for the same day before registering
  the new one (no duplicate in the room).

Verified across two Preview sessions: session 1 saved a journal; session 2 captured new
moments → `hydrateForAppend -> adopting saved entry <id>` → generated → `[Orb] persisted —
1 day(s) total in store` (upsert, NOT 2) with id = session 1's. Jar day view shows
`[original]  ·  ·  ·  [appended]` + the reflection. Revealed panel now grows for a long
(appended) entry so the text clears the buttons.

Debug flags reset; `traceJournal.days` + thumbs + placements wiped; compiles clean; clean
boot; project saved.

### 48. "Add to Today's Journal" — Generate screen overflowed / looked like two overlapping journals

> after i press 'add to today's journal', it showed the original journal, which is right,
> but when i pressed regenerate, i expect the new journal replace the old one, but it turned
> out two journal being there, so the window is quite long and they overlapped with each
> other

→ There was no double-append (Regenerate rebuilds `saved base + · · · + fresh` from the
store each time, so it does replace the new part) — the real problem was `GenerateScreen`'s
result panel had a FIXED text band (`paragraphH = 26`), so the doubled length (original +
separator + addition ≈ 130 words) spilled onto the reflection and the icon buttons.

Fix: `GenerateScreen.buildDonePanel` grows the text band with the entry length
(`generatedJournalText.length > 620` → +5 cm per 120 chars, cap 52) and scales the whole
panel down if the taller `H` would exceed the FOV (`H > 66` → `scale = 66/H`).

Verified in Preview (append flow, stopped on the Generate screen): the panel grew to
`panelH=68.7` and shows [original] · · · [addition] + the reflection with the 4 icon
buttons clearly below — no overlap. Regenerate still replaces only the addition.

Debug flags reset; stores wiped; compiles clean; clean boot; project saved.

### 49. Separate font for paragraph/prose text; sphere glow covering the creature's eyes

> with all paragraph text, i want to change to other type of font
> and sometimes the reflection of the sphere material's white part cover the creature's
> eyes, fix it

→ **1.** New second slot on `UITheme`: **Paragraph Font** (`getParagraphFont()` /
`applyParagraphFont(t)`, falls back to the UI font when empty). Applied to the LONG-FORM
PROSE only — GenerateScreen's journal paragraph + closing reflection (`addFreeText`) and
JarScreen's revealed journal text — so the reading text can be a different family from the
chrome (the user had set the UI font to a display face). Imported **Lora** (serif) and
wired it to `paragraphFont`; swap the slot for any other.
**2.** The camera-facing white-core glow disc was rendering AFTER (on top of) the eyes on a
PLACED orb: `finalizePlacement` reparented the eyes onto the sphere BEFORE the glow, making
the glow the later sibling. Swapped the order (glow first, eyes last → eyes on top). Also
softened `radialGlowTexture`'s dead-centre (peak `0.92→0.85`, plus a small dip inside
`d<0.16`) so the dark eyes keep their contrast on a bright orb. Verified in Preview: the
placed orb's eyes and a restored orb's eyes both read clearly over the white core.

Debug flags reset; stores wiped; compiles clean; clean boot; project saved.

### 50. Review popup sits too high; placement-phase rework (billboard hint, fixed pinch distance, curved tether, WorldQuery surface snap)

> AFTER I CAPTURE OBJECT AND THEN PRESS 'CREATE TODAY'S JOURNAL', THE POPUP WINDOW IS TOO
> HIGH, IT SHOULD IN FRONT OF PLAYER'S sight, BUT VERTICAL TO GROUND
>
> in the placement phase of ball, the 'pinch to place' is not billboard, fix it. and the
> ball should have a specific distance with user's pinch, and i want to add a curve line
> trace between ball and pinch, and use world query module so that's easier for me to
> attach the ball to the surface of my room

→ **1. Review popup height (`ReviewScreen`).** The panel spawns at the camera position
with a yaw-only rotation (already upright / vertical to ground), but the moment-card tree
is top-weighted (tall header stack + up to 5 cards vs a 2-button footer), so its readable
mass sat above the sight line. `rebuild()` now drops the content holder by
`vDrop = -(headerCY - traceH/2)` (scaled), which re-centres the header + cards on the eye
line while keeping the panel upright and directly ahead.

**2. Placement-phase rework (`OrbScreen`, the "Place in Space" follow phase).**
- **Billboard the hint.** `billboardHint(ballPos)` puts the "Pinch to place" text just
  above the floating ball and sets its rotation with `quat.lookAt(camPos - hintPos, up)`
  every frame — a true billboard (was a fixed-yaw label before).
- **Fixed distance from the pinch/hand.** The ball eases toward `placeHitPos || (origin +
  dir * placeDistanceCm)` and is clamped to never come closer than `PLACE_MIN_CM` (25 cm)
  or further than `PLACE_MAX_CM` (320 cm) from the aim origin, with a smoothed follow
  (`lerp k = min(1, dt*9)`), so it floats a consistent gap ahead of the hand.
- **Curved tether.** `buildPlaceTrace()` / `updatePlaceTrace(a, b)` draw a camera-facing
  ribbon along a quadratic Bézier from the hand (`a`) to the ball (`b`) with a downward sag
  control point (`mid + (0, -min(30, span*0.16), 0)`), 22 segments, `MeshBuilder`
  interleaved `position`+`texture0`, `UILine.mat` clone with depth test/write off. Cleared
  on pinch-confirm, reset, and screen exit.
- **WorldQuery surface snap.** `ensurePlaceHitSession()` creates + `start()`s a
  `WorldQueryModule` hit-test session (skipped in the Editor — no depth there). Each frame
  `updatePlacementFollow()` casts `origin → origin + dir*PLACE_MAX_CM`; on a hit it offsets
  the ball out along the surface normal by the sphere radius so the ball rests ON the wall
  / floor / desk instead of intersecting it. No hit (or Editor) → the fixed-distance ray
  point is used.

### Verification
`ReviewScreen`: Preview screenshot shows the moment-card panel centred on the sight line,
upright, directly ahead. `OrbScreen`: full `debugAutopilotPlace` flow ran end-to-end in
Preview with no runtime errors (`[Orb] placing — sphere follows the aim ray + snaps to room
surfaces (WorldQuery)…` → pinch stand-in → Confirm → `[PlacedOrbStore] recorded …` → Home).
WorldQuery is inert in the Editor (no depth map) so the surface-snap + the near-end-on
tether can only be confirmed on-device; the billboard hint, the `PLACE_MIN/MAX_CM` clamp
and the Bézier ribbon build are code-verified and compile clean.

Debug flags reset (`debugStartState` → Launch, `debugAutopilotPlace` → false); autopilot
step delays restored (2.2 / 3.4 / 4.6 s); `traceJournal.days` + thumbs + placements wiped;
compiles clean; clean boot (`(start) -> Launch`, moments=0, restored 0 parked balls);
project saved.

**#50 follow-up (clarification).**

> i mean the line trace is between the ball and user's hand, so the ball is
> following the user's hand movement while it can only be placed on the surface,
> so before pinch it equals to the placement preview. player use pinch to really
> place it.

Re-worked the follow phase to match that model exactly:
- **Tether starts at the real pinch point.** New `getPinchAnchor()` = midpoint of
  the dominant hand's `thumbTip` + `indexTip` world positions (SIK `HandInputData`);
  camera position in the Editor / when the hand isn't tracked. The curved line and
  the WorldQuery ray both now originate here (was the stabilised targeting locus).
- **The follow ball IS the placement preview.** It tracks the hand every frame and
  rests ON the room surface the aim ray hits (position + normal·radius). Pinch just
  freezes it exactly where the preview sits.
- **Surface-only, with memory.** New `placeLastGoodHit` — when the ray briefly
  slides off a surface the ball holds the last real spot instead of snapping out
  to a mid-air distance. The `placeDistanceCm` mid-air hover is now only the
  bootstrap before the first-ever hit (and the Editor, which has no depth).
- `PLACE_MIN_CM` clamp is now measured from the pinch anchor.

Confirm / Reset on the frozen ball is unchanged (pinch → freeze → Confirm commits /
Reset resumes following). Compiles clean; full `debugAutopilotPlace` run in Preview
had no script errors (`[Orb] placing — preview ball tracks the hand + rests on the
room surface (WorldQuery), tethered to the pinch` → pinch stand-in → Confirm →
`[PlacedOrbStore] recorded …` → Home). Hand-joint anchor + real surface snap are
device-only (Editor has neither). Debug flags reset; stores wiped; clean boot;
project saved.

**#50 follow-up 2.**

> 1. the line trace is not between hand and ball now, it looks the line is
> extend to the ground. and the ball is not moving along the surface. do u use
> the world query module? or do you have a better solution
> 2. if i add a new capture after i already have a journal created, if i press
> 'add to journal', then it showed the old journal, but if i press regenerate,
> it should generate a new journal combines with two captures, and it should
> replace the old one, the old one gone

**1 — placement (`OrbScreen`).** The "line to the ground" was the tether anchor:
the raw `thumbTip` / `indexTip` SIK keypoints come back at the tracking origin
(floor) unless the full hand-mesh skeleton is up, so the curve ran from the floor.
The ball not tracking the wall was the WorldQuery ray *starting* at that bad hand
point — a ray whose origin is a hand joint routinely falls outside the camera
frustum and `hitTest` then returns null every call.
Better solution (the pattern the capture flow already uses on device):
  - cast the WorldQuery ray FROM THE CAMERA (always in frustum → the depth map
    can answer) AIMED ALONG THE HAND'S POINTING DIRECTION, so sweeping the hand
    slides the ball across the real surface.
  - tether anchor = the hand's SIK *targeting locus* (`targetingData.targetingLocusInWorld`
    — the wrist-anchored point `getAimRay()` already uses reliably), not the raw
    finger joints. `getPinchAnchor()` → `getHandAnchor(camPos, dir)`.
  - hold the last good surface hit when the ray leaves a surface for a frame.
  - tether sag cut right down (`min(9, span·0.06)`) so it reads as a gentle curve.

**2 — regenerate unifies (`GenerateScreen`).** `runGeneration(unifyAppend)`:
  - the auto-fire after "Add to Today's Journal" keeps the old journal + joins
    the new moment(s) on (unchanged — "it showed the old journal, which is right").
  - **Regenerate** now runs `runGeneration(true)`: `reconstructBaseMoments(appendBase)`
    (the saved day's labels/OCR + its prose as context) is prepended to the new
    moments and Gemini writes ONE fresh journal that REPLACES `generatedJournalText`
    entirely — title + reflection from the new result, old text gone.
  - `mergeAppendEvidence()` recomputes the label/OCR/id union from the stable
    store base + this session's traces each call, so repeated regenerates don't
    grow the arrays (old latent bug).

Also fixed: the scene's `GeminiService.model` was `gemini-3.5-flash-preview`
(404 — no such model), blocking ALL journal generation. Set to
`gemini-3-flash-preview` (the code default + the first RSG-verified id in the
hint).

### Verification
Two-session Preview autopilot: session 1 saved a day (~80-word journal); session 2
`hydrating for APPEND` → first gen = 133 words (old + `· · ·` + new) → autopilot
Regenerate → `generateJournal start — 5 moment(s)` (2 reconstructed + 3 new) →
`OK :: title="Quiet Corners and Ceramic Mugs"` (a NEW title spanning both days) →
`showing result — words≈48` (old 133-word text replaced) → Save → `[Orb]
persisted — 1 day(s) total in store` (upsert, not 2). No script errors. Placement
rework compiles + runs clean; the camera-origin/hand-direction ray, the locus
anchor and the surface-hold are device-only (Editor has no depth / hands). Debug
flags reset; stores wiped; clean boot; project saved.

**#50 follow-up 3.**

> after i press 'create today's journal' after capture, the pop-up window is too
> high, it should be the same position of previous window ... same for
> 'composing your day...' window
>
> now the ball placement phase is following player's eye sight instead of hand
> movement, fix it and the line trace should connect player's hand and the ball,
> instead of the ball and the ground
>
> 'today felt...' window, remove the '...' text, and make the pop-up window's
> position the same as previous one, now it's too high
>
> and if i press edit icon in the journal page ... the title, text and the btns
> are overlapped. down the btns a bit.

**Placement follows the eyes, not the hand — root cause found.** `getAimRay()` /
`getHandAnchor()` read `hand.targetingData`, which is only populated when the SIK
*interactor stack* drives it — this project doesn't run that stack, so it's
always `null` and the aim fell back to the camera-forward ray (the "eye sight")
with the tether anchored to a camera-relative point near the floor.
Fix: new `getHandPose()` reads the dominant hand's TRACKED JOINT KEYPOINTS
directly (`getPalmCenter()` / `middleKnuckle` / `wrist` for position,
`indexKnuckle -> indexTip` for direction) — these come from `ObjectTracking3D`
and work whenever hand tracking is on (which the pinch gestures already prove).
`updatePlacementFollow()` now casts the WorldQuery ray **from the hand** along
the hand's pointing direction and draws the tether **from the hand** to the ball,
so the ball tracks hand movement and the line connects hand↔ball. Editor / hand
lost → camera-forward stand-in (Preview tap-to-place still works).

**Popup heights — matched to the previous window.**
- `ReviewScreen`: overall scale 0.70 → 0.55, and the content is now anchored so
  the HEADER's top edge sits `HEADER_TOP_CM` (9) above the sight line instead of
  ~20 cm up. Header near the top of view, cards centred, buttons at the bottom —
  all in frame (Preview-verified).
- `FeelScreen`: fit cap 58 → 50 (scale ~0.64 → ~0.56); panel top edge anchored
  ~12 cm above the sight line. Prompt text `"Today felt…"` → `"Today felt"` (the
  "…" removed, scene input).
- `GenerateScreen` loading ("Composing your day…") + error + both edit panels:
  `localPosition.y` 0 → −6 so they sit where the "Create Today's Journal" window
  was, not at dead-centre / high.

**Edit panel overlap.** `GenerateScreen.buildEditPanel` — prompt panel
`heightCm` 40 → 54, captured panel 50 → 56, both `buttonScale: 0.82`. That opens
a clear gap between the sub-caption / captured text and the top of the vertical
button stack (was overlapping the title + body).

### Verification
Preview screenshots: Review (scale 0.55) — header, 3 cards, 2 buttons all in
frame, centred on the sight line. Feel — "TODAY FELT" (no ellipsis), panel + 5
buttons fully in view. Generate loading — "COMPOSING YOUR DAY …" sits just below
centre where the prior window was. Full Review→Feel→Generate autopilot ran with
no script errors. Placement hand-keypoint path is device-only (Editor has no
hands); compile-clean + the autopilot place chain ran clean earlier. Edit-panel
gap is geometry-verified (no autopilot path to screenshot it). Debug flags reset;
stores wiped; clean boot; project saved.

**#50 follow-up 4.**

> after placement, the confirm and the reset btn and window above the ball is
> not facing player, so sometimes i see them from the back
>
> for the placement phase i want: just like the surface / world query placement,
> while moving the mouse in editor you can see the preview following your cursor
> with a certain distance (not attached to the pinch directly) — maybe remove
> the line trace and add it back after a module drives it

**Confirm / Reset facing away (`OrbScreen`).** The row was oriented ONCE at
build time (`faceHolderAtSphere`, yaw-only) so walking around the placed ball
left it edge-on or backwards. Replaced with `orientConfirmHolder()` — runs
EVERY FRAME while `awaitingConfirm`, positions the row just under the ball and
sets its rotation to the CAMERA'S world rotation (screen-aligned billboard).
The follow-phase "Pinch to place" label got the same treatment
(`billboardHint` → camera rotation instead of `quat.lookAt(toCam, up)`, which
flips when you look straight down at a low ball — that was the "seen from the
back").

**Editor cursor-follow preview.** `getHandPose()` is null in the Editor, so the
preview just sat straight ahead. Now `OrbScreen` tracks the mouse
(`TouchMoveEvent` / `TouchStartEvent` → `editorCursor`) and, when there's no
tracked hand, `updatePlacementFollow()` unprojects the cursor through the camera
(`Camera.screenSpaceToWorldSpace(editorCursor, placeDistanceCm)`) and eases the
ball to that point — so in Preview the ball follows the cursor at a fixed
distance, same idea as the on-device hand/WorldQuery follow.

**Line trace.** Now drawn ONLY when a real hand or a WorldQuery surface hit is
driving the preview (device). In the Editor the ball just follows the cursor
with no tether (`buildPlaceTrace` early-returns in the Editor) — per "remove the
line trace, add it back after a module drives it".

### Verification
Preview: Confirm / Reset screenshot — both buttons square-on and readable below
the ball. Full `debugAutopilotPlace` chain ran with no script errors (the Editor
`screenSpaceToWorldSpace` branch runs clean during the follow). Cursor-follow is
Preview-interactive (can't inject mouse motion here) — compile-clean and the
unproject path ran without throwing. Debug flags reset; autopilot delays
restored; stores wiped; clean boot; project saved.

**#50 follow-up 5.**

> Confirm/Reset (and the label) and "today is folded away" still not facing the
> player

The earlier attempts only tracked head ROTATION (`quat.fromEulerAngles(0,yaw,0)`,
then copying the camera's world rotation) — so as soon as the user *stepped*
past the ball without turning, or the euler decomposition flipped under pitch,
the panels faced away.

New shared helper `faceCameraFlat(t, worldPos)`: every frame it points the
object's local +Z at the CAMERA'S CURRENT WORLD POSITION
(`quat.lookAt(camPos - worldPos, up)` — same convention as the orb-eye billboard
that has always worked), with the aim flattened onto the ground plane so the
panel stays upright and can't gimbal-flip when you look straight down at a
floor-level ball. Applied per-frame to all three:
- Confirm / Reset row (`orientConfirmHolder` → `faceCameraFlat`, in `onUpdate`
  while `awaitingConfirm`).
- "Pinch to place" label (`billboardHint` → `faceCameraFlat`).
- "Today is folded away." panel over a placed ball — was oriented ONCE in
  `buildSavedPanel`; now stored (`savedPanelRoot` / `savedPanelAnchor`) and
  re-aimed every frame in `onUpdate`.

### Verification
Preview (default camera): Confirm / Reset readable and square-on below the ball.
Orbiting the *editor* camera can't verify this (the Lens still renders through
the fixed scene Camera Object, which the script reads), but the helper is the
exact per-frame `lookAt(camPos - pos)` the placed-orb eyes use and those have
never faced away. Compile-clean; autopilot place chain ran with no errors. Debug
flags reset; autopilot delays restored; stores wiped; clean boot; project saved.

**#50 follow-up 6.**

> 1. download the world query module, and use that to replace the 'pinch to
> place' feature we have now. after adding that, add a visible line trace
> between hand and ball
> 2. after i press 'review this month', and i press the ball to see that day's
> journal, the journal should be spawned above the ball, instead of the window
> position

**1 — WorldQueryHit + SIK-interactor placement (`OrbScreen`).** Installed the
Asset Library **WorldQueryHit** package and deleted the example scene object it
drops in. Rebuilt the "Place in Space" follow on its recipe:
- `ensurePlaceHitSession()` now `createHitTestSessionWithOptions({ filter: true })`
  (smoothed hits) instead of the bare session.
- `updatePlacementFollow()` gets the SIK hand-ray interactor
  (`SIK.InteractionManager.getTargetingInteractors()`, filtered to
  `isActive() && isTargeting()`) and casts
  `hitTest(interactor.startPoint(+nudge), interactor.endPoint, …)` — the ball
  rests on `hit.position + normal * radius`.
- The drop gesture is the interactor's **trigger-RELEASE edge**
  (`InteractorTriggerType` → None), the same gesture the WorldQueryHit example
  uses — this replaces `GestureModule.getFilteredPinchDownEvent` entirely
  (that field + `subscribePinch`/`unsubscribePinch` + `getHandPose` removed).
- **Visible line trace** hand→ball every frame from `interactor.startPoint`
  (ribbon thickened `halfW` 0.35 → 0.7). Editor keeps the mouse-cursor follow +
  tap-to-drop, no tether.

**2 — day journal spawns above the tapped ball (`JarScreen`).** Both tap paths
(grid sphere `buildDaySphere`, room-placed orb `surfacePlacedOrb`) now record the
ball's world position + radius before `openDay()`. `buildDayView()` then places
the day panel in WORLD space just above that ball (bottom edge clear of the
ball), gently clamped so a ball near an FOV edge can't push the panel out of
view (X within ±22 cm of the sight line, top ≤ eye + 24 cm). Opened without a
tap ("Review Today") → `lastTapWorldPos` null → the panel stays centred as
before. Cleared whenever the month grid rebuilds.

### Verification
Preview: `debugAutopilotPlace` place flow runs clean on the new SIK/WorldQuery
path (`[Orb] placing — World Query surface follow along the SIK hand ray…` →
drop → Confirm → `recorded …` → Home), no errors; the interactor + trigger-edge
path is device-only (Editor has no SIK hand interactor, uses the cursor
fallback). Jar: seeded 3 days, auto-opened day one — `[Jar] day view built …
above-ball=true`, screenshot shows the panel floating above where the ball was.
Debug flags reset; example object removed; stores wiped; clean boot; saved.

**#50 follow-up 7.**

> 1. sometimes the first capture I didn't get a sticker, only the original
> capture. quite frequent. fix it.
> 2. the generated journal window is too high. spawn it at the same position as
> the previous one. check other windows for the same problem, fix them.
> 3. I didn't see the world query module in the scene. make sure you really
> replaced the old placement mechanics with WorldQueryHit.

**1 — first capture had no cut-out (`ScanScreen.onAnalyzeSuccess`).** The card is
shown after `SEG_SPAWN_TIMEOUT_SEC` if `segmentPrimary` hasn't resolved — and on
the FIRST capture the cold Gemini connection often took >10 s, so the timeout
fired, the card showed the raw still, and the late polygon result was then
**thrown away** (`if (done) return`). Now: if segmentation arrives after the
card is already up, it's applied in place (`applySegmentation` re-finds the live
card and even reaches an already-kept trace). Timeout also raised 10 → 16 s so
the first call more often lands before the card appears.

**2 — generated-journal window (and others) too high.** Every reading window now
anchors its TOP edge ~9 cm above the sight line instead of centring on it:
- `GenerateScreen.buildDonePanel` — was the only Generate panel still at Y=0
  (loading/error/edit were fixed earlier); now top-anchored (+ scale-down cap
  tightened 66 → 60).
- `ConfirmScreen` — fan-out tree, header-top anchored (mirrors ReviewScreen).
- `ReflectScreen` — single panel, top-anchored.
- `OrbScreen.buildSavedPanel` — the non-placed "Kept private" panel top-anchored
  (the placed one already floats above the ball).
ReviewScreen / FeelScreen were already done. ScanScreen's title sits by the
head-locked reticle (intentional) — left as-is.

**3 — placement really is on WorldQueryHit.** The old mechanics ARE gone
(`GestureModule.getFilteredPinchDownEvent`, `subscribePinch`, `getHandPose` — all
removed). The package `WorldQueryHit.lspkg` is installed under `Packages/`; the
`WorldQueryModule` is a code `require`, it has no scene object (nor does the
capture flow's, which has used it for months). `updatePlacementFollow` now:
`SIK.InteractionManager.getTargetingInteractors()` →
`createHitTestSessionWithOptions({filter:true})` →
`hitTest(interactor.startPoint, interactor.endPoint)` → drop on the
`InteractorTriggerType`→None edge. Added a device log so it's visible:
`[Orb] WorldQuery hit-test session started (filtered)…` on begin, and a throttled
`[Orb][WorldQuery] follow — interactor=… session=… hit=…` while placing.

### Verification
Preview: Generate done panel screenshot — title at the top of view, paragraph,
reflection and the 4 icon buttons all in frame (was off-screen-high at Y=0).
`debugAutopilotPlace` place flow runs clean and logs
`[Orb] WorldQuery hit-test session started` + `[Orb][WorldQuery] follow —
interactor=no session=no hit=none` in the Editor (device shows yes/yes/surface).
Sticker late-upgrade is logic-only (the Editor autopilot seeds moments and skips
the capture→Gemini path). Debug flags reset; stores wiped; clean boot; saved.

**#50 follow-up 8.**

> in placement, the ball only moves when I move the CAMERA, not when I move my
> CURSOR — it's not following the pinch pointer. And I want the pinch dot (the
> one I see when I pinch UI buttons) visible while placing too.

Root cause: `updatePlacementFollow` was `global.deviceInfoSystem.isEditor() ?
null : this.getPlaceInteractor()` — it deliberately skipped the SIK interactor
in Preview and used a camera-forward unproject, which only tracks the head.
But SIK's **MouseInteractor** (the thing that drives the Preview cursor + the
pinch dot) IS registered in the Editor and its ray follows the mouse.

Fixes:
- `updatePlacementFollow` now calls `getPlaceInteractor()` unconditionally, so
  the follow is driven by the SIK interactor on BOTH device (HandInteractor) and
  Preview (MouseInteractor → the ball follows the cursor).
- `getPlaceInteractor()` no longer requires `isTargeting()` (the Preview
  MouseInteractor only reports that while a button is held — its cursor ray is
  valid the whole time). It now takes the first `isActive()` interactor with a
  `startPoint`/`endPoint`, checking `getTargetingInteractors()` first, then
  `getInteractorsByType(All)`.
Because the follow is now the interactor's own ray, SIK renders its cursor for
the active interactor while placing — the same dot as on the UI buttons.

### Verification
Preview: entered placement, injected cursor moves — diagnostic flipped
`[Orb][WorldQuery] follow — interactor=no` → `interactor=yes`, and the screenshot
shows the follow ball tracking to the cursor's corner (was locked to camera
forward before). `debugAutopilotPlace` place flow still completes clean. Debug
flags reset; autopilot delays restored; stores wiped; clean boot; saved.

**#50 follow-up 9.**

> 1. "today is folded away" should spawn IN FRONT of the player.
> 2. add a 20 cm long line trace between the player's gesture and the ball.

**1 — `OrbScreen.buildSavedPanel`.** Dropped the `placedNearBall` branch that
floated the confirmation above the parked ball. Both the placed ("Today is
folded away.") and kept-private confirmations now `spawnInFrontOfUser()` +
top-anchor like every other window. The placed ball stays where it was parked.

**2 — 20 cm gesture→ball line (`OrbScreen`).** New `PLACE_TETHER_CM = 20`.
`updatePlaceTrace` rewritten from the sagging Bézier to a STRAIGHT camera-facing
ribbon that runs `PLACE_TETHER_CM` from the pinch point toward the ball (or
stops at the ball if nearer). `buildPlaceTrace` no longer skips the Editor, and
in the Editor the trace anchor is nudged down-and-right of the cursor (the
Preview "hand" is the camera, so a straight-ahead line would be invisible) so
the line reads in Preview recordings. `updatePlacementFollow` draws it whenever
a gesture interactor is driving the follow.

### Verification
Preview placement + injected cursor: ball follows the cursor, "PINCH TO PLACE"
billboard above it, the short line ribbon renders from the offset anchor toward
the ball (near-end-on in the Editor — clearer on device where the hand is off to
the side). `debugAutopilotPlace` place→save→Home runs clean; the saved
confirmation now builds via `spawnInFrontOfUser` like Feel/Review/Generate.
Debug flags reset; autopilot delays restored; stores wiped; clean boot; saved.

### 51. Finish the remaining MVP items (no on-device test, no song screen)

> 1. don't need to be tested on Spectacles this time
> 2. finish the left things
> 3. not adding the song screen this time

**Multi-month Jar navigation (§12, `JarScreen`).** The month grid showed every
saved day at once under one month label. Now days are bucketed by month
(`monthKey`), the grid shows ONE month, and a `[ Prev ] [ Back ] [ Next ]`
footer row navigates between months (arrows dimmed at the ends, hidden when
there's only one month). `monthIdx` defaults to the newest month on a fresh
open and is kept across a month↔day round trip. Placed room orbs from other
months are hidden while browsing a different month. `debugSeed` now spans two
months (Aug + Sep) so the nav is exercisable in Preview.

**Hung-request fallbacks (§14).** `GenerateScreen.runGeneration` and
`ScanScreen`'s `analyzeTrace` each get a client-side watchdog
(`GEN_WATCHDOG_SEC` / `ANALYZE_WATCHDOG_SEC` = 55 s): if the transport never
settles, drop to the error panel / clear the loading state instead of trapping
the user on the spinner forever. Both `.then`/`.catch` now no-op if the watchdog
already fired (a `settled` flag). RSG's own ~30 s deadline + one retry means a
real call always settles well inside this.

### Intentionally NOT done
- §7 song screen — cut, per request.
- Real same-room spatial anchoring — large feature; the world-position
  persistence (`PlacedOrbStore` / `PlacedOrbs`) is the shipped stand-in.
- Palm-up hand menu to summon the Jar — device-only, unverifiable; the button
  works.
- Orb radial gradient shader (Fresnel node in the graph) — fragile 45 KB graph
  edit; matte+emissive approximation kept.
- Pruning the disabled `TraceJournalSpike*` rigs — inert (scene objects all
  `Enabled: false`); scene surgery not worth the risk near a demo.

### Verification
Full Review→Feel→Generate(+regenerate)→Orb autopilot chain runs clean, no
errors. Jar Preview: `debugSeedDays` → "SEPTEMBER 2026" with 3 of 4 days, PREV
enabled / NEXT dimmed (newest month). Debug flags reset; stores wiped; clean
boot; project saved.

### 52. Orb radial gradient — white centre → colour edge

> can you try to do the Orb radial-gradient shader?

A true in-shader Fresnel would mean node surgery on the 44 KB `Vertex Distortion`
graph shader in a proprietary serialization — no safe way to author that blind,
and a broken shader takes the whole Orb screen with it. Instead the camera-facing
gradient DISC (already laid over the orb) was upgraded from white→transparent to
a real **white core → bright day-colour band → clear** radial ramp:
`tintedOrbGradient(colorHex)` bakes a 128 px RGBA texture per distinct colour
(cached) — RGB lerps white→(1.22×colour+22) by `d≈0.42`, alpha holds through the
core+colour band and fades `0.5→0.94`, with the centre dip kept so the dark eyes
stay legible. `OrbScreen.buildOrbGlow(colorHex)` and `PlacedOrbs.buildGlow(d,
colorHex)` both use it (falling back to the old white texture if the bake fails).

Result: the orb reads as a glowing gem — bright white core, saturated colour rim,
clean silhouette — the look a Fresnel node gives, done safely in code and
independent of the sphere's spin.

### Verification
Preview: full Review→Feel→Generate→Orb chain, no errors; the saved #5B8DEF orb
shows the white-core → blue-edge gradient with the eyes still readable dead-centre.
Debug flags reset; stores wiped; clean boot; project saved.

### 53. Glow to 50%; "Today is folded away" back above the ball; sticker misses explained

> 1. scale the glowing effect down to 50%
> 2. after Confirm, "today is folded away" is not spawned above the ball — make
>    sure it spawns correctly
> 3. sometimes the sticker isn't generated, I still see the original capture —
>    what happened?

**1 — glow 50%.** `OrbScreen.tintedOrbGradient` now multiplies the baked alpha by
`GLOW_ALPHA_SCALE = 0.5`, so the whole view-radial disc (real orb + restored
orbs) is half as strong — the day colour reads through more, the white core is
softer. Preview confirms the placed #5B8DEF orb glow is visibly gentler.

**2 — saved panel above the ball.** Round Y's #51 moved it to spawn "in front of
the player" per an earlier request; this reverses that. `buildSavedPanel` restores
the `placedNearBall` branch: for a PLACED day the "Today is folded away." panel is
anchored `radius + halfHeight + 4 cm` above `lastPlacedWorldPos` (world-space) and
`faceCameraFlat`-billboarded every frame; kept-private stays top-anchored in
front. Verified: `[Orb] "Today is folded away" spawned above the ball at
{x:0, y:31, z:-61}` (ball at 0,0,-61).

**3 — why the sticker sometimes doesn't appear.** The cut-out comes from
`GeminiService.segmentPrimary` (a polygon/box ask). It's the call that most often
blows RSG's ~30 s deadline — when both attempts time out it returns `null` and the
card keeps the RAW capture. Round T's late-upgrade only helps if a real result
eventually lands. Changes to land it inside the deadline far more often:
- segmentation now runs on `gemini-2.5-flash-lite` (the fastest RSG-verified
  model) instead of the main `gemini-3-flash-preview`;
- its JPEG is encoded at `CompressionQuality.LowQuality` (a polygon doesn't need
  detail — much smaller upload);
- 2 attempts → 3.
`analyzeTrace` (which drives the label + the fallback bbox) is unchanged.

### Verification
Full Review→Feel→Generate→Orb+place autopilot: no errors; softer glow; saved
panel logs `above the ball`. Debug flags reset (incl. a stray `debugPreviewOrb`
that had been left on); stores wiped; clean boot; project saved.

### 54. Jar day/reveal journal — too close, sit it higher than the ball

> the reveal journal page spawns right where the player is, it's too close — and
> make it a bit higher than the ball.

`JarScreen.buildDayView`'s above-the-ball placement was pinned to the ball's exact
X/Z, so a ball parked close to the player put the (large, revealed) journal right
in their face. Now it's placed along the **ball's horizontal bearing from the
camera, pushed out to at least `READ_CM = 85`** (stays at the ball's distance if
that's already ≥ 85), and the vertical offset is bigger — bottom edge ~10 cm
clear of the ball plus the panel body, so it sits clearly ABOVE the orb (FOV-top
cap raised to `camY + 32`). Yaw-faces the user as before.

### Verification
Preview (`debugSeedDays` + `debugOpenFirstDay`, with a one-shot hook feeding the
grid sphere's world pos): `day view built … revealed=true above-ball=true`, no
errors; the revealed journal reads at a comfortable distance and above the ball
rather than on top of the camera. Debug hook reverted; flags reset; stores wiped;
clean boot; project saved.

### 55. A sapling on every orb — grows with the day's moment count

> put a sapling on every orb; as the captured memories go up, the sapling grows
> up gradually. (Confirmed: cap at 5 moments; grow visibly with each capture in a
> session; procedural stick-and-leaves; all three surfaces; "Orb only, animated".)

New shared module `Assets/Scripts/Sapling.ts` — `buildSapling(parent,
orbDiameterCm, { scaleMul? })` builds a tiny procedural plant (one tapered stem
quad + up to five diamond leaves, alpha-blended unlit clones of
`ImageMaterial.mat`, depth-test off — the same cheap recipe as the orb eyes /
glow). `momentCountToStage(n)` → `min(5, floor(n))`. `sessionOrbStage: Map<id,
stage>` remembers the last stage shown per day so a re-open animates prev→new.
API: `setStage` (tween toward), `snapToStage` (jump), `place(spherePos, radiusCm,
camPos?)` (world-place at the orb's top, yaw-billboarded), `update(dt)` (ease
`growth01`, lay out stem + leaves — stem reaches full length by growth≈0.55, leaf
`i` unfurls across `[i/5 .. (i+1)/5]` with a soft ease-out-back).

Wiring:
- **OrbScreen** (the animated surface): `buildOrbSapling(entry)` in
  `buildSpherePanel` builds it under the screen root, `snapToStage(min(prev,
  stage))` then `setStage(stage)` — so it grows 0→N on the first build and
  prev→N when "Add to Today's Journal" adds a moment and you re-open the orb.
  `onUpdate` calls `place()` + `update(dt)` each frame; `finalizePlacement`
  reparents it onto the placed sphere (world transform preserved, frozen);
  `destroySphere` tears it down.
- **PlacedOrbs** (restored room orbs): `buildRestored` builds one at
  `momentCountToStage(findSavedById(rec.id)?.selectedMomentIds.length)`,
  `snapToStage` (no tween), `scaleMul: 1.25`; the existing per-orb `onUpdate`
  loop drives `place()` + `update(dt)`; destroyed with the orb.
- **JarScreen** (grid spheres): `buildDaySphere` builds one under the day holder
  at `momentCountToStage(entry.selectedMomentIds.length)`, `scaleMul: 1.6` (reads
  at grid scale), `snapToStage`, static (dies with the holder). The real placed
  orbs surfaced by `surfacePlacedOrb` already carry their frozen sapling from
  OrbScreen — not double-added.

### Verification
Autopilot Review(3 moments)→Feel→Generate→Orb: `[Orb] sapling — stage 0 -> 3
(moments=3)`, runtime tree shows Stem + Leaf1-3 enabled, Leaf4-5 disabled;
screenshot shows a 3-leaf plant on the orb. Jar `debugSeedDays` (2 months):
grid saplings at stage 2 / 1 / 2 for the three September days (correct leaf
counts), screenshot confirms. No compile or runtime errors. Flags reset
(`debugSeedDays`, `debugPreviewOrb`, autopilots, `debugAutopilotPlace`); stores
wiped (`traceJournal.days` + thumbs + placements); clean boot from Launch;
project saved.

### 56. Sticker broken again; sapling grows on append; softer sapling

> 1. the sticker is not working now. fix it. it's important
> 2. if there's already a journal and i add more captures afterward, the sapling
>    should grow as the captures add
> 3. the sapling is a bit hard — make it soft

**1 — sticker cut-out.** Round #53 set segmentation to `gemini-2.5-flash-lite`.
That model (and, it turns out, `gemini-2.5-flash` too) ignores the polygon
instruction and returns `mask` as a base64 **PNG** ("data:image/png;base64,…"),
so `parsePolygonMask` got a string, returned `[]`, and every card silently fell
back to the plain bbox rectangle — no cut-out. Fix in `GeminiService`:
- `SEGMENT_MODEL` → `gemini-2.5-flash`; prompt now asks for `box_2d` + a
  segmentation `mask` (not a vertex list).
- `parsePolygonMask` also accepts a *stringified* array as a courtesy.
- NEW `maskPngToPolygon(maskStr, box01)`: `Base64.decodeTextureAsync` the PNG →
  `ProceduralTextureProvider.createFromTexture(...).getPixels` → NEW
  `traceMaskContour` (Moore-neighbour boundary trace, auto-picks R- or A-channel,
  rejects near-empty/near-full masks) → ~24 outline points, decimated, remapped
  through `box01` into full-image 0..1 space. `segmentPrimary` calls it when the
  mask comes back as a base64 string, so the WHOLE downstream cut-out +
  persistence path (which is polygon-shaped) keeps working unchanged.
  Verified: `mask PNG 256x256 traced -> 24 outline pts` → `path=png-trace` →
  `MemoryCard thumbnail path: CUTOUT (polygon, 24 pts)`; screenshot shows a
  real background-removed sticker again.

**2 — sapling grows when captures are appended.** `OrbScreen.buildOrbSapling`
started every animation from the session-remembered stage (0 for a journal
carried over from a previous session). Now the "before" value is
`max(sessionOrbStage, momentCountToStage(findSavedById(eid).selectedMomentIds
.length))` — the persisted entry still holds the PRE-append count at Orb-build
time (DayStore isn't rewritten until `saveDay()`), so adding N captures to an
existing journal animates old→old+N. Verified with a real append:
`[Orb] sapling — stage 1 -> 4 (moments=4, savedPrev=1, sessionPrev=0)`.

**3 — softer sapling.** `Sapling.ts`: diamond leaves → `roundLeafMesh` (a smooth
fan-triangulated blade, fat in the middle, gently pointed); muted sage stem +
pale spring-green leaves (was saturated); a slow idle lean on the stem + a
per-leaf rustle in `applyLayout` (driven by a `swayT` accumulator in `update`);
taller stem (`H = d*0.58`) and higher leaf attachment (`baseY 0.42–0.94·H`) +
root anchor raised to `radius*0.92` so every leaf clears the orb. Jar grid root
offset bumped to match.

### Verification
Autopilot Review(append)→Feel→Generate→Orb: `sapling — stage 1 -> 4`, no
errors; softer rounded leaves clear the orb; restored parked orb also carries
its sapling. Sticker: live capture → `CUTOUT (polygon, 24 pts)` from the traced
PNG mask. Debug flags reset; stores wiped (days + thumbs + placements); clean
boot from Launch; project saved.

### 57. Try gemini 3.5 flash for the sticker segmentation

> where you put the model? use gemini 3.5 flash anyway, it is available now

The segmentation model lives in **`Assets/Scripts/GeminiService.ts`** —
`const SEGMENT_MODEL` (near the other prompt constants). (The main
journal/analysis model is separate: the scene `GeminiService.model` @input,
component `0412ceff-…`, `gemini-3-flash-preview`.)

Tried both spellings on device-Preview via RSG, both rejected:
- `gemini-3.5-flash-preview` → **404 NOT_FOUND** ("project does not have access
  to it") — still not available.
- `gemini-3.5-flash` → the model name resolves, but the image-segmentation call
  **hits RSG's ~30 s deadline on every attempt** (`Deadline Exceeded` at 30.04 s
  ×3) — no cut-out ever lands.

Kept `gemini-2.5-flash` (answers in ~2-3 s with a usable PNG mask → traced to the
cut-out polygon by #56's `maskPngToPolygon`). Left a comment in
`GeminiService.ts` recording both dead ends so it isn't retried.

### 58. Where the segment model is; why 2.5-flash looked low quality; smoothing

> where you put the model? use gemini 3.5 flash anyway. the previous time i used
> 3.5 flash in inspector and everything works well, but 2.5 flash preview the
> sticker looks low quality. how did you do before?

**Where it is now:** `GeminiService` gained a second Inspector field —
`@input segmentModel` (default `gemini-2.5-flash`), used by `segmentPrimary`
only. So the cut-out model is tunable from the Inspector again without a
recompile, next to the main `model` field. (`segmentModel` blank → built-in
default.)

**Why "before" looked better:** it wasn't only the model. The OLD prompt asked
the model for a **coordinate polygon** ("16-40 [y,x] points"), and a fast model
returned a crisp 20-ish-point outline that `makePolygonCutout` used directly.
Rounds #52-#53 dropped that because generating a long coordinate list makes the
model **blow RSG's ~30 s deadline** — re-confirmed today: the polygon prompt →
`Deadline Exceeded` at 30.03 s on `gemini-2.5-flash`, every attempt. The models
that *do* answer fast (`gemini-2.5-flash`, ~2.5 s) return a **256×256 PNG mask**
instead, and #56's tracer was decimating it to a crude 24-point staircase — that
is the "low quality".

**Fix (quality, kept the fast PNG path):** `traceMaskContour` now runs
**Douglas-Peucker** simplification (adaptive — keeps corners, drops the
collinear staircase) + **Chaikin** corner-cutting (2 passes, rounds the
remaining 8-connected steps), capped at 96 points. Same ~2.5 s call, but the
cut-out edge reads smooth. Verified: `mask PNG 256x256 traced -> 96 outline
pts` → `CUTOUT (polygon, 96 pts)`; screenshot shows a clean background-removed
sticker.

**3.5 flash, re-tested:** `gemini-3.5-flash-preview` → 404 (no project access);
`gemini-3.5-flash` → 30 s timeout on the image call. Neither is usable here.
`gemini-2.5-flash` stays the default; set `segmentModel` in the Inspector to try
others.

### 59. Restore the pre-#56 sticker config (polygon prompt + `this.model`)

> use the way you did before — the old prompts and model you used, the one from
> before I reported the sticker broken.

Pulled the exact pre-#56 `segmentPrimary` from the compile cache and restored it:
- request uses **`model: this.model`** again (the one Inspector `model` field —
  currently `gemini-3.5-flash`, which the user set), NOT a separate constant. The
  `@input segmentModel` I'd added in #58 is removed.
- **full-quality JPEG** (`encodeJpg(imageTexture)`, was `LowQuality`)
- **2 attempts** (was 3)
- **polygon-outline prompt** restored: `"mask": [[x1,y1],...]`, "polygon outline
  (12-30 points)". The `<segmentation mask>` wording from #56/#58 is gone.

Why this is the fix, not a regression: with the POLYGON prompt, `gemini-3.5-flash`
returns a real ~70-point outline in ~6s — `path=polygon`, straight into
`makePolygonCutout`, crisp. My earlier "3.5-flash = 30s timeout" (#57/#58) was an
artefact of the `<segmentation mask>` prompt making it try to emit a raster and
hang; the prompt shape, not the model, was the problem.

Kept (silent, only fires if a model ever returns a PNG instead of a polygon):
`parsePolygonMask` string-tolerance, `maskPngToPolygon`, and `traceMaskContour`'s
Douglas-Peucker + Chaikin smoothing from #58.

### Verification
Live capture: `segmentPrimary (gemini-3.5-flash) attempt 1 responded in 5.75s` →
`path=polygon polygonPts=74` → `CUTOUT (polygon, 74 pts)`. No errors. Scene
`GeminiService.model` = `gemini-3.5-flash`; `segmentModel` input removed. Clean
boot from Launch; project saved.

### 60. Sapling didn't visibly grow after adding a capture + regenerate

> after I added a new capture to today's journal and regenerated, I didn't see
> the sapling grow.

Two causes:

**1 — the animation was being skipped (fixed).** `OrbScreen.buildOrbSapling`
committed the new stage to `sessionOrbStage` *immediately*. The Orb screen
rebuilds `rebuild()` twice on entry (OnStart + an immediate OnEnable — noted in
the tweens comment). The second build then read `sessionPrev === stage` and
`snapToStage`d straight to the target — no grow. Now the target is stashed
(`orbSaplingEid` / `orbSaplingStage`) and only written to `sessionOrbStage`
once the tween has actually settled (checked in `onUpdate` via new
`Sapling.isSettled()`), plus on `finalizePlacement`. A same-entry rebuild now
re-reads the real `prev` and re-animates.

**2 — it was too quick / subtle.** Grow rate changed from ~0.18 s/stage to
**~0.4 s/stage** (a one-moment add ≈ 0.4 s, a full 0→5 ≈ 2 s), and each
unfurling leaf now uses a real **ease-out-back** (~10% overshoot) so it "pops".

Note for the user: the stage caps at 5 (their choice). If today's journal
already has ≥5 selected moments the sapling is maxed and adding more won't
change it — `[Orb] sapling — stage 5 -> 5` in that case.

### Verification
Two-run autopilot: run A saves a 3-moment journal; run B appends 3 more →
`[Orb] sapling — stage 3 -> 5 (moments=6, savedPrev=3, sessionPrev=0)`, runtime
tree shows Leaf4 + Leaf5 unfurling over ~0.8 s. No errors. Flags reset; stores
wiped; clean boot from Launch; project saved.

### 61. Append: card spawns behind me; sapling still doesn't grow

> after I capture the second thing, the memory card spawns behind me instead of
> where I am — is it spawning at the previous object's location?
> and after the second capture + regenerate, the sapling is still the same.

**Card behind you (fixed).** `CaptureController.computeMarkerPos` trusted
whatever `WorldQuery.hitTest` returned. The depth map lags head motion (~5 Hz),
so once you turn to frame the next object the hit-test can hand back a stale
point from the previous view — landing the card behind you / where the last
object was. Now a hit is only used if it is IN FRONT of the camera (within ~70°
of straight ahead) and 15 cm – 8 m away; otherwise it falls back to the
camera-forward point (90 cm ahead). Logged as "hit-test result rejected —
behind/too far".

**Sapling still the same (fixed — this was the real one).** `OrbScreen.saved`
is a session-lifetime flag with no reset. Once you've folded ANY orb this
session it is `true`, so every later Orb-screen entry runs `buildSavedPanel()`
and returns — `buildSpherePanel()` (which builds the orb AND the sapling) is
never reached. So an "Add to Today's Journal" append + regenerate + Save landed
straight on the folded-away panel: no orb rebuild, no sapling growth. Now
`saveDay` records `savedMomentCount`, and `rebuild()` flips `saved` back to
false when the live entry's moment count differs from it — the append re-opens
the sphere flow and the sapling animates the added moment(s). A plain re-entry
(same count) still shows the folded panel.

### Verification
Fresh-launch append autopilot (regression): `[Orb] sapling — stage 1 -> 4
(moments=4, savedPrev=1)`, `[Orb] saved … moments=4`, no errors. The
continuous-session path (save → append → Save again) can't be exercised by
autopilot (each Preview refresh is a fresh launch) but the `savedMomentCount`
guard is a simple count compare. Flags reset; stores wiped; clean boot;
project saved.

### 62. Confirm-placement menu spawns behind me; append should revise the ball, not place a new one

> after I confirm where to place the ball, the menu spawned behind me — fix it.
> and after regenerate, don't place a NEW ball — revise the existing one, with
> the growing animation. A new one = a second journal per day, which is wrong.

**Menu behind you (fixed).** `OrbScreen.buildSavedPanel` was anchoring the
"Today is folded away" panel in WORLD space just above the parked ball
(`placedNearBall` branch, added #53). By the time you hit Confirm the ball can
be off to the side or behind you — you may have moved, or the placement follow
put it somewhere odd — so the panel lands behind. Now the confirmation ALWAYS
spawns in front of the user (yaw-facing, 100 cm ahead) like the kept-private
one. The above-ball anchoring + its per-frame `faceCameraFlat` are gone.

**Append → revise the existing ball, no re-placement (fixed).** After #61 the
append flow re-opened the full sphere panel (Keep Private / Place in Space),
making you place the ball again — which reads as a second ball / second journal.
New `OrbScreen.buildAppendRevisePanel` (called from `rebuild()` when the entry
grew after being saved this session): shows the day's sphere growing its plant
(savedPrev → new stage, animated where you're looking) with a single Done
button. Done re-persists the SAME entry (`persistEntry` upserts by id — one
journal per day) + its stickers, and snaps the ALREADY-PLACED room ball's plant
to the new stage via the new `dayOrbSapling` registry (populated by
`PlacedOrbs.buildRestored` and `OrbScreen.finalizePlacement`). No new ball, no
`recordPlacement`, the spot is unchanged.

### Verification
Fresh-launch append autopilot (regression): `[Orb] sapling — stage 1 -> 4` via
the normal `buildSpherePanel`, `[Orb] sphere built`, no errors, compiles clean.
The continuous-session revise path + the menu-position fix can't be exercised by
Preview autopilot (fresh launch each refresh) — verified by construction (reuses
`buildOrb` / `buildOrbSapling` / `PanelKit`; the panel now uses the exact
in-front `localPosition` the kept-private path always used). Flags reset; stores
wiped; clean boot; project saved.

### 63. Revealed journal not facing me; "today is folded away" + next window spawn behind me

> 1. after "revisit this month" + tapping a sphere, the revealed journal isn't
>    facing me.
> 2. after placing the sphere, "today is folded away" and the window after it
>    spawn behind me instead of above the sphere.

Both are the same root cause: **`quat.fromEulerAngles(0, yaw, 0)` from a
`toEulerAngles().y`**. Euler decomposition of a pitched head pose flips the yaw
~180°, so any panel oriented that way faces (and, for screen roots, places its
children) BEHIND the user. You only hit it now because placing a ball / reading
a low sphere means looking DOWN — a big pitch.

Fixed everywhere by switching to `quat.lookAt` on the flattened view / panel→
camera vector (the same robust method `faceCameraFlat` already used):
- `spawnInFrontOfUser()` in **OrbScreen, LaunchScreen, JarScreen, GenerateScreen,
  FeelScreen, ReviewScreen** — root now faces `quat.lookAt(flatten(camT.forward),
  up)` (local -Z = view direction, children at local -Z land in front).
- **JarScreen.buildDayView** reveal-panel block — `quat.lookAt(flatten(panel→
  camera), up)` instead of the yaw euler (issue 1).
- **OrbScreen.buildSavedPanel** — restored the "float above the parked ball"
  anchoring the user asked for, via `faceCameraFlat` (robust) + the per-frame
  re-face in `onUpdate` (issue 2). The #62 "always in front of user" was landing
  behind because `spawnInFrontOfUser` itself was flipped — now that it's fixed,
  above-the-ball works.

### Verification
Preview (level scene camera — can't reproduce the pitch flip, which is why it
slipped through): Home panel + Jar month header both render in front, facing the
user, readable — the `quat.lookAt` convention is correct, no regression.
Compiles clean. Flags reset; stores wiped; clean boot; project saved.
