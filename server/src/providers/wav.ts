/** Minimal WAV helpers: wrap raw PCM (s16le) in a RIFF header, and read duration. */

export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Duration of a PCM WAV in ms, or null if the buffer is not a parseable WAV. */
export function wavDurationMs(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data') {
      if (!byteRate) return null;
      const dataLen = Math.min(size, buf.length - offset - 8);
      return Math.round((dataLen / byteRate) * 1000);
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Parse "audio/L16;codec=pcm;rate=24000" style mime types. */
export function pcmRateFromMime(mime: string, fallback = 24000): number {
  const m = /rate=(\d+)/.exec(mime);
  return m ? Number(m[1]) : fallback;
}
