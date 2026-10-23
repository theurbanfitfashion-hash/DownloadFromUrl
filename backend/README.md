# DownloadFromUrl API

FastAPI backend for public media URL inspection, downloading, audio extraction/conversion, format selection, clip trimming, and subtitle sidecars. Uses yt-dlp and FFmpeg.

## Run locally
Requires Python 3.12+ and FFmpeg installed.

```bash
cd backend
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check: `GET /api/health`; interactive API docs: `/docs`.

## Deploy with Docker
Deploy this folder as a Docker web service on a host that permits FFmpeg and yt-dlp. Set the service's start command to the Dockerfile default. Configure:
- `CORS_ORIGINS=https://theurbanfitfashion-hash.github.io`
- `MAX_FILE_MB=500` (choose a limit your host can support)
- `MAX_MEDIA_DURATION_SECONDS=1800`
- `JOB_TTL_SECONDS=1800`

After deployment, set `window.DOWNLOADFROMURL_API` in the frontend to the service's HTTPS base URL (no trailing slash). GitHub Pages serves only static files; it cannot run this backend itself.

## Endpoints
- `POST /api/info` JSON: `{"url":"https://..." }`
- `POST /api/download` JSON fields: `url`, `format` (`mp4|mp3|m4a|aac|wav|ogg|webm|original`), `quality` (`best|1080|720|480|360|audio`), optional `start`, `end`, `subtitles`, `subtitle_language`, and `filename`.

The download response streams a file back to the browser. Subtitle files, when requested, are produced as sidecars by yt-dlp; this initial endpoint returns the media file, not a subtitle ZIP. Merge/cut are implemented through yt-dlp's stream merging and download-range support. Full arbitrary-file merging and subtitle-only download need separate endpoints/UI.

## Security and operating notes
- Accepts only public HTTP/HTTPS addresses and rejects private/local IP targets to reduce SSRF risk.
- Does not support login cookies, private media, DRM bypass, or access-control circumvention.
- Use only for content you own or are authorized to download. Platform support and availability vary; providers may change.
- Public hosting can incur bandwidth/CPU costs. Use a host with resource limits and monitor it. Add rate limiting/authentication before exposing to high traffic.
