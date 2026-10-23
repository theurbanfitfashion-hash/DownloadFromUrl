'use strict';

const form = document.querySelector('#download-form');
const urlInput = document.querySelector('#media-url');
const filenameInput = document.querySelector('#filename');
const clearButton = document.querySelector('#clear-btn');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const resultName = document.querySelector('#result-name');
const resultMeta = document.querySelector('#result-meta');
const downloadLink = document.querySelector('#download-link');

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
let activeObjectUrl = null;
let requestController = null;

const knownTypes = {
  audio: /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|aiff|wma)(?:$|[?#])/i,
  image: /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i,
  video: /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|3gp|ogv|ts)(?:$|[?#])/i
};

function showMessage(text, type = '') {
  message.textContent = text;
  message.className = `message ${type}`.trim();
  message.hidden = false;
}

function clearObjectUrl() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

function getKind(url, contentType = '') {
  if (contentType.startsWith('audio/')) return 'Audio';
  if (contentType.startsWith('image/')) return 'Image';
  if (contentType.startsWith('video/')) return 'Video';
  if (contentType.includes('pdf')) return 'PDF';
  for (const [kind, pattern] of Object.entries(knownTypes)) {
    if (pattern.test(url)) return kind[0].toUpperCase() + kind.slice(1);
  }
  return 'File';
}

function suggestedName(url) {
  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split('/').filter(Boolean).pop();
    return lastPart ? decodeURIComponent(lastPart) : 'download';
  } catch {
    return 'download';
  }
}

function safeFilename(value) {
  return value.trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
}

function setResult(name, kind, href, downloadName, isBlob) {
  resultName.textContent = name;
  resultMeta.textContent = `${kind} · ${isBlob ? 'Ready to save' : 'Direct link'}`;
  downloadLink.href = href;
  downloadLink.download = downloadName;
  downloadLink.target = isBlob ? '_self' : '_blank';
  downloadLink.textContent = isBlob
    ? `Download ${downloadName} ↓`
    : `Open / download ${downloadName} ↗`;
  result.hidden = false;
}

urlInput.addEventListener('input', () => {
  clearButton.hidden = !urlInput.value;
  result.hidden = true;
  message.hidden = true;
  clearObjectUrl();
  if (requestController) requestController.abort();
});

clearButton.addEventListener('click', () => {
  if (requestController) requestController.abort();
  clearObjectUrl();
  urlInput.value = '';
  filenameInput.value = '';
  clearButton.hidden = true;
  result.hidden = true;
  message.hidden = true;
  urlInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.hidden = true;
  message.hidden = true;
  clearObjectUrl();

  if (requestController) requestController.abort();

  let parsed;
  try {
    parsed = new URL(urlInput.value.trim());
  } catch {
    showMessage('Enter a complete, valid URL beginning with https:// or http://.', 'error');
    urlInput.focus();
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.hostname.includes(' ')) {
    showMessage('Enter a valid HTTP or HTTPS file URL.', 'error');
    return;
  }

  const customName = safeFilename(filenameInput.value);
  const originalName = safeFilename(suggestedName(parsed.href)) || 'download';
  const finalName = customName || originalName;

  // Always prepare a direct-link fallback in case the source blocks browser fetches.
  setResult(finalName, getKind(parsed.href), parsed.href, finalName, false);
  showMessage('Checking whether this server allows a direct download…', '');

  requestController = new AbortController();
  const timeoutId = setTimeout(() => requestController?.abort(), 30000);

  try {
    const response = await fetch(parsed.href, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      signal: requestController.signal
    });

    if (!response.ok) {
      throw new Error(`The source server returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('This file is larger than the 100 MB browser-download limit.');
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      throw new Error('That link returned a webpage, not a direct file. Copy the direct media/file URL instead.');
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error('The server returned an empty file.');
    }
    if (blob.size > MAX_DOWNLOAD_BYTES) {
      throw new Error('This file is larger than the 100 MB browser-download limit.');
    }

    activeObjectUrl = URL.createObjectURL(blob);
    setResult(finalName, getKind(parsed.href, contentType || blob.type), activeObjectUrl, finalName, true);
    showMessage('File is ready. Tap Download to save it to your device.', 'success');
  } catch (error) {
    // A browser-only site cannot read cross-origin responses unless the host allows CORS.
    setResult(finalName, getKind(parsed.href), parsed.href, finalName, false);

    if (error.name === 'AbortError') {
      showMessage('The request timed out or was cancelled. You can still try the direct link below.', 'error');
    } else if (error instanceof TypeError) {
      showMessage('The source may block browser access (CORS), require sign-in, or not be a direct file link. Try the direct link below. This page cannot bypass those restrictions.', 'error');
    } else {
      showMessage(`${error.message} You can still try opening the direct link below.`, 'error');
    }
  } finally {
    clearTimeout(timeoutId);
    requestController = null;
  }
});
