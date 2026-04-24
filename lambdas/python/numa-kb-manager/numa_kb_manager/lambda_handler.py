"""Lambda entry point — Mangum adapts the Function URL event to ASGI for FastAPI."""

from mangum import Mangum

from .app import app

# lifespan="off": the FastAPI app has no startup/shutdown hooks, and Mangum's
# default lifespan=auto adds an extra event loop spin-up per cold start.
handler = Mangum(app, lifespan="off")
