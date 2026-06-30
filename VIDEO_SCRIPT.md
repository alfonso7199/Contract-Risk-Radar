# Contract Risk Radar — Submission & video script

## Submission form answers (copy/paste)

**Agent workflow.** Contract Risk Radar reviews a contract and scores the deal risk. (1)
**IntakeAgent** summarizes the contract: title, counterparty, type and key commercial terms. (2)
**RiskAgent** flags risky or one-sided clauses, each with a severity, the risk to our side, a
suggested **redline**, and a **verbatim citation** of the exact wording (so it can be highlighted
in the document); it also lists missing standard clauses. (3) A deterministic Python step computes
the **deal-risk score (0–100)**. (4) **AdviceAgent** gives a recommendation — sign-ready /
negotiate / escalate — with negotiation points. A human approves, rejects or overrides the route;
an **Action agent** drafts the cover note and downstream action.

**OpenAI technology stack.** OpenAI **Agents SDK** (Agent + Runner) with **structured outputs**
(Pydantic `output_type`); deterministic Python scoring from the findings; live agent progress
streamed over SSE. Default model GPT-4o-mini (raise to GPT-4o for sharper legal nuance). Built with
**Codex**.

---

## Video script (target 4–5 min)

### Part 1 — Pitch deck (~90 seconds)

- **[Slide 1 — Title]** "Hi, I'm ⟨name⟩. This is **Contract Risk Radar** — see the risk in any
  contract in seconds. Built with the OpenAI Agents SDK and Codex, for Track 2."
- **[Slide 2 — Problem]** "Contract review is slow and expensive — skilled time, clause by clause,
  on repetitive checks. Legal becomes the bottleneck every deal waits behind, and one missed clause
  — uncapped liability, auto-renewal — is costly."
- **[Slide 3 — How it works]** "Here's the **agent workflow**: IntakeAgent summarizes the contract,
  RiskAgent flags risky clauses with severity, a **verbatim citation** and a suggested redline,
  we score the deal risk, and AdviceAgent recommends sign, negotiate or escalate. A human decides —
  nothing is auto-signed."
- **[Slide 4 — What the judges see]** "You'll see the contract with risky clauses **highlighted
  inline**, the redlines, the risk score and the recommendation."
- **[Slide 5 — Impact & scale]** "Hours to minutes, consistently, with every flag pinned to the
  wording. It scales to NDAs, MSAs, vendor and procurement contracts."

### Part 2 — Live demo (~3 minutes)

1. "I open Contract Risk Radar at **localhost:8040**."
2. "First the key: I click **Add API key**, paste my own OpenAI key — anyone can run the repo. Dot
   turns green."
3. "I pick the sample **SaaS master agreement** — it's intentionally one-sided — no typing."
4. "I click **Review contract**. While it runs: IntakeAgent, then RiskAgent, then the score and the
   advice."
5. "Now the two-pane view. On the **left, the contract with risky clauses highlighted** by
   severity. On the right, the **deal-risk score**, the recommendation, and each finding with its
   **suggested redline**. I'll click a finding — see how it **jumps to the exact clause** in the
   document; that's the verbatim citation."
6. "It also lists **missing standard clauses** — protections that simply aren't there."
7. "I can **override the route** and **Approve** — and it drafts a cover note for the counterparty.
   That's Contract Risk Radar — see the risk before you sign it."
