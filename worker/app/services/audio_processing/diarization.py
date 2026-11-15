from app.config import PYANNOTE_ENABLED, PYANNOTE_MODEL, PYANNOTE_TOKEN


def analyze(path: str) -> dict:
    """Optional local pyannote pass. Model download/terms are configured by deployment."""
    if not PYANNOTE_ENABLED:
        return {"enabled": False, "available": False, "warning": "PYANNOTE_DISABLED"}
    if not PYANNOTE_TOKEN:
        return {"enabled": True, "available": False, "warning": "PYANNOTE_TOKEN_MISSING"}
    try:
        from pyannote.audio import Pipeline
        import torch
        pipeline = Pipeline.from_pretrained(PYANNOTE_MODEL, token=PYANNOTE_TOKEN)
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
        output = pipeline(path)
        annotation = output.speaker_diarization
        labels = {}
        turns = []
        for turn, raw_speaker in annotation:
            if raw_speaker not in labels:
                labels[raw_speaker] = f"Speaker {len(labels) + 1}"
            turns.append({"start": float(turn.start), "end": float(turn.end), "speaker": labels[raw_speaker]})
        overlaps = []
        for i, left in enumerate(turns):
            for right in turns[i + 1:]:
                if right["start"] >= left["end"]:
                    break
                if left["speaker"] != right["speaker"]:
                    overlaps.append({"start": max(left["start"], right["start"]), "end": min(left["end"], right["end"])})
        return {"enabled": True, "available": True, "turns": turns, "overlaps": overlaps, "model": PYANNOTE_MODEL}
    except Exception as exc:
        # Enhancement is best-effort; no raw exception text or input content in job state.
        return {"enabled": True, "available": False, "warning": type(exc).__name__}
