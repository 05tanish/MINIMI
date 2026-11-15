import struct
import wave
import os
import sys
from pathlib import Path

os.environ.setdefault("WORKER_STORAGE_DIR", "/tmp/minimi-audio-processing-tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.audio_processing.pipeline import detect_voice_regions
from app.services.audio_processing.segments import annotate_segments


class SequenceVad:
    sequence = []

    def __init__(self, mode):
        assert mode == 3

    def is_speech(self, frame, sample_rate):
        assert sample_rate == 16000
        value = SequenceVad.sequence.pop(0)
        return value


def wav_file(tmp_path, frames):
    path = tmp_path / "sample.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(struct.pack("<" + "h" * (frames * 480), *([0] * frames * 480)))
    return path


def test_background_noise_is_non_speech_when_vad_rejects_it(tmp_path):
    SequenceVad.sequence = [False] * 40
    speech, silence, duration = detect_voice_regions(wav_file(tmp_path, 40), SequenceVad)
    assert speech == []
    assert silence == [{"start": 0.0, "end": duration}]


def test_quiet_background_hum_is_rejected_by_webrtc_vad(tmp_path):
    path = tmp_path / "quiet-hum.wav"
    samples = [18 if index % 2 else -18 for index in range(16000)]
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(struct.pack("<" + "h" * len(samples), *samples))
    speech, silence, _ = detect_voice_regions(path)
    assert not speech
    assert silence


def test_silence_only_recording_has_no_speech_regions(tmp_path):
    SequenceVad.sequence = [False] * 34
    speech, silence, _ = detect_voice_regions(wav_file(tmp_path, 34), SequenceVad)
    assert not speech
    assert silence


def test_multiple_speakers_and_overlap_are_anonymous_and_uncertain():
    annotated = annotate_segments(
        [{"start_time": 1.0, "end_time": 2.0, "text": "unclear words"}],
        [{"start": 1.0, "end": 1.8, "speaker": "SPEAKER_00"},
         {"start": 1.4, "end": 2.0, "speaker": "SPEAKER_01"}],
    )
    assert annotated[0]["overlapping_speech"] is True
    assert annotated[0]["uncertain"] is True
    assert annotated[0]["speakers"] == ["Speaker 1", "Speaker 2"]
    assert "SPEAKER_00" not in str(annotated)


def test_overlapping_provider_timestamps_are_flagged_without_merging():
    annotated = annotate_segments([
        {"start_time": 0.0, "end_time": 1.2, "text": "first words", "speaker_id": 1},
        {"start_time": 0.8, "end_time": 1.5, "text": "second words", "speaker_id": 2},
    ], [])
    assert [segment["text"] for segment in annotated] == ["first words", "second words"]
    assert all(segment["overlapping_speech"] and segment["uncertain"] for segment in annotated)


def test_poor_quality_low_confidence_segment_is_flagged():
    annotated = annotate_segments(
        [{"start_time": 0.0, "end_time": 0.4, "text": "unclear", "confidence": 0.2}], []
    )
    assert annotated[0]["uncertain"] is True
