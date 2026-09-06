# Memorest

A spatial journaling Lens for **Snap Spectacles**, built in **Lens Studio 5.23** with TypeScript.

You notice a real object during the day and pinch to capture it. The Lens reads what it is,
you tag how it made you feel and jot a few words, and later it weaves the moments you choose
into one short, grounded journal entry — which folds into a single coloured sphere you can
keep private or place in your room. Each day is one sphere; a month is a small constellation
of them.

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
