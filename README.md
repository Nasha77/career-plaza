# Career Plaza (Humancareers) — Part 1 demo

A playable, static web demo of open-ended career exploration for humanities students.
Players pick a building in a 3D plaza, step into a workplace, make a choice, write a line
of their own, get feedback with skill tags and a reflective question, rate how it felt,
and build up a growth record. No scores, no verdicts.

## Run it

```bash
npm install
npm run dev      # local development at http://localhost:5173
npm run build    # static files in dist/ — host anywhere
npm run preview  # serve the built files locally
```

## Edit the words

All the words live in **`src/content/scenarios.json`**:

- the four internship scenarios (each based on a real internship description, with employers renamed), their managers, options, feedback, reflective questions and twists;
- `writeGuide` for each scenario: what a strong written answer does, plus the one coaching tip;
- `resources` for each role, and `commonResources` shown on every role;
- `selfCheck`: the start-of-game confidence statements and "what draws you" picks;
- guide lines and written-response acknowledgements.

Edit the text there; no code changes are needed. Keep the `id`, `skill`, `weight` and `scenario` fields as they are.

## What a run looks like

1. **Self-check** (new players, skippable): rate confidence in four skills and pick what draws you.
2. **Scenario**: the player is the intern; the manager sets the task, the player picks an approach and writes a short answer.
3. **Coaching**: a clearly weak answer gets one tip and an optional chance to revise (up to two times). Both drafts are kept.
4. **Feedback, reflection and ratings**, then **resources** for that role.
5. **Growth record**: includes "Then and now", comparing the self-check with what the player did and enjoyed.

## How it's put together

| Path | What it does |
|---|---|
| `src/content/` | Scenario content (JSON) and a small typed loader |
| `src/feedback/` | `FeedbackProvider` interface, `ScriptedProvider` (used), `ClaudeProvider` stub (not used) |
| `src/record.ts` | Builds the growth record (skills, gaps, try-next, compare) from saved attempts |
| `src/store.ts` | Saves completed attempts to `localStorage` key `careerPlaza.v1`; falls back to memory if storage is blocked |
| `src/ui/` | All HTML overlay UI: title, plaza sheet, dialogue beats, ratings, growth record |
| `src/world/` | The visual layer behind a `World` interface: `three/` (3D plaza and interiors) and `simple.ts` (flat Simple mode) |

The game logic never touches three.js directly, so Simple mode (picked on the title screen,
or used automatically when WebGL is unavailable) plays exactly the same game.

## Notes

- **No external assets.** Every 3D object is built from code primitives; signs, charts and
  the dashboard are drawn with the 2D canvas API at runtime.
- **AI is local only.** The public site (`npm run build`) is fully scripted and never calls an AI service.
  See "Turn on the AI" below.
- **Accessibility.** Buildings can be chosen from HTML buttons as well as in 3D. The app
  respects `prefers-reduced-motion` (fades instead of camera flights, no orbit, instant text)
  and `prefers-color-scheme` (light and dark).

`npm run build:single` writes `dist-single/career-plaza.html`, one self-contained file with CSS and JS inlined, for hosting as a single published page.

## Turn on the AI (local only, free)

With a Gemini key, the managers react to what the student actually wrote, coach weak answers
with specific tips, ask one follow-up question, and the growth record gets a personal summary.
Each manager has their own personality (set in `persona` in the content file).

1. Get a free key at [Google AI Studio](https://aistudio.google.com) ("Get API key"). No card needed.
2. Copy `.env.example` to `.env.local` and paste the key after `GEMINI_API_KEY=`.
3. Run `npm run dev`. The HUD shows **AI on**, and the terminal logs each AI call.

How it stays safe and free:

- The key lives only in `.env.local`, which git ignores. Only the local dev server reads it; it is never
  sent to the browser and never included in the build. Don't share your key; each teammate can use their own.
- AI routes exist only under `npm run dev` (`server/ai-plugin.ts`), so the GitHub Pages site stays scripted.
- Student text is length-capped and passed to the model as data, not instructions. Replies must match a
  fixed JSON shape and pass checks (length, no code or links, no scores or "best fit"); anything else
  falls back to the scripted line. There is also a cap on calls per dev-server run and per minute.
- On Google's free tier, prompts may be used to improve Google's products, so don't type real students'
  personal information while testing on a free key.
