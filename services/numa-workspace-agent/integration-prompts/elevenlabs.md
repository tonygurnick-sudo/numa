# ElevenLabs Integration Tips

ElevenLabs is a voice-AI platform: text-to-speech, voice cloning, and Conversational AI agents that can place automated outbound phone calls. The Pipedream integration exposes text-to-speech, voice/model listing, voice creation, history retrieval, and outbound calling.

## Outbound phone calls (Conversational AI)

`elevenlabs-make-outbound-call` places a **real phone call to a real person** via the user's ElevenLabs Conversational AI agent (Twilio-backed). It needs three things, and the first two are NOT raw values you can guess:

1. **`agent_id`** — the Conversational AI agent that will speak. If the user doesn't already have one, create it first with `elevenlabs-create-agent` (you'll define its system prompt / first message). Confirm the agent's script with the user.
2. **`phone_number_id`** — NOT the phone number itself. It's the ID of a number already provisioned in the user's ElevenLabs account. Resolve it with `elevenlabs-list-phone-number-id-options` (use `configure_props`).
3. **The recipient's phone number** — in E.164 format (e.g. `+6421234567`).

Because this dials a real person and consumes ElevenLabs + Twilio credits, **always confirm the recipient number, the agent, and the call's purpose/script with the user before calling.** `run_action` already requires approval, but state plainly what you're about to do so the approval is informed.

## Text to speech

`elevenlabs-text-to-speech` converts text into an audio file.

- **Voice:** list options with `elevenlabs-get-voices-with-descriptions` and pass the chosen voice. Don't invent voice IDs.
- **Model:** `elevenlabs-list-models` (e.g. a multilingual model for non-English text).
- **Tuning (leave default unless asked):** `stability` — lower is more expressive but varies between regenerations, higher is more consistent; `similarity_boost` — higher tracks the source voice more closely, but very high values can introduce artifacts.
- The generated audio lands in `/workdir/tmp/integrations-results/`. If the user wants the file as a deliverable, `cp`/`mv` it into `/workdir/outputs/` so it appears in their Files page; otherwise reference it inline.

## Voices, models & history

- `elevenlabs-add-voice` creates/clones a voice from samples — confirm before adding; it consumes the user's voice slots.
- `elevenlabs-download-history-items` and `elevenlabs-get-audio-from-history-item` retrieve previously generated audio. Promote to `/workdir/outputs/` only if the user asked for the file.

## Cost awareness

Text-to-speech generation, voice cloning, and outbound calls all consume the user's ElevenLabs (and, for calls, Twilio) credits. Do exactly what was asked, once — don't batch-generate or place speculative calls.
