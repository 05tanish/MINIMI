import requests
from app.config import GNANI_API_BASE_URL, GNANI_API_KEY, GNANI_TTS_MODEL

def synthesize(text: str, voice: str, language: str) -> bytes:
    if not GNANI_API_KEY:
        raise ValueError("GNANI_API_KEY is not configured")
    response = requests.post(f"{GNANI_API_BASE_URL}/api/v1/tts/inference", headers={"X-API-Key-ID": GNANI_API_KEY, "Content-Type": "application/json"}, json={"text": text, "model": GNANI_TTS_MODEL, "voice": voice, "language": language, "audio_config": {"encoding": "linear_pcm", "container": "wav", "num_channels": 1, "sample_rate": 48000, "sample_width": 2}}, timeout=120)
    response.raise_for_status()
    return response.content
