import express from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const preferencesRouter = express.Router();

const PREFS_FILE = path.resolve(process.cwd(), 'user-preferences.json');
let cache = new Map();

try {
  if (fs.existsSync(PREFS_FILE)) {
    const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = new Map(Object.entries(parsed));
  }
} catch {
  cache = new Map();
}

function saveCache() {
  try {
    const obj = Object.fromEntries(cache);
    fs.writeFileSync(PREFS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {}
}

const DEFAULT_PREFERENCES = {
  interactionMode: 'voice',
  voiceEnabled: true,
  textEnabled: true,
  voice: 'Shivani',
  language: 'indic-auto',
  autoPlay: true
};

preferencesRouter.get('/interaction-mode', (req, res) => {
  const userId = req.user?.id || 'anonymous';
  const userPref = cache.get(userId) || {};
  res.json({
    success: true,
    data: {
      ...DEFAULT_PREFERENCES,
      ...userPref,
      interactionMode: userPref.interactionMode === 'text' ? 'text' : 'voice'
    },
    error: null
  });
});

preferencesRouter.patch('/interaction-mode', (req, res) => {
  const schema = z.object({
    interactionMode: z.enum(['voice', 'text']).optional(),
    voice: z.string().max(50).optional(),
    language: z.string().max(50).optional(),
    autoPlay: z.boolean().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_PREFERENCE', message: 'Invalid preference values provided.' }
    });
  }

  const userId = req.user?.id || 'anonymous';
  const existing = cache.get(userId) || {};
  const updated = {
    ...DEFAULT_PREFERENCES,
    ...existing,
    ...parsed.data
  };

  cache.set(userId, updated);
  saveCache();

  res.json({
    success: true,
    data: updated,
    error: null
  });
});
