---
name: deslop-writing
description: Make AI-written prose sound human ("de-slop"). Strips the tells that mark text as AI-generated — mechanical "not X but Y" contrasts, rhetorical drumrolls/setups, cute one-line sign-offs, hype and metaphor, em-dashes, rule-of-three cadence, and repeated clever phrases. Use when writing or editing articles, long-form prose, blog posts, LinkedIn posts, keynote/marketing copy, or any human-facing narrative, and whenever asked to "de-slop", "make it sound less like AI", "less LinkedIn-y", "less salesy/cringe/hype", or "sound more human".
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

# De-slop writing

## Purpose

Make written prose read like a sharp human wrote it, not a language model. The job is to remove the structural and lexical tics that AI over-uses, while keeping the facts, the numbers, and the argument exactly as they are. Apply it when drafting human-facing text, and especially when editing AI-generated drafts before they go to a real reader.

## The one principle underneath everything

**Structure isn't insight.** AI substitutes rhetorical _shape_ (set-up → contrast → payoff → mic-drop) for simply stating what's true. A human writing plainly states the finding, then maybe adds one line of "so what." Most de-slopping is just cutting the connective tissue and letting the point stand on its own.

## The tells, ranked by how "AI" they are

### 1. The mechanical contrast — the #1 giveaway

Every variant of antithesis used as a reflex:

- "It's not X, it's Y" / "not X, but Y"
- "X, not Y" — _"That distance is the prize, not a problem."_
- "X without the Y" — _"more jobs quoted without more estimators."_
- "stop X-ing and start Y-ing" — _"They stop asking and start building."_
- Triple negation — _"Not a demo, not a pilot, not a vendor's best case."_
- Balanced antithesis pairs — _"Connecting is the gateway. Scheduling is the amplifier."_

**Fix:** state the point positively, once. Keep a contrast _only_ when it carries real information (e.g. provenance: "this is from real usage, not a survey") — and never repeat the device in the same piece.

- ❌ "The hours don't come from a cleverer chatbot. They come from AI reaching into the tools the business runs on."
- ✅ "The hours come from AI reaching into the tools the business already runs on."

### 2. Rhetorical scaffolding — drumrolls before facts

Phrases that _announce_ a point instead of making it: "Here's the thing…", "Here's the most useful pattern…", "Here's the part that turns this into a playbook", "What's interesting is…", and teasers like "and it wasn't the obvious one."

**Fix:** delete the setup and lead with the finding.

- ❌ "Here's the most useful pattern in the data, and it's all measured. The typical business ran ~110 conversations…"
- ✅ "The most useful pattern in the data is also entirely measured: the typical business ran ~110 conversations…"

### 3. Cute one-line sign-offs

The mic-drop that ends a section: "Call that runway.", "That's the whole game.", "Let that sink in."

**Fix:** end on the substance. No flourish.

### 4. Hype and metaphor

"treat AI as plumbing", "a costume that intensity-of-use wears", "a compounding engine sitting idle", "the most encouraging thing in the data", and dead clichés like "move the needle" (worse when repeated).

**Fix:** plain nouns; cut superlatives. If a metaphor is genuinely clarifying, use it once.

### 5. Cadence tells

- **Em-dashes** are an AI signature. Replace with commas, colons, parentheses, or a full stop.
- **Rule-of-three triplets** — _"More jobs quoted. Faster month-ends. A brief that writes itself."_ One per piece is rhetoric; three per page is a tic.
- **Repeated clever phrase/metaphor** — using the same device twice reads as a pattern, not a flourish. One is fine; two is a tell.

## What NOT to flatten — context decides

De-slopping is not blanket flattening. The same punchy line is right in one place and wrong in another:

- **Pull-quotes** are _meant_ to be sharp — leave them.
- **Headings / keynote slide titles / a LinkedIn hook** can stay catchy; that's their job.
- **Body prose** is where plainness matters most.

So: flatten the narrative paragraphs; leave the elements whose job is to be punchy. When in doubt, ask whether the punch is doing work for the reader or just performing.

## Workflow

1. **Grep for tells first — it beats re-reading.** The patterns are mechanical, so a scan finds them faster and more completely than another read-through. See the cheat-sheet below.
2. **Rewrite plainly**, preserving every fact, number, and claim. Change voice, not substance.
3. **Do a second pass — rewriting re-slops.** Fixing slop tends to introduce _fresh_ slop (new em-dashes, a new "not X but Y"). Always re-grep after editing.
4. **Watch for hype hiding a factual error.** Punchy framing can assert more than the data supports. Forcing plain, literal phrasing often surfaces a claim that isn't actually true — fix the fact, not just the phrasing.

## Grep cheat-sheet

Run these over the draft (adjust the line range to skip front-matter / callout blocks you're keeping):

```bash
# em-dashes
grep -n "—" draft.md

# mechanical contrasts and drumrolls
grep -niE "not just|not only|isn't [a-z]+,|, not |here's the|here's what|what's (interesting|striking)|the real [a-z]+ is" draft.md

# tired clichés / hype
grep -niE "move the needle|game[- ]?changer|at the end of the day|let that sink in|the punchline|sea change|double down" draft.md

# repeated clever phrases (spot a word/metaphor used 2+ times)
grep -oiE "\w+" draft.md | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -40
```

Triage each hit: keep it only if it carries real information or sits in an element whose job is to be punchy (pull-quote, heading, hook); otherwise rewrite.

## Final checklist before handing prose to a human

- [ ] No reflexive "not X but Y" / "X, not Y" contrasts in body paragraphs (kept only where they inform)
- [ ] No "Here's the…" / drumroll setups before facts
- [ ] No cute one-line section sign-offs
- [ ] No em-dashes in body prose
- [ ] No clichés ("move the needle"), no superlative hype ("the most … in the data")
- [ ] No clever phrase or metaphor used twice
- [ ] Pull-quotes / headings / hooks left appropriately sharp (not over-flattened)
- [ ] Re-grepped after editing — the fix didn't re-introduce tells
- [ ] Every number and claim is unchanged from the source (and any plainer phrasing is still factually true)

## Notes

- This is about _voice_, not dumbing down. Plain ≠ simplistic. The goal is a smart, direct register — an analyst stating findings, not a growth post.
- Calibrate to the medium: a published article and a LinkedIn post tolerate different amounts of punch. Ask, or match the surrounding material.
