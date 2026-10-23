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
// Set this to your deployed backend HTTPS URL after deploying /backend.
// GitHub Pages cannot run media extraction or FFmpeg itself.
const API_BASE = (window.DOWNLOADFROMURL_API || '').replace(/\\/$/, '');
const PLATFORM_HOSTS = /(^|\\.)(youtube\\.com|youtu\\.be|tiktok\\.com|instagram\\.com|facebook\\.com|fb\\.watch|twitter\\.com|x\\.com|vimeo\\.com|dailymotion\\.com|twitch\\.tv)$/i;
function isPlatformPage(url) {
  return PLATFORM_HOSTS.test(url.hostname);
}
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

  // A social/streaming page URL is not a direct file URL. Never mislabel it as a downloadable file.
  if (isPlatformPage(parsed.hostname ? parsed : new URL(parsed.href))) {
    if (!API_BASE) {
      result.hidden = true;
      showMessage('This is a social-media or streaming page, not a direct file link. The media backend is not connected yet. Deploy the backend in the repository’s backend/ folder, then set window.DOWNLOADFROMURL_API to its HTTPS URL. This page cannot extract the media by itself.', 'error');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const originalButtonText = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Processing media…';
    showMessage('Contacting the media service. Public URLs only; private or DRM-protected media is not supported.', '');
    requestController = new AbortController();
    const apiTimeout = setTimeout(() => requestController?.abort(), 180000);
    try {
      const response = await fetch(API_BASE + '/api/download', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: parsed.href, format: 'mp4', quality: 'best', filename: customName || undefined}),
        signal: requestController.signal
      });
      if (!response.ok) {
        let detail = 'The media service could not process this URL.';
        try { const payload = await response.json(); detail = payload.detail || detail; } catch {}
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The media service returned an empty file.');
      activeObjectUrl = URL.createObjectURL(blob);
      setResult(finalName, 'Media', activeObjectUrl, finalName, true);
      showMessage('Media is ready to save.', 'success');
    } catch (error) {
      showMessage(error.name === 'AbortError' ? 'Media processing timed out. Try a shorter or supported public URL.' : error.message, 'error');
    } finally {
      clearTimeout(apiTimeout);
      requestController = null;
      button.disabled = false;
      button.innerHTML = originalButtonText;
    }
    return;
  }

  // Direct-file URL flow; the browser may still be blocked by CORS or source permissions.
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
