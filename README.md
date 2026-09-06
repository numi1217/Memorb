# Memorb

A spatial journaling Lens for **Snap Spectacles**, built in **Lens Studio 5.23** with TypeScript.

**Memorb is a spatial journal where each day becomes an object you can hold onto.**

Most people who want to keep a diary run into the same few things: finding the time to sit
and write, remembering later what actually happened, and knowing where to start on a blank
page. Memorb turns each of those into something quick and physical.

During the day you spot something that mattered — a coffee cup, a train ticket, a door you
keep passing — and you pinch at it. Memorb works out what the thing is; you say how it
made you feel and add a line about why. One look and one sentence make the whole capture,
done in the moment while it is still fresh, anchored to a real object you saw.

Later you go back through the day, keep the few moments that stuck, and let it draft the
page in your own words, using only what you told it. The page folds into a small coloured
sphere. Keep it to yourself, or leave it floating in the room where it happened, with a
little plant on top that grows as the day fills out.

You collect your day. A month is a shelf of spheres you made just by noticing.

Making a journal this way feels like a reflex: the effort goes into noticing rather than
wording, picking a handful of moments is enough for the page to assemble itself in your
voice, and the plant and the growing shelf of spheres give each small act something to
show for it.

---

## The experience

| Step | What happens |
|---|---|
| **Home** | *Capture a Moment* or *Review Today* (disabled until you have moments). |
| **Capture** | Look at an object, pinch. A still is sent to Gemini Flash via the Remote Service Gateway — no on-device ML. |
| **Card** | A background-removed cut-out of the object, an editable label + any readable text, and *Keep / Retake / Remove*. |
| **Feel** | Pick one emotion for that moment (Happy / Peaceful / Difficult / Surprising …). |
| **Reflect** | One question, chosen by the emotion. A few words by voice or keyboard. |
| **Review Today** | Your moments in order — choose 1–5 for the entry. |
| **Overall feeling** | The one emotion that sets the day's sphere colour (never auto-computed). |
| **Generate** | A title + 60–90-word first-person paragraph + a closing reflection, grounded **only** in your confirmed evidence. *Make Shorter / Change Tone / Regenerate*. |
| **Save the day** | The page folds into a coloured orb — *Keep Private* or *Place in Space* (surface hit-test + pinch-release to drop). A small procedural sapling on the orb grows with the day's moment count. |
| **Revisit the month** | One orb per completed day; tap one to reopen its journal. |

Adding a capture to a day that's already saved *revises* that same entry (and grows its
sapling) rather than creating a second one.

## Built with

- **Lens Studio 5.23** · TypeScript (ES2021), `@component` scripts extending `BaseScriptComponent`
- **Spectacles Interaction Kit** (SIK) — interactors, pinch, cursor
- **Spectacles UI Kit** — buttons
- **WorldQueryModule** / `WorldQueryHit` package — surface hit-testing for object markers and orb placement
- **Remote Service Gateway** → **Gemini** (`gemini-3-flash-preview` for text, `gemini-2.5-flash` for the segmentation mask)
- `global.persistentStorageSystem` for day / sticker / placement persistence

## Built with CLAD — AI-assisted development

**Every line of this project was written through CLAD** (Claude-assisted development:
Claude Code driving Lens Studio through its agent toolkit). The starting point was Snap's
blank *Specs Base Template*. The finished result is ~**13,200 lines of typed, documented
TypeScript across 28 single-responsibility modules** — a complete multi-screen spatial
application with a live LLM pipeline, on-device surface placement, procedural 3-D visuals,
and full cross-session persistence.

### It's all on the record

Nothing here is a black box. The build is logged, in order, in two files you can read
end to end:

| File | What it is |
|---|---|
| **`CLAD_PROMPTS.md`** | ~1,850 lines · **63 numbered rounds**. Every request in the developer's own words, the diagnosis, the change made, and the verification that followed. |
| **`BUILD_PLAN.md`** | ~2,500 lines · **36 phases / rounds** (A–Z, then AA onward). The plan that was actually executed, phase by phase. |

The git history mirrors both. A reader can trace any feature — the growing sapling, the
object cut-out, the month navigation — from the sentence that asked for it to the code
that shipped it.

### Not autocomplete — a full agentic loop

CLAD didn't just suggest code. Each round it ran the whole engineering cycle against the
live editor over Lens Studio's MCP bridge:

1. **Read** the design spec (`DESIGN.md`) and the existing modules for context.
2. **Write / edit** TypeScript, then **recompile** and fix type errors.
3. **Drive the Preview** with scripted *autopilot* runs — seed moments, step through
   Home → Capture → Feel → Generate → Orb, exercise the month view.
4. **Inspect the result**: capture screenshots, query the live runtime scene graph
   (object transforms, which leaves of the sapling are enabled), read the Lens logs.
5. **Wire the scene**: set component inputs and object properties directly through the
   editor API.
6. **Diagnose** failures from logs and runtime state, find the *root* cause (not a patch),
   apply the fix, and re-verify.
7. **Clean up**: reset every debug flag, wipe test data, boot clean, save.

### The hard problems it solved

- **SIK interactors, reverse-engineered.** Worked out which interactor Lens Studio exposes
  in the editor vs. on device, and used `startPoint` / `endPoint` / trigger-release edges
  so the same hand-ray placement code drives both the Preview cursor and a real pinch.
- **Segmentation → clean silhouette.** Gemini returns a 256 px PNG probability mask.
  `GeminiService` decodes it, traces the outline with **Moore-neighbour boundary
  following**, simplifies it with **Douglas–Peucker**, and smooths the stair-steps with
  **Chaikin** — turning a raster blob into a crisp cut-out mesh. Prompt and model choices
  were tuned to land inside the Remote Service Gateway's ~30 s deadline.
- **WorldQuery at ~5 Hz.** The depth map lags head motion, so a stale frame could drop the
  orb or a capture marker *behind* the user. Added front-of-camera / distance sanity
  checks so only trustworthy hits are used.
- **A whole class of "the panel spawned behind me" bugs**, root-caused to
  `quat.fromEulerAngles(yaw)` flipping 180° when the head is pitched — replaced everywhere
  with `quat.lookAt` on the flattened view vector.
- **Procedural geometry** built from scratch with `MeshBuilder`: the orb's radial-gradient
  glow disc, the blinking creature eyes, and the sapling — a tapered stem plus rounded
  leaf blades that unfurl one per captured moment, with an ease-out-back "pop" and a slow
  idle sway.
- **Session & state design.** Adding a capture to a day that's already saved *revises the
  same journal entry* — it never creates a second sphere for one day. The sapling animates
  its growth exactly once, remembers the stage it reached, and the room-placed orb updates
  in place with no re-placement.
- **LLM-reliability engineering.** Watchdog timers, one retry, model fallbacks, and
  prompting that keeps the generated journal grounded *only* in evidence the user
  explicitly confirmed — it never invents an event, place, or feeling.

### What that adds up to

A gentle, coherent product — not a tech demo. ~10 screens, a real vision + OCR +
segmentation + text-generation pipeline, a visible hand-to-orb tether during placement,
background-removed object stickers, a living plant that grows with each day's moments,
per-month browsing, and persistence that survives a restart — every step verified running
in Preview before it was called done. The build log doubles as an architecture-decision
record: each module opens with a header stating what it **owns** and what it **must not**
do, and each round of `CLAD_PROMPTS.md` ends with how the change was checked.

The direction, the product calls, and the on-device testing were the developer's; the
implementation, the tooling loop, and the verification were CLAD's. That collaboration is
the project.

## Getting started

1. Open `journal.esproj` in **Lens Studio 5.23.x**.
2. Fill in the **RemoteServiceGatewayCredentials** component in the scene with your own RSG
   tokens (Google / OpenAI / Snap). Without them, every Gemini call fails.
3. Press **Preview**. In the editor, click the preview to stand in for a pinch; the flow
   also has `debug*` inputs on the screen components for stepping through without a headset.
4. To run on device, pair Spectacles and push the Lens from Lens Studio.

> Cloning note: `Cache/` is intentionally not tracked — Lens Studio regenerates it on open.

## Project structure

```
Assets/
  Scene.scene            the single scene: camera, screen roots, always-on spawners
  Scripts/               all behaviour (below)
  Materials/ Textures/ … art + fonts
Packages/                installed LS packages (SIK, UI Kit, RSG, WorldQueryHit)
Support/                 generated Lens API / Editor API type defs
DESIGN.md                UX spec (v2) — the source of truth for the flow
BUILD_PLAN.md            build phases + status
```

### Scripts

**Flow & routing**
- `FlowManager` — the screen state machine (`TraceScreen` enum), `debugStartState`
- `ScreenRouter` — enables exactly one screen root per state

**Screens**
- `LaunchScreen` — Home
- `ScanScreen` + `CaptureController` — still capture, Gemini `analyzeTrace`, marker point
- `MemoryCardSpawner` — the object card, marker sphere, connector line, cut-out swap
- `MomentEmotionReflect` / `ReflectionCapture` — per-moment emotion + reflective question
- `ReviewScreen` — pick 1–5 moments
- `FeelScreen` — overall daily emotion
- `GenerateScreen` — journal generation + Make Shorter / Change Tone / Regenerate
- `OrbScreen` — fold to a sphere, Keep Private / Place in Space, surface-follow placement
- `JarScreen` — the monthly container, per-month navigation, reopen a day

**Model / services**
- `JournalSession` / `JournalEntry` — the live day being built; append mode
- `GeminiService` — every Gemini call, prompts, retry, the segmentation-mask → outline trace
- `DayStore` / `StickerStore` / `PlacedOrbStore` — persistence (`traceJournal.*` keys)
- `PlacedOrbs` — rebuilds room-placed orbs (+ their saplings) on launch

**Visuals & helpers**
- `OrbLook` — the orb material / colour / spin
- `Sapling` — the procedural stick-and-leaves plant that grows with moment count
- `PanelKit` — the shared titled-panel + button builder
- `TraceGizmos` — polygon cut-out mesh + thumbnail outline
- `UITheme` / `UISound` — fonts, colours, cues

`TraceJournalSpike*` scripts are early proof-of-concept spikes, kept for reference.

## Persistence

`global.persistentStorageSystem.store` holds JSON under a few keys:

- `traceJournal.days` — the day entries (id, date, selected moments, colour, title, text, privacy)
- `traceJournal.thumbs.<id>` — the day's cut-out stickers (base64 JPEG + shape)
- `traceJournal.placements` — where room-placed orbs live, rebuilt each session

True same-room spatial anchoring is out of scope for now — "placed" means the orb stays
visible for the session and reappears near the same spot next launch.

## Not in scope (yet)

Music search · a custom palm gesture for the month menu · exact same-room spatial
persistence · freely repositioning individual moment cards · rich in-place journal-text
editing.
