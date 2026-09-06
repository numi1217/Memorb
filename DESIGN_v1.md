# Memorest — Design Spec

> Full product/UX spec for the Memorest Lens. Phase 0 subagents did not find this
> in the repo (only the Lens Studio managed block lives in `AGENTS.md`), so it is captured
> here for every later phase. Build phases and status live in `BUILD_PLAN.md`.

## Project description

Memorest is a spatial journaling experience for Snap Spectacles that transforms
everyday objects and written traces into personal memories.

Users scan meaningful objects, receipts, tickets, notes or packaging from their day.
Instead of using a local ML model, the Lens sends each deliberately captured image to
Gemini Flash. Gemini identifies the primary object and extracts visible text using
object detection and OCR.

Each scan becomes a Memory Card containing the captured image, detected object label and
relevant extracted text. The user decides which information to keep, remove or correct
before it is used. This ensures that the final journal is based on confirmed evidence
rather than unsupported AI assumptions.

After collecting between one and five Memory Cards, the user adds one personal reflection
and chooses a primary feeling for the day. Gemini then combines only the confirmed
evidence and the user's reflection into a short journal entry.

The completed journal page transforms into a coloured Memory Orb. The orb's colour
represents how the user described the day. Each daily orb is stored inside a monthly
Memory Jar, creating a spatial visualisation of the user's memories and emotional
patterns over time.

Selecting an orb expands it back into its original journal page.

The prototype should demonstrate the complete journey:

**Real-world trace → confirmed evidence → personal reflection → journal page → Memory Orb → monthly Memory Jar**

## Improved UX flow

### 1. Launch

When the Lens opens, display a compact welcome panel:

**Turn the traces of your day into a spatial journal.**

Buttons:

* Create Today's Entry
* Open Memory Jar

If an entry already exists for the current date, show:

* Continue Today's Entry
* View Today's Entry
* Create Another Entry

### 2. Scan a trace

After selecting Create Today's Entry, show:

**Scan something that reminds you of today.**

Place a clear capture frame in the centre of the user's view.

The user looks at one object, receipt, ticket, note or piece of packaging and pinches to capture it.

On capture:

* Freeze the captured image briefly.
* Place a temporary small white marker at the centre raycast position.
* Play a short capture sound.
* Display: **Finding the memory in this trace…**
* Send the captured image to Gemini Flash.
* Prevent repeated pinches from creating duplicate requests.

Gemini should return:

* Primary object label
* Recognition confidence
* Visible text
* Possible date
* Possible location
* Up to three alternative labels

Do not continuously scan the camera feed. Only analyse an image after the user deliberately captures it.

### 3. Create a Memory Card

When Gemini returns a result, create a spatial Memory Card containing:

* Captured thumbnail
* Detected object name
* Extracted text, if present
* Keep button
* Remove button
* Change Label button

A thin luminous line can temporarily connect the white capture marker to its Memory Card.
The line represents where the trace was collected, but it does not track the physical
object if it moves.

Do not display scan order, but record it internally.

For Change Label, show Gemini's alternative labels instead of requiring keyboard input. Also include:

* Scan Again
* Something Else

The user can collect between one and five Memory Cards.

After the first card is kept, show:

* Add Another Trace
* Create Today's Journal

### 4. Confirm the evidence

When the user selects Create Today's Journal, display all kept cards under:

**Here's what I found. Is it correct?**

For each card, allow the user to confirm:

* Object label
* Extracted text
* Detected date
* Detected location

Each OCR text fragment should have:

* Keep
* Remove

Dates and locations must require explicit confirmation before they are included.

If several traces were captured, treat the first kept trace as the primary memory.
Allow the user to select a different card as the primary trace.

Buttons:

* Back to Scanning
* Confirm and Continue

### 5. Add a personal reflection

After confirming the evidence, ask one question:

**What do you want to remember about today?**

Allow the user to:

* Speak a short response
* Skip

Display the transcribed response and provide:

* Confirm
* Try Again
* Remove

The reflection is the main source of personal meaning. Gemini must not invent emotions,
relationships or events that the user did not provide.

### 6. Choose how the day felt

Display:

**Today felt…**

Emotion choices:

* Happy — yellow
* Peaceful — blue
* Difficult — purple
* Surprising — orange
* Ordinary — soft grey

Each option should use a text label, icon and colour.

The user selects one primary feeling. The selected feeling determines the colour of the
final Memory Orb.

### 7. Add a soundtrack — optional

Show:

**Is there a song that belongs to this memory?**

Options:

* Add Song
* Skip

For the prototype, the user can enter or speak:

* Song title
* Artist

Save the song as text metadata displayed on the journal page. Full music playback or
Spotify integration is not required for the MVP.

### 8. Generate the journal page

Send Gemini only the information confirmed by the user:

* Confirmed object labels
* Kept OCR text
* Confirmed date
* Confirmed location
* Personal reflection
* Selected feeling
* Optional song title and artist

Display:

**Turning your traces into today's memory…**

Gemini should generate:

* A short title
* A journal paragraph of approximately 60–100 words
* One final reflection sentence

The writing should remain grounded in the supplied evidence. It should not invent
unsupported events or personal information.

### 9. Review the journal

Display the completed journal page beside the marker of the primary trace.

The page contains:

* Date
* Optional confirmed location
* Selected object images
* Journal title
* Short journal paragraph
* Primary feeling
* Final reflection
* Optional song title and artist

Provide the following actions:

* Make Shorter
* Make More Poetic
* Regenerate
* Save
* Back

Temporary capture markers and connecting lines can remain visible during review to show
how the physical traces contributed to the journal.

### 10. Save as a Memory Orb

When the user selects Save:

1. Confirm that the entry has been saved.
2. Fold or contract the journal page.
3. Pull the object thumbnails and text towards its centre.
4. Transform the page into a small glowing sphere.
5. Change the sphere to the selected feeling colour.
6. Briefly display the entry date on the sphere.
7. Animate the sphere travelling into the current month's Memory Jar.

After saving, remove the temporary capture markers and connecting lines.

### 11. Monthly Memory Jar

The Memory Jar is a spatial archive containing the saved Memory Orbs for the current month.

Each orb represents one journal entry.

The jar should communicate:

* The number of recorded days
* The distribution of emotion colours
* The passage of time through the month

When the user selects an orb:

1. The orb leaves the jar.
2. It expands into the corresponding journal page.
3. The user can read the entry.
4. The user can return it to the jar.

Display the date when the user focuses on an orb.

Automatically create a new jar when the month changes. Allow navigation between the
current and previous months only if time permits.

### 12. Summoning the jar

For the MVP, provide a visible Memory Jar button through a palm-up hand menu.

Interaction:

1. The user turns one palm upward.
2. A small menu appears above the palm.
3. The user pinches the Memory Jar icon.
4. The jar appears at a comfortable world position in front of the user.
5. The user can reposition it.

A middle-finger-and-thumb gesture can be explored as an additional shortcut, but the
visible Jar button should remain available as a reliable fallback.

### 13. Persistence

Save the following data for every journal entry:

* Entry ID
* Date
* Confirmed location
* Object labels
* Kept OCR text
* Personal reflection
* Generated journal text
* Final reflection
* Selected feeling
* Orb colour
* Optional song title and artist

For the MVP, persist the journal data between sessions and respawn the Memory Jar in
front of the user when requested.

Exact restoration of the jar at the same physical position can be added later using
spatial anchors. It should not block completion of the core prototype.

### 14. Error and fallback states

If Gemini cannot recognise the trace:

**I couldn't clearly identify this.**

Options:

* Scan Again
* Keep Image Without Label
* Choose a General Category

If OCR confidence is low:

**I found some text, but it may not be accurate.**

Allow the user to keep or remove each fragment.

If the network request fails:

**I couldn't analyse this trace right now.**

Options:

* Try Again
* Keep Image Without Analysis
* Remove

If journal generation fails, preserve all confirmed Memory Cards and the user's reflection
so that no work is lost.

## MVP scope

The prototype should prioritise:

1. Capturing one to five traces
2. Gemini Flash object recognition and OCR
3. Memory Card creation
4. Keep, Remove and label correction
5. Evidence confirmation
6. One personal reflection
7. One selected feeling
8. Generation of one grounded journal page
9. Transformation into a coloured Memory Orb
10. A monthly Memory Jar
11. Opening an orb to view its journal page
12. Basic persistence between sessions

The following features are optional and should not block the MVP:

* Song search or music playback
* Custom middle-finger gesture
* Exact same-room spatial persistence
* Multiple monthly jars
* Freely placing individual orbs around the room
* Advanced journal text editing
