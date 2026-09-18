import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGES } from '../config.js';
import { HttpError } from '../types.js';
import { requireParticipant, wrap } from '../middleware.js';

/**
 * Proxies Google Input Tools transliteration (Latin keyboard -> selected
 * script). Free, no key. Only the word being typed is sent.
 */
export const transliterateRouter = Router();

transliterateRouter.post(
  '/',
  requireParticipant,
  wrap(async (req, res) => {
    const body = z.object({ text: z.string().min(1).max(64), language: z.string() }).parse(req.body);
    const lang = LANGUAGES.find((l) => l.code === body.language);
    if (!lang?.itc) throw new HttpError(400, 'No transliteration for this language', 'NO_ITC');
    const url = new URL('https://inputtools.google.com/request');
    url.searchParams.set('text', body.text);
    url.searchParams.set('itc', lang.itc);
    url.searchParams.set('num', '5');
    url.searchParams.set('cp', '0');
    url.searchParams.set('cs', '1');
    url.searchParams.set('ie', 'utf-8');
    url.searchParams.set('oe', 'utf-8');
    const r = await fetch(url);
    if (!r.ok) throw new HttpError(502, 'Transliteration service unavailable', 'ITC_DOWN');
    const json = (await r.json()) as unknown;
    // shape: ["SUCCESS", [[input, [cand1, cand2, ...], ...]]]
    const candidates =
      Array.isArray(json) && json[0] === 'SUCCESS' && Array.isArray(json[1]) && Array.isArray(json[1][0])
        ? (json[1][0][1] as string[])
        : [];
    res.json({ candidates });
  }),
);
