import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const allowedDocuments = new Set(['application/pdf']);
const acceptedTypes = new Set([...allowedTypes, ...allowedDocuments]);
const configured = () => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
const sign = (params) => {
  const payload = Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
  return crypto.createHash('sha1').update(`${payload}${env.CLOUDINARY_API_SECRET}`).digest('hex');
};

export function validateFile(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || !acceptedTypes.has(mimeType)) return false;
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

export const validateImage = validateFile;

export async function uploadFile(bytes, mimeType, userId, name = 'File') {
  if (!configured()) throw Object.assign(new Error('File upload is not configured. Add Cloudinary credentials on the server.'), { code: 'IMAGE_UPLOAD_UNAVAILABLE', status: 503 });
  const resourceType = allowedDocuments.has(mimeType) ? 'raw' : 'image';
  const timestamp = Math.floor(Date.now() / 1000);
  const fileId = crypto.randomUUID();
  const publicId = `minimi/${userId}/${fileId}${resourceType === 'raw' ? '.pdf' : ''}`;
  const params = { folder: `minimi/${userId}`, public_id: publicId.split('/').at(-1), timestamp, overwrite: 'false' };
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), name);
  for (const [key, value] of Object.entries(params)) form.append(key, String(value));
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('signature', sign(params));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/${resourceType}/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error('Cloudinary could not store this file. Please retry.');
    error.status = response.status === 429 ? 503 : 502;
    error.code = 'IMAGE_UPLOAD_FAILED';
    throw error;
  }
  const result = await response.json();
  return { publicId: result.public_id, secureUrl: result.secure_url, mimeType, resourceType, format: result.format, bytes: result.bytes, width: result.width, height: result.height, name };
}

export const uploadImage = uploadFile;

export function isOwnedCloudinaryFile(image, userId) {
  const resourceType = image?.resourceType || 'image';
  const isDocument = resourceType === 'raw' && image?.mimeType === 'application/pdf' && image?.format === 'pdf';
  if (!image || typeof image.publicId !== 'string' || !image.publicId.startsWith(`minimi/${userId}/`) || !(isDocument || (resourceType === 'image' && allowedTypes.has(image.mimeType)))) return false;
  try {
    const url = new URL(image.secureUrl);
    const suffix = resourceType === 'raw' ? image.publicId : `${image.publicId}.${image.format}`;
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' &&
      url.pathname.startsWith(`/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/`) &&
      url.pathname.endsWith(`/${suffix}`);
  } catch { return false; }
}

export const isOwnedCloudinaryImage = isOwnedCloudinaryFile;

export async function loadCloudinaryFile(image, userId, signal) {
  if (!isOwnedCloudinaryFile(image, userId)) throw Object.assign(new Error('The attached file is not available to this account.'), { code: 'INVALID_IMAGE_ATTACHMENT' });
  const response = await fetch(image.secureUrl, { signal, redirect: 'error' });
  if (!response.ok) throw Object.assign(new Error('Could not retrieve the uploaded file for analysis.'), { code: 'IMAGE_RETRIEVAL_FAILED' });
  const declared = Number(response.headers.get('content-length'));
  const maxBytes = (image.mimeType === 'application/pdf' ? env.MAX_PDF_SIZE_MB : env.MAX_IMAGE_SIZE_MB) * 1024 * 1024;
  if (declared > maxBytes) throw Object.assign(new Error('Attached file exceeds the analysis size limit.'), { code: 'IMAGE_TOO_LARGE' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes || !validateFile(bytes, image.mimeType)) throw Object.assign(new Error('The uploaded file is invalid or too large.'), { code: 'INVALID_IMAGE_ATTACHMENT' });
  return { mimeType: image.mimeType, data: bytes.toString('base64') };
}

export const loadCloudinaryImage = loadCloudinaryFile;
