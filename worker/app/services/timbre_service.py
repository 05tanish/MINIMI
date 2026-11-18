import requests
from app.config import GNANI_API_BASE_URL, GNANI_API_KEY, GNANI_TTS_MODEL

def synthesize(text: str, voice: str, language: str, speed: float = 1) -> bytes:
    if not GNANI_API_KEY:
        raise ValueError("GNANI_API_KEY is not configured")
    if isinstance(speed, bool) or float(speed) not in {0.8, 1.0, 1.2}:
        raise ValueError("Unsupported Timbre v3.0 speed")
    response = requests.post(f"{GNANI_API_BASE_URL}/api/v1/tts/inference", headers={"X-API-Key-ID": GNANI_API_KEY, "Content-Type": "application/json"}, json={"text": text, "model": GNANI_TTS_MODEL, "voice": voice, "language": language, "speed": float(speed), "audio_config": {"encoding": "linear_pcm", "container": "wav", "num_channels": 1, "sample_rate": 48000, "sample_width": 2}}, timeout=120)
    response.raise_for_status()
    return response.content
