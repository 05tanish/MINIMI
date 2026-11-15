def annotate_segments(segments: list[dict], turns: list[dict]) -> list[dict]:
    """Attach anonymous diarization where locally available and flag ambiguity."""
    labels = {}
    for turn in turns:
        speaker = turn.get("speaker")
        if speaker and speaker not in labels:
            labels[speaker] = f"Speaker {len(labels) + 1}"
    output = []
    for raw in segments:
        segment = dict(raw)
        raw_speaker = segment.pop("speaker_id", None)
        if raw_speaker is not None:
            labels.setdefault(raw_speaker, f"Speaker {len(labels) + 1}")
            segment.setdefault("speaker", labels[raw_speaker])
        try:
            start = float(segment.get("start_time", segment.get("start")))
            end = float(segment.get("end_time", segment.get("end")))
        except (TypeError, ValueError):
            output.append(segment)
            continue
        segment["start_time"], segment["end_time"] = start, end
        try:
            confidence = float(segment.get("confidence", 1.0))
        except (TypeError, ValueError):
            confidence = 0.0
        segment["uncertain"] = bool(segment.get("uncertain")) or confidence < 0.55 or bool(segment.get("overlapping_speech"))
        overlaps = [turn for turn in turns if turn.get("start", start) < end and turn.get("end", end) > start]
        speakers = list(dict.fromkeys(turn.get("speaker") for turn in overlaps if turn.get("speaker")))
        if len(speakers) > 1:
            segment["speakers"] = [labels[speaker] for speaker in speakers]
            segment["speaker"] = None
            segment["overlapping_speech"] = True
            segment["uncertain"] = True
        elif speakers:
            segment["speaker"] = labels[speakers[0]]
        elif segment.get("speaker"):
            speaker = segment["speaker"]
            if not str(speaker).startswith("Speaker "):
                labels.setdefault(speaker, f"Speaker {len(labels) + 1}")
                segment["speaker"] = labels[speaker]
        output.append(segment)
    ordered = sorted(output, key=lambda item: item.get("start_time", float("inf")))
    for index, left in enumerate(ordered):
        for right in ordered[index + 1:]:
            if right.get("start_time", float("inf")) >= left.get("end_time", float("-inf")):
                break
            left_speaker, right_speaker = left.get("speaker"), right.get("speaker")
            if left_speaker and right_speaker and left_speaker != right_speaker:
                labels = list(dict.fromkeys([*(left.get("speakers", [])), left_speaker, right_speaker, *(right.get("speakers", []))]))
                left["speakers"] = right["speakers"] = labels
                left["overlapping_speech"] = right["overlapping_speech"] = True
                left["uncertain"] = right["uncertain"] = True
    return output
