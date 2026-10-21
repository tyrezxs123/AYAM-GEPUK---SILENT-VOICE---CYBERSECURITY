# Production Dockerfile for SilentVoice Backend API
FROM python:3.11-slim

# Install system dependencies for audio decoding (libsndfile is required by PySoundFile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY api/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy API application source code
COPY api/ /app/

# Application configuration
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV SUARASAH_DB=/app/data/suarasah.db

# Ensure data directory for SQLite exists
RUN mkdir -p /app/data

EXPOSE 8000

# Start Uvicorn server bound to PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
