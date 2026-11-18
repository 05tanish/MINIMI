import { describe, expect, it } from 'vitest';
import { normalizeTtsSpeed } from '../../client/src/components/voice/VoiceSettings.jsx';

describe('Timbre v3.0 speed settings', () => {
  it('keeps provider-supported speeds', () => {
    expect([0.8, 1, 1.2].map(normalizeTtsSpeed)).toEqual([0.8, 1, 1.2]);
  });

  it('maps legacy in-range saved speeds to the nearest supported speed', () => {
    expect([0.85, 0.95, 1.05, 1.15].map(normalizeTtsSpeed)).toEqual([0.8, 1, 1, 1.2]);
  });
});
