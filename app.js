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

function getKind(url) {
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

urlInput.addEventListener('input', () => {
  clearButton.hidden = !urlInput.value;
  result.hidden = true;
  message.hidden = true;
});

clearButton.addEventListener('click', () => {
  urlInput.value = '';
  filenameInput.value = '';
  clearButton.hidden = true;
  result.hidden = true;
  message.hidden = true;
  urlInput.focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  result.hidden = true;
  message.hidden = true;

  const rawUrl = urlInput.value.trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    showMessage('Enter a complete, valid URL beginning with https:// or http://.', 'error');
    urlInput.focus();
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    showMessage('For safety, only HTTP and HTTPS links are supported.', 'error');
    return;
  }
  if (!parsed.hostname || parsed.hostname.includes(' ')) {
    showMessage('That URL does not look valid. Check it and try again.', 'error');
    return;
  }

  const originalName = suggestedName(parsed.href);
  const customName = filenameInput.value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const finalName = customName || originalName;

  downloadLink.href = parsed.href;
  downloadLink.download = finalName;
  downloadLink.textContent = `Open / download ${finalName} ↗`;
  resultName.textContent = finalName;
  resultMeta.textContent = `${getKind(parsed.href)} · Direct link`;
  result.hidden = false;
  showMessage('Link looks valid. Use the button below to open or download it; the source server decides whether direct access is allowed.', 'success');
});
