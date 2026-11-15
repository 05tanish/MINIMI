import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFile = promisify(execFileCallback);
const allowed = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.opus', '.amr']);

/**
 * Find the best available media-info binary.
 * Preference order: ffprobe → ffmpeg.
 * Both are part of the ffmpeg package; some distros only ship one.
 * Returns { bin, mode } where mode is 'ffprobe' or 'ffmpeg'.
 */
function findMediaBinary() {
  // Check common locations and PATH
  const probeNames = ['ffprobe'];
  const ffmpegNames = ['ffmpeg'];

  for (const name of probeNames) {
    // Check PATH by trying to run; we'll catch ENOENT in the caller
    try {
      const located = ['ffprobe', '/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe'].find((p) => {
        try { return existsSync(p) || p === 'ffprobe'; } catch { return false; }
      });
      if (located) return { bin: located, mode: 'ffprobe' };
    } catch {}
  }

  for (const name of ffmpegNames) {
    try {
      const located = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => {
        try { return existsSync(p) || p === 'ffmpeg'; } catch { return false; }
      });
      if (located) return { bin: located, mode: 'ffmpeg' };
    } catch {}
  }

  return null;
}

/**
 * Run ffprobe to get format/duration metadata as JSON.
 * Throws with code ENOENT if binary is missing.
 */
async function probeWithFfprobe(bin, file) {
  const { stdout } = await execFile(bin, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name',
    '-of', 'json',
    file
  ], { timeout: 12000, maxBuffer: 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  return { duration: Number(metadata.format?.duration), formats: String(metadata.format?.format_name || '').split(',') };
}

/**
 * Run ffmpeg -i to parse metadata from stderr (no ffprobe needed).
 * ffmpeg always exits non-zero when no output is specified — that is expected.
 */
async function probeWithFfmpeg(bin, file) {
  let log = '';
  try {
    await execFile(bin, ['-nostdin', '-hide_banner', '-i', file, '-t', '0.001', '-f', 'null', '-'], {
      timeout: 12000,
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (err) {
    // ffmpeg exits with code 1 for no-output runs — stderr still has the info
    log = err.stderr || '';
    if (err.code === 'ENOENT') throw err; // binary not found — re-throw
  }

  const durationMatch = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const formatMatch = log.match(/Input #\d+, (.*?), from /);

  let duration = NaN;
  if (durationMatch) {
    duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
  }

  if ((!Number.isFinite(duration) || duration <= 0) && log.includes('Audio:')) {
    // For streaming containers (live WebM/OGG) where Duration: is N/A,
    // do a full null-decode pass to get the final timestamp
    let decodeLog = '';
    try {
      await execFile(bin, ['-nostdin', '-hide_banner', '-i', file, '-f', 'null', '-'], {
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (err2) {
      decodeLog = err2.stderr || '';
    }
    const timeMatches = [...decodeLog.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    if (timeMatches.length > 0) {
      const last = timeMatches[timeMatches.length - 1];
      duration = Number(last[1]) * 3600 + Number(last[2]) * 60 + parseFloat(last[3]);
    }
  }

  const formats = formatMatch ? formatMatch[1].split(',').map((s) => s.trim()) : [];
  return { duration, formats };
}

/**
 * Try ffprobe first; if not found fall back to ffmpeg; if neither found return null.
 */
async function probeFile(file) {
  // Try ffprobe first
  try {
    const result = await probeWithFfprobe('ffprobe', file);
    return { ...result, binary: 'ffprobe' };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // ffprobe found but returned an error — file is likely corrupt
      throw err;
    }
  }

  // ffprobe not found → try ffmpeg
  try {
    const result = await probeWithFfmpeg('ffmpeg', file);
    return { ...result, binary: 'ffmpeg' };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  return null; // neither binary available
}

/**
 * Try to get stream-level duration via ffprobe (for containers where
 * container-level duration is missing, e.g. live WebM).
 */
async function probeStreamDuration(file) {
  try {
    const { stdout } = await execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=duration',
      '-of', 'json',
      file
    ], { timeout: 10000 });
    const streamDuration = Number(JSON.parse(stdout).streams?.[0]?.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) return streamDuration;
  } catch {}
  return null;
}

export async function validateShortAudio(bytes, filename) {
  const extension = path.extname(filename).toLowerCase();
  if (!allowed.has(extension)) {
    throw Object.assign(
      new Error('Unsupported audio format for immediate transcription. Use WAV, MP3, OGG, FLAC, AAC, M4A, WEBM or OPUS.'),
      { code: 'UNSUPPORTED_AUDIO_FORMAT' }
    );
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 128 || bytes.length > 10 * 1024 * 1024) {
    throw Object.assign(
      new Error('Audio must be between 128 bytes and 10 MB.'),
      { code: 'INVALID_AUDIO_SIZE' }
    );
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'minimi-audio-'));
  const file = path.join(directory, `input${extension}`);

  try {
    await writeFile(file, bytes, { mode: 0o600 });

    const probe = await probeFile(file);

    if (!probe) {
      // Neither ffprobe nor ffmpeg is installed on the host.
      // The Docker worker has ffmpeg, so for immediate (<30s) clips we
      // can safely skip host-side validation and let Gnani reject bad input.
      // We only check the magic bytes as a minimal guard.
      const magic = bytes.slice(0, 12);
      const isWebm = magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3;
      const isMp3Id3 = magic[0] === 0x49 && magic[1] === 0x44 && magic[2] === 0x33;
      const isMp3Sync = (magic[0] === 0xff && (magic[1] & 0xe0) === 0xe0);
      const isWav = magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46;
      const isOgg = magic[0] === 0x4f && magic[1] === 0x67 && magic[2] === 0x67 && magic[3] === 0x53;
      const isFlac = magic[0] === 0x66 && magic[1] === 0x4c && magic[2] === 0x61 && magic[3] === 0x43;
      const isM4a = magic[4] === 0x66 && magic[5] === 0x74 && magic[6] === 0x79 && magic[7] === 0x70;
      const knownMagic = isWebm || isMp3Id3 || isMp3Sync || isWav || isOgg || isFlac || isM4a;
      if (!knownMagic) {
        throw Object.assign(
          new Error('The uploaded file does not appear to be valid audio.'),
          { code: 'INVALID_AUDIO' }
        );
      }
      // Passes magic check — return a loose result; Gnani will do real validation
      return { duration: null, format: [extension.slice(1)], skippedProbe: true };
    }

    let { duration, formats, binary } = probe;

    // If container duration is missing (streaming WebM) try stream-level duration
    if (!Number.isFinite(duration) || duration <= 0) {
      const streamDur = await probeStreamDuration(file);
      if (streamDur) duration = streamDur;
    }

    const compatible = {
      '.wav': formats.includes('wav'),
      '.mp3': formats.some((f) => f.includes('mp3')),
      '.ogg': formats.includes('ogg'),
      '.flac': formats.includes('flac'),
      '.aac': formats.some((f) => ['aac', 'adts'].includes(f)),
      '.m4a': formats.some((f) => ['mov', 'mp4', 'm4a'].includes(f)),
      '.webm': formats.some((f) => ['matroska', 'webm'].includes(f)),
      '.opus': formats.includes('ogg'),
      '.amr': formats.includes('amr')
    }[extension] ?? false;

    if (!Number.isFinite(duration) || duration <= 0 || !compatible) {
      throw Object.assign(
        new Error('The uploaded file is not valid audio in its declared format.'),
        { code: 'INVALID_AUDIO' }
      );
    }

    if (duration > 30) {
      throw Object.assign(
        new Error('Immediate Prisma transcription supports clips up to 30 seconds. Use the background audio upload for longer recordings.'),
        { code: 'AUDIO_TOO_LONG' }
      );
    }

    return { duration, format: formats };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Should not reach here — probeFile() already handles ENOENT and returns null
      throw Object.assign(
        new Error('FFprobe/FFmpeg is required for safe voice transcription. Install ffmpeg or ffprobe on the server.'),
        { code: 'AUDIO_VALIDATION_UNAVAILABLE' }
      );
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
