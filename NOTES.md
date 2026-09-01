# Notes

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test:run   # 5 tests
pnpm build      # tsc -b && vite build
```

**No runtime dependencies were added.** `crypto.randomUUID()` replaces nanoid, `Intl.*` replaces a
date library, and template strings replace clsx. Dev dependencies are `sass` and the Vitest +
Testing Library set — both driven by choices explained below rather than by the brief.

---

## What I decided, and what was already decided for me

Before the reasoning, the boundary — because a chunk of what looks like judgment here is just the
brief being followed.

**Specified by the brief:** same-recipient sequencing in creation order with cross-recipient
concurrency; Cancel aborts and returns *that* message to pending; failure shows an error and offers
Retry, and retrying one message must not affect others; the UI updates before any response; arrow
keys move focus, Space selects, Enter opens details; focus survives status change and removal; stable
identifiers rather than array indices.

**Left open, and therefore mine:** what happens to messages queued behind a failure.

**Added by me, and not asked for:** a Delete control (requirement 7 specifies removal focus behaviour
but nothing in the brief creates a removal, so it was needed to make that demonstrable); a "Queued"
indicator; an explanation banner when a chain halts; `role="grid"` semantics and a live region;
SCSS architecture; memoisation; tests.

---

## (a) Concurrency and failure handling

### The shape of it

Three layers, and the separation is the design:

```
UI  ──dispatch(action)──▶  reducer (pure, synchronous, the only writer of state)
                                      ▲
                          async layer ┘  per-recipient queues · AbortController registry
                                         sendMessage() ──▶ dispatch(succeeded | failed)
```

The constraint — same recipient sequential, different recipients concurrent — is a **mutex keyed by
recipient**. Each recipient owns a queue; one `pump` loop drains it serially; separate recipients
pump independently, which is where the concurrency comes from.

I used an explicit queue rather than a promise chain (`chain = chain.then(...)`). The chain is
shorter but opaque: you cannot inspect what is waiting, pull a message out of it, or return the
messages behind a failure to pending. All three are required here. Dequeuing advances a `head` index
rather than calling `shift`, so it is O(1); `byId` gives O(1) lookup on every completion; selection
is a `Set`.

### A reducer alone does not solve race conditions

This is the part I would most want to talk through. The reducer rejects *illegal* transitions, but a
success landing on a message the user already cancelled is a perfectly ordinary `sending → delivered`
— structurally indistinguishable from a legitimate one. Two mechanisms outside the reducer are
needed, and each solves a different half:

| Mechanism | Solves | Does not solve |
|---|---|---|
| `AbortController` | Stops work in flight | Anything already settled — an abort can **lose** |
| `attempt` (fencing token) | Recognising a superseded result | Stopping the request |
| Reducer guard | Applying that recognition in one place | Knowing which request is current |

**There is a real race in the provided mock.** `settle()` in `messageApi.ts` clears its timer *and
removes the abort listener* when a request resolves. An abort arriving afterwards is a silent no-op:
nothing throws, no `AbortError` is raised, the catch block never runs. So if the state change were
left to that catch, the attempt token would never be bumped, the already-resolved `SEND_SUCCEEDED`
would arrive carrying a token the reducer still considers current, and **a message the user had just
cancelled would be marked delivered.**

`cancel()` therefore dispatches *before* it aborts. That bumps the attempt, superseding the request
immediately, so the stale success fails the guard whether or not the abort lands; the abort becomes
best-effort cleanup. The rule this generalises to: **whoever initiates a cancellation owns the state
transition; the async layer's `AbortError` branch is control flow only.**

The third test in `src/dispatch/useDispatcher.test.ts` pins exactly this. Its fake sender replicates
the mock's `settled` guard, resolves the request first, and cancels second. Delete the `dispatch`
from `cancel()` and it fails with `expected 'delivered' to be 'pending'`.

### The open decision: halt

**On failure, the rest of that recipient's chain stops** and those messages return to `pending`,
re-selectable, with a banner explaining why.

The brief says there is no single right answer, so it is grading the reasoning. Both options are
defensible; my tiebreaker is **asymmetry of harm**. Halting fails safe — nothing is delivered out of
order, and the worst case costs the user a click. Continuing fails unsafe — it silently delivers a
later message after an earlier one failed, which cannot be undone. *Under genuine ambiguity, choose
the recoverable failure.* The constraint's own wording supports it: it says sequential **"in creation
order"**, and order would not need specifying if this were only rate limiting.

**Cancel deliberately does not halt the chain** — the next sibling starts immediately. That is not
inconsistent, and the unifying rule is: *the user may do anything to their own messages, but the
system may not make ordering decisions on their behalf.* Cancel is the user acting with full context
on a control that says exactly what it does. A failure is the system, with no idea what went wrong
and no mandate to decide "send the next one anyway", so it stops and hands the decision back.

**The cost, stated plainly:** halting hurts throughput. At a ~30% failure rate a group of four is
more likely than not to need a second pass, so users will click Send more than once. The production
fix is bounded retry with jittered backoff before declaring a chain dead.

**And the honest limit:** no client-side policy can guarantee ordering anyway. `AbortController` is a
client-side hangup — when you abort an in-flight send you do not know whether the server processed
it, so "cancelled" may really mean "delivered, and the UI is now lying". Real ordering and
exactly-once delivery need **server-side idempotency keys and a per-recipient sequence number**.
Everything here is a UX affordance, not a correctness guarantee.

### Optimistic UI without inventing a state

"Send selected" marks the whole batch in one synchronous dispatch before any request leaves. Messages
waiting behind a same-recipient send stay `status: 'pending'` and carry a display-only `queued` flag
rendered as a "Queued" badge. The state machine in the brief has four states, so making `queued` a
fifth would contradict it — and a queued message genuinely *is* still pending, because nothing has
been sent. Optimism should predict a likely outcome, not assert a false one.

---

## (b) Keyboard accessibility

### `role="grid"`, not `role="listbox"`

A listbox looks like the obvious fit for a multi-select list, and it is wrong here: `role="option"`
may not contain interactive children, and these rows carry a checkbox, an expand toggle, and Cancel /
Remove / Retry / Delete buttons. Under a listbox those controls are simply not exposed to assistive
technology. A grid legitimises both the arrow-key navigation and the interactive cell content.
Selection is a real `<input type="checkbox">` rather than `aria-selected`, so it is announced
natively.

**Documented gap:** the full grid pattern also expects Left/Right cell navigation. I implement
row-level roving focus and let Tab reach the row's buttons. I would rather ship the correct role with
a known gap than a simpler role that misrepresents the content.

### Roving tabindex, keyed by id

Exactly one row is tabbable, so the list is a single Tab stop: Tab reaches it, arrows move within it.
The ref registry is keyed by message id, never by array index — index-based focus breaks the moment
anything is inserted above the cursor. `activeId` also falls back to the first row if `focusedId` no
longer resolves, since otherwise no row would be tabbable and the list would silently drop out of the
tab order.

Keys: Arrow Up/Down (clamped, not wrapping), Home/End, Space to select, Enter to expand, Delete to
remove. The handler ignores events unless the **row itself** holds focus, so a checkbox or button
inside the row keeps its own Space and Enter behaviour.

### The focus-restore guard

The subtle part. Rows change status constantly during a dispatch, so an effect that re-focused on
every render would drag focus back into the list while the user was typing in the compose form. The
effect runs after every commit — deliberately no dependency array — but a **flag**, not the
dependencies, decides whether it acts. Focus moves only when something explicitly asked: a key press,
or a mutation that destroyed the focused row.

Removal is the case that needs help, because deleting destroys the focused node and focus would fall
to `<body>`. The reducer picks the successor from the **pre-removal** order (next row, or previous
when the deleted row was last) in the same action that removes, and restoration is requested before
dispatching.

### How I verified it

`src/components/MessageList.focus.test.tsx` asserts on `document.activeElement` — focus survival is a
statement about the browser's focus, not about how a row is styled.

- **Status change:** dispatch starts, a row is focused, it goes `sending → delivered`, focus never
  leaves. Then the harder half: with rows still settling, typing into the compose textarea must not
  have focus dragged away.
- **Removal:** deleting a middle row moves focus to the next; deleting the last moves it to the
  previous; `activeElement` is never `<body>`.
- **Addition:** covered structurally — `focusedId` is untouched by `ADD_MESSAGE` unless nothing was
  focused, and rows are keyed by id so the focused node is not remounted.

**Both tests are non-vacuous, which I checked rather than assumed.** Removing the `wantFocus` guard
makes the first fail with focus yanked out of the textarea; changing the delete successor to `null`
makes the second fail.

One correction worth recording: my first version of the status test focused a row and *then* clicked
"Send selected", and failed — because clicking a button moves focus to it, as any button does. That
is correct behaviour, not a bug. The requirement is that the app never *steals* focus once the user
has placed it, so the test now focuses a row after dispatch is under way.

Manual passes: full keyboard-only operation, and Narrator for the live region.

---

## (c) At scale, and what I traded away

**Virtualisation** is the right answer at thousands of rows and I did not build it. It also conflicts
directly with roving tabindex — the focused row can unmount while it holds focus — and reconciling
those two is genuinely hard rather than merely long. I would rather name that than half-do it.

**Re-render cost** is handled but not eliminated. `MessageRow` is memoised, and it works only because
the reducer replaces just the message that changed and leaves every other object referentially
identical; the two go together, and without that structural sharing the memo would be decorative.
(`handleDelete` had to move into `useCallback` for the same reason — one unstable prop defeats the
whole thing.) `MessageList` itself still re-renders on every state change. At scale I would move to
`useSyncExternalStore` with per-id selectors so each row subscribes to its own slice.

**No bounded retry with backoff**, which is the real answer to the throughput cost of halting.

**Server-side ordering and idempotency keys**, as above — the honest place for the guarantee.

**Testing is deliberately small: five tests, on one rule** — cover the claims that cannot be verified
by clicking. Serialisation is visible in the UI; a cancel whose abort loses the race is not, because
it depends on the timing of a 1–3 second request against a random failure rate. Not tested: the
reducer in isolation (exercised through the real path by the scheduler tests, which is better value
per test), arrow/Space/Enter navigation, retry isolation, and rendering. All were checked by hand.

**Not added, on purpose:** React Router (one screen; a detail *route* is plausible but would
complicate focus restoration) and any component library (the accessibility work here is the point).

---

## If this were your stack

No state library is used, and since the brief bans component, form and grid libraries but *not* state
libraries, that was a choice rather than a constraint.

- **Redux-Saga** — the per-recipient queue is an `actionChannel` per recipient, `fork`ed for
  concurrency, with `cancel()` and `finally` blocks for cancellation. I would reach for it once this
  orchestration spans more than one screen.
- **TanStack Query** — `useMutation` gives per-message error and retry state for free, but it has no
  concept of ordering *between* mutations, so the per-recipient serialisation is still mine to build.
- **Zustand** — would replace reducer + context and fix the remaining whole-list re-render properly
  via per-id selectors. At this size it would add a dependency and scatter the state-machine guards
  that are the correctness story here.

I chose `useReducer` plus split contexts because the whole difficulty of this exercise is out-of-order
async, and a reducer gives exactly one chokepoint where a stale result can be rejected. Scattering
`setMessages` across five callbacks would mean five places for that bug to hide.

---

## Reading the history

The commits fall into two blocks. Everything up to and including `feat: announce halts and failures`
is the brief itself, in the order the reasoning actually happened — scheduler, then cancellation,
then retry, then keyboard and focus. The `test:` commits come after it, kept separate and last
because tests were not part of the brief and should be easy to consider, or ignore, on their own.

If you read one thing, make it `cancel()` in `src/dispatch/useDispatcher.ts`. The comment above it
explains the abort-versus-resolve race, which is the least obvious thing in the codebase and the
reason those two statements cannot be swapped.
