# Backend for "PDR, visualized" — FastAPI wrapping the real planner with the fast
# python-sat (lingeling) backend. This is the "more grunt than the browser" path:
# always-on, multi-core, no per-request timeout. Frontend stays on Vercel and
# points at this via VITE_BACKEND_URL.
#
#   docker build -t pdr-backend .
#   docker run -p 8000:8000 pdr-backend
#   curl localhost:8000/health   # -> {"ok":true,"engine":"lingeling"}
#
# Fly.io / Railway / Render all build this Dockerfile directly (see DEPLOY.md).
#
# Pinned to linux/amd64: that's what Fly.io (and most hosts) run, and python-sat
# ships prebuilt wheels only for amd64 — on arm64 there's no distribution to
# install. On an Apple-Silicon host this builds under emulation (slower) but
# produces the same image Fly runs.
FROM --platform=linux/amd64 python:3.12-slim

WORKDIR /app

# python-sat ships only pre-release (dev) builds on PyPI, so --pre is required and
# we pin the exact version verified locally (lingeling). Its amd64 manylinux wheel
# means no C toolchain is needed at build time. Deps first for layer caching.
RUN pip install --no-cache-dir --pre \
      "python-sat==1.9.dev5" \
      "fastapi>=0.110" \
      "uvicorn[standard]>=0.29"

# Run straight from source — pdr/ and server/ on the working dir are importable,
# so we don't depend on the package build backend.
COPY pdr ./pdr
COPY server ./server

ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000

# Honour the platform's injected $PORT (Railway/Render set it; Fly maps to 8080).
CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
