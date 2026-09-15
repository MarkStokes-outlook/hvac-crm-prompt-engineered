# FrostLine CRM — Prompt Engineered

Control repository for prompt-engineered FrostLine CRM build experiments.

Generated applications are developed only on `run/...` branches. `main` contains experiment setup, prompts and reference material only.

## Structure

- `reference/website/` — frozen public FrostLine website supplied to development agents.
- `prompts/claude-dev/` — versioned development prompts.
- `prompts/codex-ba/` — versioned BA/SME prompts.
- `transcripts/` — raw agent-session evidence captured for completed runs.
- `evidence/` — run evidence where required.

Run branches use `run/<prompt-id>/<model>-<effort>-<replicate>`, for example `run/001/claude-opus-5-high-001`.

Completed run branches are not merged back into `main`.
