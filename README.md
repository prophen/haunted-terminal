# Haunted Terminal

Hacktoberfest Week 4, theme "Ghost in the Machine" (Oct 26-31, 2026).
A ghost named Marlowe lives in a terminal and tells a branching spooky
story. The reader picks choices (or types an action), Gemma writes the next
passage, and ElevenLabs narrates it.

## Stack

- Next.js (App Router), plain JavaScript, no database. Story state lives in
  the page; nothing is stored server side.
- Story: Gemma 4 26B (open weights). Fastest path is `GEMMA_MODE=router`,
  which streams it from OpenRouter (a few seconds to the first word);
  Google AI Studio (`GEMMA_MODE=cloud`, thinking off via
  `thinkingLevel: "minimal"`) works but took about 40 seconds to start in
  testing. `GEMMA_MODE=local` streams from Ollama. The Gemma and ElevenLabs calls mirror Talk to the
  Book's proven routes. Story turns stream: passages appear as Gemma writes
  them instead of after one long wait. Passages are 80 to 130 words to keep
  turns snappy.
- Narration: ElevenLabs TTS, one passage at a time.
- Play: a "passage N of 6" counter in the title bar, number keys 1 to 3
  pick a choice, "Try again" resends a choice whose turn failed, Restart
  works mid-story (with a confirm), "Copy story" copies the finished
  transcript, and an Auto-narrate checkbox (remembered per browser) plays
  each new passage after a choice.

## Run

```bash
cp .env.local.example .env.local   # add GOOGLE_AI_STUDIO_KEY, ELEVENLABS_API_KEY
npm install
npm run dev
```

Without keys the app still runs in demo mode with a canned story, and the
notice says which key is missing. No keys are committed: `.env.local` is
gitignored.

## Decisions still hers

- Domain: no `.tech` domain (her call, 2026-10-26).
- Voice: the default narrator is Callum (`N2lVS1w4EtoT3dr4eOWO`), a husky
  ElevenLabs premade voice. `ELEVENLABS_VOICE_ID` overrides it.
- DEV post: the submission. Nothing submits under her name without her
  explicit approval.

## Guardrails

- New project, built in the Week 4 window. Not a Talk to the Book
  resubmission.
- Fiction only, spooky but never gory, no real-world tragedy.
- No em dashes in model output (prompt rule) or in project copy.

## Status

- Scaffolded 2026-10-26 evening after she picked the direction; `npm run build` passes.
- Pushed to https://github.com/prophen/haunted-terminal on 2026-10-26.
- Deployed on Vercel (production runs `GEMMA_MODE=router`). No custom domain.
