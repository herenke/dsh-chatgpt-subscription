import { LlmError, requiredImageOffload, offloadedImageText, requestImageHandleText } from '@deepseek-ai/dsh-llm';

export const IMAGE_LIMITS = Object.freeze({ maxImageBytes: 8 * 1024 * 1024, maxRequestBytes: 20 * 1024 * 1024, maxImages: 16, maxDimension: 4096 });
const types = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export function imageTarget(ref) {
  const scale = Math.min(1, IMAGE_LIMITS.maxDimension / Math.max(ref.width, ref.height));
  return { width: Math.max(1, Math.floor(ref.width * scale)), height: Math.max(1, Math.floor(ref.height * scale)), maxBytes: IMAGE_LIMITS.maxImageBytes };
}
function validateRef(ref) {
  if (!ref || !/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId) || !types.has(ref.mediaType) || ![ref.bytes, ref.width, ref.height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid DSH image attachment reference. Attach the image through DSH.');
}
function validSignature(data, type) {
  const b = Buffer.from(data);
  return type === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : type === 'image/webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
    : ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6));
}
export async function prepareImages(options, attachments) {
  const versions = new Map(), refs = new Map();
  for (const message of options.messages) {
    const content = typeof message.content === 'string' ? [] : message.content;
    for (const block of content ?? []) {
      if (block.type !== 'image') continue;
      validateRef(block.attachment);
      if (!['user', 'tool'].includes(message.role)) throw new Error('Images are supported only in user messages and function tool results.');
      if (block.offloaded === true) continue;
      const ref = block.attachment, prior = refs.get(ref.attachmentId);
      if (prior && ['mediaType','width','height','bytes'].some(k => prior[k] !== ref[k])) throw new Error('Conflicting image attachment references.');
      refs.set(ref.attachmentId, ref);
    }
  }
  if (!refs.size) return versions;
  if (!attachments?.readImageRequest) throw new Error('DSH attachment service is required for image input. Enable the host attachment provider.');
  // Bound work before decoding; the host can offload oldest image occurrences.
  if (refs.size > IMAGE_LIMITS.maxImages) throw new LlmError('Too many images; offload older attachments.', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages: refs.size - IMAGE_LIMITS.maxImages });
  for (const ref of refs.values()) {
    options.signal?.throwIfAborted();
    const target = imageTarget(ref);
    let version;
    try { version = await attachments.readImageRequest(ref, target, options.signal); }
    catch { throw new Error(options.signal?.aborted ? 'Image preparation cancelled.' : 'DSH could not load or normalize this image attachment.'); }
    options.signal?.throwIfAborted();
    if (!version || !(version.data instanceof Uint8Array) || version.data.length !== version.bytes || version.bytes <= 0 || !types.has(version.mediaType) || version.attachment?.attachmentId !== ref.attachmentId || ![version.width,version.height].every(n => Number.isSafeInteger(n) && n > 0) || version.width > target.width || version.height > target.height || version.depth !== 'uchar' || version.space !== 'srgb' || !validSignature(version.data, version.mediaType)) throw new Error('DSH returned an invalid normalized image.');
    if (version.bytes > IMAGE_LIMITS.maxImageBytes) throw new LlmError('Image exceeds the encoded-byte limit; reduce its size.', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages: 1 });
    versions.set(ref.attachmentId, version);
  }
  const offload = requiredImageOffload(options.messages, { representation: 'base64', maxBytes: IMAGE_LIMITS.maxRequestBytes, maxImages: IMAGE_LIMITS.maxImages }, block => versions.get(block.attachment.attachmentId).bytes);
  if (offload) throw new LlmError('Images exceed the request budget; offload oldest attachments.', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages: offload });
  return versions;
}
export function imageContent(block, versions) {
  if (block.offloaded === true) return [{ type: 'input_text', text: offloadedImageText(block.attachment) }];
  const version = versions.get(block.attachment?.attachmentId);
  if (!version) throw new Error('Image was not prepared through the DSH attachment service.');
  return [
    { type: 'input_text', text: requestImageHandleText(block.attachment, version) },
    { type: 'input_image', image_url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`, detail: 'auto' },
  ];
}
