import subprocess
import wave
from pathlib import Path

from app.config import VAD_MIN_SILENCE_SECONDS
from app.utils.ffmpeg import ffmpeg_executable


def preprocess(source: Path, working: Path, denoise: bool = False) -> dict:
    """Create a normalized working copy, optionally FFT-denoise, and run CPU VAD."""
    working.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_executable(), "-nostdin", "-v", "error", "-y", "-i", str(source),
        "-map", "0:a:0", "-vn"
    ]
    denoise_status = "not_requested"
    if denoise:
        try:
            subprocess.run(command + ["-af", "afftdn=nr=12:nf=-50:tn=1", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(working)], capture_output=True, timeout=900, check=True)
            denoise_status = "ffmpeg-afftdn"
        except (subprocess.SubprocessError, OSError):
            # Preserve availability if the installed FFmpeg build lacks this filter.
            working.unlink(missing_ok=True)
            denoise_status = "fallback_unfiltered"
            subprocess.run(command + ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(working)], capture_output=True, timeout=900, check=True)
    else:
        subprocess.run(command + ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(working)], capture_output=True, timeout=900, check=True)
    speech, silence, duration = detect_voice_regions(working)
    return {"path": str(working), "duration": duration, "speechRegions": speech, "silenceRegions": silence,
            "vad": "webrtcvad", "denoise": denoise_status, "sourcePreserved": source.is_file() and source != working}


def detect_voice_regions(wav_path: Path, vad_factory=None) -> tuple[list[dict], list[dict], float]:
    if vad_factory is None:
        import webrtcvad
        vad_factory = webrtcvad.Vad
    detector = vad_factory(3)
    frame_ms = 30
    with wave.open(str(wav_path), "rb") as audio:
        rate, channels, width = audio.getframerate(), audio.getnchannels(), audio.getsampwidth()
        if rate not in (8000, 16000, 32000, 48000) or channels != 1 or width != 2:
            raise ValueError("VAD requires mono 16-bit PCM at a supported sample rate")
        frame_samples = int(rate * frame_ms / 1000)
        frame_bytes = frame_samples * width
        total_frames = audio.getnframes()
        frames = []
        while True:
            frame = audio.readframes(frame_samples)
            if not frame:
                break
            # WebRTC VAD accepts only complete 10, 20 or 30 ms frames.
            if len(frame) < frame_bytes:
                frame += b"\0" * (frame_bytes - len(frame))
            frames.append(detector.is_speech(frame, rate))
    duration = total_frames / rate
    # Smooth isolated frame flicker while preserving brief pauses and overlap timing.
    active = [False] * len(frames)
    pad = 2
    voiced = [index for index, value in enumerate(frames) if value]
    for index in voiced:
        for padded in range(max(0, index - pad), min(len(active), index + pad + 1)):
            active[padded] = True
    speech = []
    run = None
    for index, value in enumerate(active + [False]):
        if value and run is None:
            run = index
        elif not value and run is not None:
            start, end = run * frame_ms / 1000, min(duration, index * frame_ms / 1000)
            speech.append({"start": start, "end": end})
            run = None
    merged = []
    for region in speech:
        if merged and region["start"] - merged[-1]["end"] <= VAD_MIN_SILENCE_SECONDS:
            merged[-1]["end"] = region["end"]
        else:
            merged.append(region)
    speech = merged
    silence, cursor = [], 0.0
    for region in speech:
        if region["start"] > cursor:
            silence.append({"start": cursor, "end": region["start"]})
        cursor = region["end"]
    if cursor < duration:
        silence.append({"start": cursor, "end": duration})
    return speech, silence, duration
