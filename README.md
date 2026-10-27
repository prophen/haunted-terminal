# Haunted Terminal

Hacktoberfest Week 4, theme "Ghost in the Machine" (Oct 26-31, 2026).
A ghost named Marlowe lives in a terminal and tells a branching spooky
story. The reader picks choices (or types an action), Gemma writes the next
passage, and ElevenLabs narrates it.

## Stack

- Next.js (App Router), plain JavaScript, no database. Story state lives in
  the page; nothing is stored server side.
- Story: Gemma through Google AI Studio by default
  (`GEMMA_CLOUD_MODEL=gemma-4-26b-a4b-it`, thinking budget 0), with an
  Ollama local fallback. The Gemma and ElevenLabs calls mirror Talk to the
  Book's proven routes.
- Narration: ElevenLabs TTS, one passage at a time.

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

- Domain: no `.tech` domain (her call, 2026-10-26). Nothing is claimed
  or deployed yet.
- Deploy target: Vercel is the natural fit (same as Talk to the Book).
- Voice: default voice id is Talk to the Book's fallback; pick a spookier
  voice before submitting.
- DEV post: the submission. Nothing submits under her name without her
  explicit approval.

## Guardrails

- New project, built in the Week 4 window. Not a Talk to the Book
  resubmission.
- Fiction only, spooky but never gory, no real-world tragedy.
- No em dashes in model output (prompt rule) or in project copy.

## Status

- Scaffolded 2026-10-26 evening after she picked the direction; `npm run build` passes.
- Pushed to https://github.com/prophen/haunted-terminal on 2026-10-26. Not deployed, no domain claimed.
