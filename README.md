# Contract Risk Radar

**See the risk in any contract in seconds.**

Contract Risk Radar reviews a contract clause by clause, flags one-sided or risky terms, proposes
concrete redlines, and scores the overall deal risk — with every flag pinned to the exact wording
so a human can accept it or push back. Built with the **OpenAI Agents SDK** for the HCLTech–OpenAI
Agentic AI Hackathon (Track 2 — Enterprise Operations / Legal).

## The problem

Contract review is slow and expensive: skilled time, clause by clause, on largely repetitive
checks against the same standard positions. Legal becomes the bottleneck every deal waits behind,
and one missed clause (uncapped liability, auto-renewal, broad IP assignment) can be costly.

## What it does

- **Summarizes** the contract: title, counterparty, type and key commercial terms.
- **Flags risky clauses** with severity, the risk to your side, a suggested redline, and a
  **verbatim citation** of the exact wording.
- **Detects missing** standard protective clauses.
- **Scores deal risk** (0–100, with severity breakdown), computed deterministically.
- **Recommends** a path — sign-ready / negotiate / escalate — with negotiation points.
- **Human in the loop**: approve, reject, **override the route**, add a note, **reopen**; the
  decision produces a cover note for the counterparty or internal owner.

## How it works

```
contract text
   └─ IntakeAgent → RiskAgent → score (Python) → AdviceAgent → ActionAgent (on decision)
      (metadata,    (findings +   (deal risk)    (recommendation  (cover note +
       key terms)    redlines +                   + points)        downstream action)
                     citations)                        │
                                                       └─► HUMAN: approve / reject / override / reopen
```

## Tech stack

- **Backend**: Python, FastAPI, OpenAI Agents SDK; live progress over Server-Sent Events.
- **Frontend**: a custom two-pane review workspace — the contract on the left with risky clauses
  highlighted inline, findings and redlines on the right (HTML/CSS/JS, no build step).

## Project structure

```
agents_pipeline.py            the agents, models, scoring and finalize logic
server.py                     FastAPI app (process, events/SSE, finalize)
web/                          index.html · style.css · app.js
synthetic_data/contracts/     2 sample contracts (SaaS master agreement, mutual NDA)
ContractRiskRadar_pitch.pdf   short pitch deck
```

## Getting started

You need an **OpenAI API key** (platform.openai.com — pay-as-you-go). A review costs a few cents.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # set OPENAI_API_KEY
python server.py
```

Open http://127.0.0.1:8040.

## Using it

1. Pick a sample contract (intentionally one-sided to show the analysis) — or paste your own.
2. Press **Review contract**.
3. On the left, the contract shows risky clauses highlighted by severity; on the right, the deal
   risk score, the recommendation, each finding with its suggested redline (click a finding to
   jump to the clause), and the missing standard clauses.
4. **Approve / Reject**, optionally **override the route** and add a note; a cover note and next
   steps are generated. Everything is in the audit trail and JSON export.

## Bring your own API key

No key in your `.env`? Click **Add API key** in the top bar and paste your own OpenAI key. It is
stored only in your browser (localStorage) and sent to your local server with each request; the
server falls back to its `.env` key if none is set. Never commit your key to the repo.

## Notes

Sample contracts are fictional and intentionally one-sided. Contract Risk Radar is a drafting and
review aid — **not legal advice**.
