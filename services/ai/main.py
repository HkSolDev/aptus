import truststore

# Some source sites (e.g. IBPS) don't send a complete certificate chain;
# the OS trust store fills the gap the same way curl does, but Python's
# bundled certifi CA list doesn't. Must run before any httpx/requests call.
truststore.inject_into_ssl()

from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
