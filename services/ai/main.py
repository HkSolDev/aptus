import os
from dotenv import load_dotenv
load_dotenv()
import truststore
from pipeline import run_pipeline

# Some source sites (e.g. IBPS) don't send a complete certificate chain;
# the OS trust store fills the gap the same way curl does, but Python's
# bundled certifi CA list doesn't. Must run before any httpx/requests call.
truststore.inject_into_ssl()

from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run")
def trigger_pipeline() -> dict[str,str]:
    run_pipeline()
    return {"status": "completed"}