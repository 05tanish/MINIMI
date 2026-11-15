FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ARG INSTALL_PYANNOTE=false
RUN if [ "$INSTALL_PYANNOTE" = "true" ]; then pip install --no-cache-dir "pyannote.audio>=4.0,<5"; fi
COPY app ./app
RUN useradd --create-home worker && mkdir -p /data/audio && chown -R worker:worker /data
USER worker
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
