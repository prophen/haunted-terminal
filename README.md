# Haunted Terminal

A ghost named Marlowe lives inside an old computer terminal, and he needs your
help to finish his last story.

- **Play it:** https://haunted-terminal.vercel.app
- **Demo video:** https://youtu.be/K-CVyUl0Pvk
- **Write-up:** [Haunted Terminal on DEV](https://dev.to/nikema/haunted-terminal-a-ghost-in-an-old-computer-asks-you-to-help-finish-his-last-story-9bh)

Built for the DEV [Hacktoberfest Week 4 Challenge](https://dev.to/challenges/hacktoberfest-week4-2026-10-26),
"Ghost in the Machine" (October 26 to 31, 2026).

## What it is

A short, spooky, choose-your-path story told on a green-screen terminal.
Marlowe was a writer who typed his stories on this machine until the power
cut out mid-sentence one winter night. Now he speaks only by typing on the
screen, in capitals.

Each turn, the open-weight Gemma model writes the next passage of the story,
and you pick one of three choices or type your own action. After five choices
you reach an ending that follows from what you did. Every passage can be read
aloud by an ElevenLabs narrator.

## Features

- **Live, streamed story.** Passages appear word by word as Gemma writes them,
  like Marlowe typing in real time.
- **A real arc.** About six passages: a mystery, the truth about Marlowe, a
  climax with three different endings, and a resolution.
- **Narration.** ElevenLabs text-to-speech, streamed so playback starts right
  away, with a speed control and an Auto-narrate option.
- **Keyboard friendly.** Press 1, 2 or 3 to choose, or type your own action.
- **Handy controls.** A "passage N of 6" counter, Try again for a failed turn,
  Restart at any point, and Copy story to save the finished tale.
- **Accessible.** Audited against WCAG 2.2 AA: focus moves to each new
  passage, screen readers hear the finished passage once instead of every
  streamed fragment, colors meet contrast, every control has a visible focus
  ring, and motion stops under `prefers-reduced-motion`.
- **Spooky, never gory.** PG fiction with no real-world tragedy.

## Stack

- **Next.js** (App Router), plain JavaScript, no database. The story lives in
  the page; nothing is stored on a server.
- **Story:** Gemma 4 26B (`gemma-4-26b-a4b-it`), an open-weight model. Three
  ways to serve it, picked with `GEMMA_MODE`:
  - `router`: any OpenAI-compatible host, OpenRouter by default. Fastest, a
    few seconds to the first word. This is what the live site uses.
  - `cloud`: Google AI Studio, with thinking turned off.
  - `local`: Gemma in Ollama on your own machine.
- **Narration:** ElevenLabs text-to-speech. The default voice is Callum
  (`N2lVS1w4EtoT3dr4eOWO`); set `ELEVENLABS_VOICE_ID` to use another.
- **Hosting:** Vercel.

## Run it locally

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Then open http://localhost:3000.

In `.env.local`, set `GEMMA_MODE` and the key it needs (`ROUTER_API_KEY` for
`router`, `GOOGLE_AI_STUDIO_KEY` for `cloud`, nothing for `local`), plus
`ELEVENLABS_API_KEY` for narration. Without keys the app still runs in demo
mode with a canned story and tells you which key is missing. `.env.local` is
gitignored, so keys are never committed.

## Credit

The Gemma and ElevenLabs route code is adapted from my earlier project, Talk
to the Book. Haunted Terminal is a new project built during the Week 4 window.
