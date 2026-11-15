# Minimi | Research that remembers

**Minimi is a context-aware research assistant that connects what you have discussed with what is true today.** It searches your conversation history and current web sources together, then gives you a cited answer that makes relevant changes clear.

## The problem

Research is often scattered across browser tabs and past conversations. A standard search engine has no memory of what you already explored, while a chat assistant may not know whether an earlier fact has changed. People end up repeating research, checking sources manually, and piecing together the timeline themselves.

## The solution

Ask Minimi in natural language. It finds relevant details from your private conversation history, searches for current evidence, extracts comparable facts, and highlights what is new, changed, or still unconfirmed. The answer streams into chat with source references, so you can follow the research as it happens and inspect the evidence behind the result. Follow-up questions can build on prior context instead of starting from scratch.

Minimi also supports optional image and PDF questions, speech transcription and playback, and background audio processing—bringing research into the formats people already use.

## Why Minimi

- **Continuity:** Relevant prior discussions inform new research.
- **Clarity over time:** Structured comparisons make changes easier to spot.
- **Evidence in view:** Answers include citations and progressive research updates.
- **Private by design:** Account-scoped history, secure sessions, and server-side provider credentials keep each user's conversations under their account.

## Product foundation

Minimi is built as a React client and Node.js API, with PostgreSQL and pgvector for conversation memory, web search and language model integrations for research, and an optional private audio worker. Its bounded research workflow and durable chat events support responsive answers and reconnection if a session is interrupted.

**Minimi turns scattered conversations and live web research into one continuous, evidence-backed workspace.**
