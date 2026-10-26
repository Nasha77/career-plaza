# Career Plaza (Humancareers): Part 1 prototype

A playable 3D career exploration game for humanities students. Students walk into four
workplaces based on real internship postings, do a few minutes of the work as the intern,
and build a growth record of what they used, what they enjoyed, and what to try next.

**No scores. No wrong answers.** The game never ranks careers or says which one "fits".

**Live demo:** [nasha77.github.io/career-plaza](https://nasha77.github.io/career-plaza/)
(scripted, no AI, published from `main`). For the version **with AI**, see "Live with AI (Vercel)" below.

---

## What's in the game

| | |
|---|---|
| **Four internships** | Communications Intern at Harbourfront Resort (Priya) · International Policy Intern at Climate Policy Association (Daniel) · Programme Intern at Community Foundation (Grace) · Policy & Research Intern at Workforce Strategy Hub (Marcus). Each is based on a real posting, with the employer renamed. |
| **Self-check** | A short, skippable check at the start: how confident you feel in four skills, and what draws you. It can be retaken later. |
| **Scenarios** | The manager sets a task, you pick one of three approaches, see **what you found** (practice data for that approach), and write a short answer. |
| **Coaching** | A clearly weak answer gets one specific tip and an optional chance to revise (up to two times). Both drafts are kept. |
| **Managers with personalities** | Priya is warm and upbeat, Daniel calm and precise, Grace thoughtful and gentle, Marcus fast and direct. They react to every action you take. |
| **Reflection** | Each run ends with a reflective question, your own enjoyment and confidence ratings, and links to learn more about the role. |
| **Growth record** | What you tried (with your writing), what you enjoyed, skills used across buildings, skills to grow, ideas to try next, and **Then and now**: your start self-check next to what actually happened. |
| **3D plaza** | Low-poly buildings that match their places (a harbourfront resort, a solar-powered policy office, a shophouse row, a glass strategy tower), always in daytime. Built entirely in code: no image or model files. |
| **Optional AI** | With a free Gemini key, managers respond to your actual words, ask a follow-up question, and write a personal summary. Works locally, or on a Vercel link. See below. |

The skills tracked are **Research, Communication, Organisation and Analysis**.

---

## Run it

```bash
npm install
npm run dev
```

Then open the address shown in the terminal (usually http://localhost:5173).

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Builds the static site into `dist/`, ready to host anywhere |
| `npm run preview` | Serves the built site locally |
| `npm run build:single` | Builds one self-contained HTML file in `dist-single/career-plaza.html` |

Pushing to `main` redeploys the public site automatically through GitHub Pages
(`.github/workflows/deploy.yml`).

---

## Live with AI (Vercel, free)

The easiest way to share the game **with** the AI characters: one link, nothing to install.
The game and a small serverless function (`api/ai.ts`) are deployed together on Vercel, and the
function holds the Gemini key as a private setting.

1. Sign up at [vercel.com](https://vercel.com) with your GitHub account (Hobby plan, free).
2. **Add New → Project → Import** this repository. Vercel detects Vite; keep the defaults.
3. Under **Environment Variables**, add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`).
4. **Deploy.** Share the `*.vercel.app` link. Every push to `main` redeploys it.

Keep billing **off** for the key in Google AI Studio, so it can never charge you. Everyone using the link
shares the key's free daily limit; when it runs out, the game quietly uses its scripted lines until it resets.
The function only answers requests from the site itself and limits each visitor to 30 AI calls per 10 minutes.

The GitHub Pages link is built without any AI code, so it always plays the scripted version.

## Turn on the AI locally (free)

To develop with the AI on your own computer, use your own key:

1. Get a free key at [Google AI Studio](https://aistudio.google.com) ("Get API key"). No card needed.
2. Copy `.env.example` to `.env.local`, then paste your key after `GEMINI_API_KEY=`.
3. Run `npm run dev`. The top bar shows **AI on**, and the terminal logs each AI call.

With the AI on:

- coaching tips refer to what the student actually wrote and to the findings on screen;
- the manager asks one follow-up question, and responds to the reply;
- feedback is written in the manager's own voice, and can mention earlier buildings;
- the growth record starts with a short personal summary.

How it stays safe and free:

- **The key stays secret.** Locally it lives in `.env.local` (ignored by git); on Vercel it's a private
  Environment Variable. Only the server side reads it; it is never sent to the browser or included in the build.
- **AI routes exist only under `npm run dev`** (`server/ai-plugin.ts`) **and on Vercel** (`api/ai.ts`). Both use the
  same core (`server/ai-core.ts`). Other builds, such as GitHub Pages, contain no AI calls at all.
- **Guardrails:** student text is length-capped and treated as data, not instructions; replies must match a fixed
  format and pass checks (length, no code or links, no scores or "best fit"); calls are capped per run and per
  minute. Anything that fails falls back to the scripted line, so the game never breaks.
- **Privacy:** on Google's free tier, prompts may be used to improve Google's products. Don't type real
  students' personal information while testing on a free key.

You can change the model with `GEMINI_MODEL` in `.env.local`.

---

## Edit the content

All the words live in **`src/content/scenarios.json`**. No code changes are needed to edit them.

| Field | What it holds |
|---|---|
| `scenarios[]` | The four internships: building, intern role, manager, setting, intro, question, twist, writing prompt |
| `persona` | Each manager's personality and voice (also used as the AI's character brief) |
| `reactions` | Each manager's lines for smaller actions: skipping, revising, rating and so on |
| `options[]` | The three approaches, each with `chooseLine`, `result` (the findings), feedback, revisit feedback and a reflective question |
| `writeGuide` | What a strong written answer does, plus the default coaching tip |
| `resources` / `commonResources` | Learn-more links for each role, and the NTU links shown on every role |
| `selfCheck` | The start-of-game confidence statements and "what draws you" picks |
| `guide` | The plaza guide's lines |

Keep the `id`, `skill`, `weight` and `scenario` fields as they are; the rest is free text.

---

## How it's put together

| Path | What it does |
|---|---|
| `src/content/` | The content file and a small typed loader |
| `src/ui/app.ts` | Screens and flow: title, self-check, plaza, scenario steps, growth record |
| `src/feedback/` | Scripted feedback, the offline writing coach, and the AI feedback provider |
| `src/ai/client.ts` | Browser side of the local AI (only active under `npm run dev`) |
| `src/record.ts` | Builds the growth record and "Then and now" from saved attempts |
| `src/store.ts` | Saves progress in the browser (`localStorage` key `careerPlaza.v2`); works from memory if storage is blocked |
| `src/world/three/` | The 3D plaza, buildings, rooms, characters and atmosphere (three.js) |
| `src/world/simple.ts` | Simple mode: the same game without 3D, for older devices |
| `server/` | The AI core (routes, checks, prompts, Gemini client) and the local dev-server plugin |
| `api/ai.ts` | The Vercel serverless function for the live AI link (`vercel.json` routes `/api/ai/*` to it) |

The game logic never touches three.js directly, so Simple mode (chosen on the title screen, or used
automatically when WebGL is unavailable) plays exactly the same game.

---

## Design notes

- **Nothing is graded.** Ratings are the student's own feelings. Feedback names what works and offers one
  next step; the game never shows a score, a ranking or a "best match".
- **Student-led.** Buildings can be explored in any order and revisited; each revisit brings a twist.
- **Complements real experience.** The growth record ends by pointing to internships and career coaching,
  and the resources link to NTU's Career & Attachment Office.
- **Accessible.** Buildings can be chosen from buttons as well as in 3D; everything works by keyboard.
  The game respects reduced-motion settings (fades instead of camera flights) and the device's light or dark
  setting for its panels. It works at phone width.
- **No external assets.** Every 3D object is built from code; signs, charts and textures are drawn with the
  canvas API at runtime.
