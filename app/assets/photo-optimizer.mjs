// Browser-only photo preparation. No authentication, Storage or UI dependency.
export const MAX_SOURCE_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024;
export const TARGET_UPLOAD_FILE_BYTES = 500 * 1024;
export const MAX_IMAGE_EDGE = 1600;
export const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'
});
const prepared = new WeakMap();
let queue = Promise.resolve();
const fail = message => Object.assign(new Error(message + ' 원본은 업로드하지 않았습니다. 다시 시도하거나 다른 사진을 선택해 주세요.'), { code: 'PHOTO_OPTIMIZATION_FAILED' });

export function validateFile(file) {
  if (!file?.size) throw fail('사진이 비어 있습니다.');
  if (!MIME_EXTENSIONS[file.type]) throw fail('JPG·PNG·WebP·GIF만 지원합니다. HEIC 사진은 JPG로 변환해 주세요.');
  if (file.size > MAX_SOURCE_FILE_BYTES) throw fail('원본 사진은 15MB 이하로 선택해 주세요.');
}

// Read bounded compressed bytes before decoding: reject huge pixel allocations.
// The browser remains responsible for decoding and EXIF orientation.
function dimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (type === 'image/png' && bytes.length >= 33 && text(1, 3) === 'PNG' && view.getUint32(0) === 0x89504e47 && text(12, 4) === 'IHDR') {
    let animated = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (text(offset + 4, 4) === 'acTL') animated = true;
      offset += size + 12;
    }
    return [view.getUint32(16), view.getUint32(20), animated];
  }
  if (type === 'image/gif' && bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) {
    return [view.getUint16(6, true), view.getUint16(8, true), true];
  }
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && size >= 7) {
        return [view.getUint16(offset + 5), view.getUint16(offset + 3), false];
      }
      offset += size;
    }
  }
  if (type === 'image/webp' && bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const uint24 = offset => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    if (text(12, 4) === 'VP8X') return [uint24(24) + 1, uint24(27) + 1, !!(bytes[20] & 2)];
    if (text(12, 4) === 'VP8 ' && text(23, 3) === '\u009d\u0001\u002a') return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383, false];
    if (text(12, 4) === 'VP8L' && bytes[20] === 47) return [1 + ((bytes[21] | bytes[22] << 8) & 16383), 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 16383), false];
  }
  throw fail('사진 형식과 내용이 맞지 않거나 파일이 손상되었습니다.');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(fail('사진을 읽지 못했습니다.')); };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(fail('사진 압축에 실패했습니다.')), type, quality);
  });
}

async function prepare(file) {
  validateFile(file);
  const [rawWidth, rawHeight, animated] = dimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!rawWidth || !rawHeight || Math.max(rawWidth, rawHeight) > 12000 || rawWidth * rawHeight > 40_000_000) {
    throw fail('사진 해상도가 너무 큽니다. 4천만 화소·긴 변 12000px 이하 사진을 선택해 주세요.');
  }
  if (animated && (Math.max(rawWidth, rawHeight) > MAX_IMAGE_EDGE || file.size > MAX_UPLOAD_FILE_BYTES)) {
    throw fail('움직이는 사진은 변환하지 않습니다. GIF·움직이는 PNG/WebP는 1600px·1MB 이하로 선택해 주세요.');
  }
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw fail('사진 크기를 읽지 못했습니다.');
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  if (animated || scale === 1 && file.size <= TARGET_UPLOAD_FILE_BYTES) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  try {
    // PNG/WebP keep alpha. Never flatten onto a white background.
    const context = canvas.getContext('2d');
    if (!context) throw fail('브라우저에서 사진 압축을 지원하지 않습니다.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let best;
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    for (const quality of [0.86, 0.78, 0.70]) {
      const blob = await canvasBlob(canvas, type, quality);
      if (!['image/jpeg', 'image/webp', 'image/png'].includes(blob.type)) throw fail('브라우저의 압축 형식을 확인할 수 없습니다.');
      if (!best || blob.size < best.size) best = blob;
      if (best.size <= TARGET_UPLOAD_FILE_BYTES || blob.type === 'image/png') break;
    }
    if (scale === 1 && file.size <= MAX_UPLOAD_FILE_BYTES && best.size >= file.size) return file;
    if (best.size > MAX_UPLOAD_FILE_BYTES || best.size >= file.size) throw fail('화질을 유지하면서 1MB 이하로 줄이지 못했습니다.');
    // Verify the actual encoder output, including browsers falling back to PNG.
    dimensions(new Uint8Array(await best.arrayBuffer()), best.type);
    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    return new File([best], `${base}.${MIME_EXTENSIONS[best.type]}`, { type: best.type, lastModified: file.lastModified });
  } finally {
    canvas.width = canvas.height = 0;
    image.src = '';
  }
}

export function optimizeForUpload(file) {
  // Same selected File shares work on retry; rejected preparation can be retried.
  if (!file || typeof file !== 'object') return Promise.reject(fail('사진을 선택해 주세요.'));
  if (!prepared.has(file)) {
    const task = queue.then(() => prepare(file)).catch(error => { prepared.delete(file); throw error; });
    queue = task.catch(() => {});
    prepared.set(file, task);
  }
  return prepared.get(file);
}
