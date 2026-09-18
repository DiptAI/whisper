import { db } from '../db.js';

export async function storeBlob(bytes: Buffer, mime: string): Promise<number> {
  const [row] = await db('blobs')
    .insert({ bytes, mime, size_bytes: bytes.length })
    .returning<{ id: number }[]>('id');
  return row.id;
}

export async function getBlob(id: number): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await db('blobs').select('bytes', 'mime').where({ id }).first<{ bytes: Buffer; mime: string }>();
  return row ?? null;
}
