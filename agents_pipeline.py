"""
Contract Risk Radar - read a contract, flag risky clauses, propose redlines and
score the deal risk. Built with the OpenAI Agents SDK.

  IntakeAgent     -> contract metadata and key terms
  RiskAgent       -> risky clauses with severity, verbatim citation and a redline,
                     plus standard clauses that are missing
  (Python)        -> risk score from the findings
  AdviceAgent     -> negotiation recommendation and talking points

Synthetic / illustrative contracts only. Not legal advice.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()

MODEL = os.getenv("CONTRACT_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class KeyTerm(BaseModel):
    label: str
    value: str


class ContractIntake(BaseModel):
    title: str
    counterparty: Optional[str] = None
    contract_type: Optional[str] = None
    summary: str
    key_terms: list[KeyTerm] = Field(default_factory=list)


class Finding(BaseModel):
    clause_heading: str = Field(description="Short name of the clause, e.g. 'Limitation of Liability'")
    category: str = Field(description="Liability | IP | Termination | Data & Privacy | Payment | Confidentiality | Indemnity | Other")
    severity: str = Field(description="high | medium | low")
    issue: str = Field(description="Why this is risky for our side")
    suggested_redline: str = Field(description="Concrete replacement / fallback language")
    citation: str = Field(description="VERBATIM snippet copied from the contract (10-200 chars) that this refers to")


class RiskReport(BaseModel):
    findings: list[Finding] = Field(default_factory=list)
    missing_clauses: list[str] = Field(
        default_factory=list, description="Standard protective clauses that are absent"
    )


class Advice(BaseModel):
    route: str = Field(description="sign_ready | negotiate | escalate")
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    negotiation_points: list[str] = Field(default_factory=list)


class Finalization(BaseModel):
    decision: str = Field(description="approved | rejected")
    action: str = Field(description="sent_for_signature | returned_to_counterparty | escalated_to_legal")
    action_summary: str
    cover_note: str = Field(description="Short message to the counterparty or internal owner")
    next_steps: list[str] = Field(default_factory=list)


@dataclass
class AuditEntry:
    timestamp: str
    agent: str
    summary: str


@dataclass
class ContractResult:
    intake: ContractIntake
    report: RiskReport
    advice: Advice
    risk: dict
    audit_log: list[AuditEntry] = field(default_factory=list)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


PLAYBOOK = (
    "Standard protective positions (our side): liability should be capped (e.g. 12 "
    "months of fees) and mutual; no unlimited indemnities; we retain ownership of our "
    "pre-existing IP and our data; termination for convenience with notice should be "
    "mutual; auto-renewal needs a clear opt-out; payment terms net 30+; a data "
    "protection / confidentiality clause must exist; governing law and dispute venue "
    "should be acceptable; no unilateral change-of-terms."
)


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
def build_intake_agent() -> Agent:
    return Agent(
        name="IntakeAgent",
        model=MODEL,
        instructions=(
            "You summarize a contract for a reviewer. Extract the title, the "
            "counterparty, the contract type, a 2-3 sentence plain-language summary, "
            "and the key commercial terms (term length, fees, renewal, notice period, "
            "governing law) as label/value pairs. Use only what is in the text."
        ),
        output_type=ContractIntake,
    )


def build_risk_agent() -> Agent:
    return Agent(
        name="RiskAgent",
        model=MODEL,
        instructions=(
            "You are a commercial contracts reviewer protecting OUR side. Compare the "
            "contract to standard positions and flag risky or one-sided clauses. "
            f"Standard positions: {PLAYBOOK}\n"
            "For each issue return: the clause heading, a category, severity "
            "(high/medium/low), the risk to us, a concrete suggested redline, and a "
            "VERBATIM citation snippet copied exactly from the contract text (so it can "
            "be highlighted). Also list standard protective clauses that are missing "
            "entirely. Do not invent text that is not present."
        ),
        output_type=RiskReport,
    )


def build_advice_agent() -> Agent:
    return Agent(
        name="AdviceAgent",
        model=MODEL,
        instructions=(
            "Given the contract findings, give a recommendation: route 'sign_ready' if "
            "low risk, 'negotiate' if there are medium/high issues worth pushing back "
            "on, 'escalate' if there are severe or deal-breaking terms. Provide a "
            "confidence, a short rationale, and a prioritized list of negotiation "
            "points."
        ),
        output_type=Advice,
    )


def build_action_agent() -> Agent:
    return Agent(
        name="ActionAgent",
        model=MODEL,
        instructions=(
            "A reviewer has decided on a contract. If approved and route is sign_ready, "
            "action=sent_for_signature. If approved and route is negotiate, "
            "action=returned_to_counterparty with a redline cover note. If escalate or "
            "rejected, action=escalated_to_legal. Draft a short, professional cover "
            "note for the counterparty or internal owner and 2-4 next steps. Honor any "
            "reviewer note."
        ),
        output_type=Finalization,
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def compute_risk(report: RiskReport) -> dict:
    w = {"high": 24, "medium": 11, "low": 4}
    counts = {"high": 0, "medium": 0, "low": 0}
    total = 0
    for f in report.findings:
        sev = (f.severity or "low").lower()
        counts[sev] = counts.get(sev, 0) + 1
        total += w.get(sev, 4)
    total += 6 * len(report.missing_clauses)
    score = min(100, total)
    if score < 25:
        band = "Low risk"
    elif score < 55:
        band = "Moderate risk"
    elif score < 80:
        band = "High risk"
    else:
        band = "Severe risk"
    return {"score": score, "band": band, "counts": counts, "findings_total": len(report.findings)}


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
async def run_pipeline(
    contract_text: str,
    on_progress: Optional[Callable[[str, str], None]] = None,
) -> ContractResult:
    def notify(agent: str, status: str) -> None:
        if on_progress:
            on_progress(agent, status)

    audit: list[AuditEntry] = []

    notify("IntakeAgent", "Reading the contract and extracting key terms...")
    intake: ContractIntake = (await Runner.run(build_intake_agent(), input=contract_text)).final_output
    audit.append(AuditEntry(_now(), "IntakeAgent", f"{intake.contract_type or 'Contract'} with {intake.counterparty or 'counterparty'}"))

    notify("RiskAgent", "Flagging risky clauses and proposing redlines...")
    report: RiskReport = (await Runner.run(
        build_risk_agent(),
        input="CONTRACT:\n" + contract_text,
    )).final_output
    audit.append(AuditEntry(_now(), "RiskAgent", f"{len(report.findings)} findings; {len(report.missing_clauses)} missing clauses"))

    notify("ScoreAgent", "Scoring overall deal risk...")
    risk = compute_risk(report)
    audit.append(AuditEntry(_now(), "ScoreAgent", f"Risk {risk['score']}/100 ({risk['band']})"))

    notify("AdviceAgent", "Drafting the negotiation recommendation...")
    advice: Advice = (await Runner.run(
        build_advice_agent(),
        input=(
            "INTAKE:\n" + intake.model_dump_json()
            + "\n\nFINDINGS:\n" + report.model_dump_json()
            + "\n\nRISK:\n" + json.dumps(risk)
        ),
    )).final_output
    audit.append(AuditEntry(_now(), "AdviceAgent", f"route={advice.route}; confidence={advice.confidence:.2f}"))

    notify("Manager", "Review complete.")
    return ContractResult(intake=intake, report=report, advice=advice, risk=risk, audit_log=audit)


async def finalize_review(intake: dict, report: dict, advice: dict, decision: str, note: str = "") -> Finalization:
    agent = build_action_agent()
    note_block = f"\n\nREVIEWER NOTE:\n{note}" if note.strip() else ""
    prompt = (
        f"DECISION: {decision}\n\nINTAKE:\n{json.dumps(intake, ensure_ascii=False)}\n\n"
        f"ADVICE:\n{json.dumps(advice, ensure_ascii=False)}\n\n"
        f"FINDINGS COUNT: {len((report or {}).get('findings', []))}{note_block}"
    )
    return (await Runner.run(agent, input=prompt)).final_output
