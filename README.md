# Outbox Manager — Take-Home Project

## What this is

A small, focused exercise. We care far more about the **decisions you make and why** than about how much code you write. Plan for **~2–3 hours**.

What we're actually evaluating:

- **Judgment and trade-offs** over volume of code. A working core with honest gaps beats a polished UI with broken logic.
- **How you handle the hard parts** — out-of-order async, cancellation, failure/retry, keyboard accessibility, and safe rendering of untrusted message content — not how the pixels look.
- **How you reason about the unspecified.** Some things are left open on purpose (see the note in Bulk Dispatch); decide, and be ready to defend the call.

> Use whatever tools you like, including AI assistants. But everything you submit, you own: be ready to justify every decision live.

Commit **incrementally** — one logical step at a time, not a single squashed drop. We read the history.

## Overview

Build an Outbox Manager for an internal messaging platform. Users compose messages, review a queue, select multiple messages, and dispatch them in bulk.

The backend API is **intentionally unreliable** — requests can be slow, fail, or complete out of order. Your job is to make the UI reliable regardless.

## Stack

**Required:**

- React 19
- TypeScript
- Vite
- pnpm

**Styling (your choice):**

- Tailwind CSS
- CSS Modules
- SCSS
- Vanilla CSS
- CSS-in-JS (Emotion, styled-components, etc.)

**Do NOT use:**

- Component libraries (MUI, Chakra, Ant Design, Radix, shadcn/ui, React Bootstrap, etc.)
- Form libraries (React Hook Form, Formik, etc.)
- Data grid libraries

Small utility libraries (e.g., clsx, nanoid) are fine — mention why in your README.

## Getting Started

```bash
pnpm install
pnpm dev
```

## State Machine

```
                    ┌─────────┐
         compose    │         │   cancel
      ─────────────►│ PENDING │◄────────────
                    │         │
                    └────┬────┘
                         │  "Send Selected" / Retry
                         ▼
                    ┌─────────┐
              ┌─────│ SENDING │─────┐
              │     └────┬────┘     │
              │          │          │
          cancel     success    failure
              │          │          │
              ▼          ▼          ▼
         PENDING    DELIVERED    FAILED
                                   │
                              retry │
                                   ▼
                               SENDING
```

## Requirements

### 1. Message List

Display queued messages in a list. Each row shows:

- Subject
- Recipient
- Created date (relative or absolute)
- Current status (Pending / Sending / Delivered / Failed)
- Selection checkbox

### 2. Compose Form

A form above or beside the list with fields:

- Recipient (text)
- Subject (text)
- Message body (textarea)

On submit, add the message to the list with `status: 'pending'`. No backend persistence needed.

### 3. Bulk Dispatch

A "Send Selected" button that dispatches all selected pending messages.

**Constraint**: Messages to the **same recipient** must be sent **sequentially** (one after another, in creation order). Messages to **different recipients** should send concurrently.

Example:

```
Selected: A (to: alice) → sends immediately
          B (to: alice) → waits for A, then sends
          C (to: bob)   → sends immediately (different recipient)
          D (to: alice) → waits for B, then sends
```

**Left to you (decide and defend):** if a message in a sequential group fails, what happens to the ones still queued behind it — halt the rest, or keep going? There's no single right answer.

### 4. Cancel In-Flight Messages

Messages with `status: 'sending'` should show a Cancel button. Clicking it aborts the request and returns the message to `status: 'pending'`.

### 5. Error Handling & Retry

If sending fails:

- Show `status: 'failed'` with an error indicator
- Provide a [Retry] button
- Retrying one message must not affect others

### 6. Optimistic UX

The UI should update immediately when the user clicks "Send Selected" — no waiting for API responses before showing feedback.

### 7. Keyboard Accessibility

The message list must be fully keyboard-operable:

- **Arrow Up/Down**: move focus between rows
- **Space**: toggle selection of the focused row
- **Enter**: open message details (can be an expand or a simple detail view)

Focus must survive mutations:

- When a message changes status (Pending → Sending → Delivered), focus stays on that row
- When a message is removed, focus moves to the next row (or previous if it was the last)
- When a new message is added, the list remains navigable

Use stable identifiers, not array indices, for focus management.

## The Mock API

Provided in `src/api/messageApi.ts`. You can import:

```typescript
import { sendMessage } from "./api/messageApi";
```

The function signature:

```typescript
function sendMessage(messageId: string, signal?: AbortSignal): Promise<void>;
```

Behavior:

- Takes 1–3 seconds (random)
- Has a ~30% failure rate (random)
- Respects `AbortSignal` — throws `AbortError` if aborted
- Responses may complete in any order

## Deliverables

1. **Source code**, committed to git incrementally (we read the history).
2. **A short `NOTES.md`** (a few paragraphs) covering:
   1. your concurrency and failure-handling strategy for bulk dispatch — including the open decision above — and why;
   2. your approach to keyboard accessibility, and how you verified focus survives add / remove / status changes;
   3. anything you'd change at scale (e.g. thousands of messages), or traded off for time.

## Time

Spend 2–3 hours. If you hit 3 hours, stop. We prefer a working core with honest gaps over a polished UI with broken logic.

## Submission

- Commit your work incrementally — we read the history.
- When done, send us a `.zip` of the project. Make sure it **contains the `.git` folder** and **excludes `node_modules`**.
- Make sure `pnpm install && pnpm dev` runs cleanly from a fresh checkout.

Good luck!

---
