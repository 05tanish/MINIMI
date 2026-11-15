import shutil


def ffmpeg_executable() -> str:
    """Prefer a system FFmpeg; use the small platform wheel for native installs."""
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise FileNotFoundError("Install FFmpeg or imageio-ffmpeg to process audio") from exc
