"""
Contract Risk Radar - FastAPI backend.

  GET  /api/examples / /api/example/{name}
  POST /api/process            -> start a review (paste / example / upload)
  GET  /api/events/{job_id}    -> SSE: progress + result (includes the contract text)
  POST /api/finalize           -> decision -> downstream action + cover note

Run:  python server.py  (http://127.0.0.1:8040)
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, Header, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agents_pipeline import ContractResult, finalize_review, run_pipeline

load_dotenv()

ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
CONTRACTS_DIR = ROOT / "synthetic_data" / "contracts"
MAX_FILE_MB = 5

app = FastAPI(title="Contract Risk Radar")
JOBS: dict[str, asyncio.Queue] = {}


def _example_path(name: str) -> Optional[Path]:
    safe = Path(name.strip()).name
    if not safe:
        return None
    if not safe.endswith(".txt"):
        safe += ".txt"
    candidate = (CONTRACTS_DIR / safe).resolve()
    try:
        if candidate.parent == CONTRACTS_DIR.resolve() and candidate.exists():
            return candidate
    except OSError:
        return None
    return None


def friendly_error(e: Exception) -> str:
    low = str(e).lower()
    if "api key" in low or "api_key" in low:
        return "OpenAI API key missing or rejected. Check OPENAI_API_KEY in .env."
    if "rate limit" in low or "quota" in low:
        return "OpenAI rate limit or quota reached."
    return f"{type(e).__name__}: {e}"


def serialize(r: ContractResult) -> dict:
    return {
        "intake": r.intake.model_dump(),
        "report": r.report.model_dump(),
        "advice": r.advice.model_dump(),
        "risk": r.risk,
        "audit_log": [asdict(e) for e in r.audit_log],
    }


def apply_key(key) -> None:
    if key:
        os.environ["OPENAI_API_KEY"] = key
        try:
            from agents import set_default_openai_key
            set_default_openai_key(key)
        except Exception:
            pass


async def run_job(job_id: str, text: str, example: Optional[str], files: list[tuple[str, bytes]], key=None) -> None:
    q = JOBS[job_id]
    apply_key(key)

    def emit(etype: str, **kw) -> None:
        q.put_nowait({"type": etype, **kw})

    try:
        blocks = []
        if text.strip():
            blocks.append(text.strip())
        if example:
            p = _example_path(example)
            if p:
                blocks.append(p.read_text(encoding="utf-8"))
        for name, data in files:
            if data and len(data) <= MAX_FILE_MB * 1024 * 1024:
                blocks.append(data.decode("utf-8", errors="ignore"))
        contract = "\n\n".join(b for b in blocks if b.strip())
        if not contract.strip():
            emit("error", message="No contract text provided.")
            return

        def on_progress(agent: str, status: str) -> None:
            q.put_nowait({"type": "progress", "agent": agent, "status": status})

        result = await run_pipeline(contract, on_progress=on_progress)
        emit("result", data=serialize(result), contract=contract)
    except Exception as e:  # noqa: BLE001
        emit("error", message=friendly_error(e))
    finally:
        q.put_nowait(None)


@app.get("/api/examples")
async def list_examples() -> JSONResponse:
    return JSONResponse(sorted(p.stem for p in CONTRACTS_DIR.glob("*.txt")))


@app.get("/api/example/{name}")
async def get_example(name: str) -> JSONResponse:
    p = _example_path(name)
    if not p:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"name": p.stem, "text": p.read_text(encoding="utf-8")})


@app.post("/api/process")
async def process(
    text: str = Form(""),
    example: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    x_openai_key: str = Header(None),
) -> JSONResponse:
    blobs = [(f.filename, await f.read()) for f in files if f.filename][:3]
    job_id = uuid.uuid4().hex
    JOBS[job_id] = asyncio.Queue()
    asyncio.create_task(run_job(job_id, text, example.strip() or None, blobs, key=x_openai_key))
    return JSONResponse({"job_id": job_id})


@app.get("/api/events/{job_id}")
async def events(job_id: str) -> StreamingResponse:
    async def stream():
        q = JOBS.get(job_id)
        if q is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'unknown job'})}\n\n"
            return
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            JOBS.pop(job_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/finalize")
async def finalize(payload: dict = Body(...), x_openai_key: str = Header(None)) -> JSONResponse:
    apply_key(x_openai_key)
    try:
        result = await finalize_review(
            payload.get("intake") or {}, payload.get("report") or {},
            payload.get("advice") or {}, (payload.get("decision") or "approved").lower(),
            payload.get("note") or "",
        )
        return JSONResponse(result.model_dump())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": friendly_error(e)}, status_code=200)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"openai_key": bool(os.getenv("OPENAI_API_KEY"))})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8040"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
