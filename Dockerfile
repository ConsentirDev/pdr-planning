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
FROM python:3.12-slim

WORKDIR /app

# python-sat ships manylinux wheels, so no C toolchain is needed at build time.
# Install deps first so this layer caches across source changes.
RUN pip install --no-cache-dir \
      "python-sat>=0.1.8" \
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
