import asyncio
import ipaddress
import os
import re
import shutil
import socket
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

APP_NAME = "DownloadFromUrl API"
MAX_DURATION = int(os.getenv("MAX_MEDIA_DURATION_SECONDS", "1800"))
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "500"))
JOB_TTL = int(os.getenv("JOB_TTL_SECONDS", "1800"))
ROOT = Path(os.getenv("MEDIA_TEMP_DIR", "/tmp/downloadfromurl"))
ROOT.mkdir(parents=True, exist_ok=True)
app = FastAPI(title=APP_NAME, version="1.0.0")

origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

class MediaRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    format: str = Field(default="mp4", pattern="^(mp4|mp3|m4a|aac|wav|ogg|webm|original)$")
    quality: str = Field(default="best", pattern="^(best|1080|720|480|360|audio)$")
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    subtitles: bool = False
    subtitle_language: str = Field(default="en", max_length=12)
    filename: str | None = Field(default=None, max_length=180)

class InfoRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)

def validate_public_url(raw: str) -> str:
    try:
        p = urlparse(raw)
        if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
            raise ValueError()
        host = p.hostname.rstrip(".").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError()
        # Reject IP literals that are not globally routable; resolve hostnames to reduce SSRF risk.
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            try:
                addresses = [ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, None)]
            except (socket.gaierror, ValueError):
                raise ValueError()
        if not addresses or any(not addr.is_global for addr in addresses):
            raise ValueError()
        return raw
    except Exception:
        raise HTTPException(status_code=400, detail="Enter a valid public HTTP/HTTPS media URL. Private/local addresses are not allowed.")

def clean_name(value: str | None, fallback: str) -> str:
    name = Path(value or fallback).name
    name = re.sub(r'[^A-Za-z0-9._ -]', '_', name).strip(" .")
    return (name or "download")[:160]

def cleanup_old_jobs():
    now = time.time()
    for item in ROOT.iterdir():
        try:
            if item.is_dir() and now - item.stat().st_mtime > JOB_TTL:
                shutil.rmtree(item, ignore_errors=True)
        except OSError:
            pass

def ydl_base(outtmpl: str, quiet=True):
    return {
        "outtmpl": outtmpl, "quiet": quiet, "no_warnings": True,
        "noplaylist": True, "restrictfilenames": True,
        "max_filesize": MAX_FILE_MB * 1024 * 1024,
        "socket_timeout": 20, "retries": 2, "fragment_retries": 2,
        "extractor_retries": 1, "ignoreerrors": False,
    }

@app.get("/api/health")
def health():
    return {"ok": True, "service": APP_NAME, "max_file_mb": MAX_FILE_MB, "max_duration_seconds": MAX_DURATION}

@app.post("/api/info")
async def info(req: InfoRequest):
    url = validate_public_url(req.url)
    cleanup_old_jobs()
    def extract():
        opts = ydl_base(str(ROOT / "info-%(id)s.%(ext)s"))
        opts.update({"skip_download": True, "extract_flat": False})
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url, download=False)
            if data.get("duration") and data["duration"] > MAX_DURATION:
                raise HTTPException(status_code=413, detail=f"Media is longer than the {MAX_DURATION // 60}-minute limit.")
            return {
                "title": data.get("title") or "Media file",
                "duration": data.get("duration"),
                "thumbnail": data.get("thumbnail"),
                "extractor": data.get("extractor_key"),
                "formats": ["mp4", "mp3", "m4a", "wav", "ogg", "webm", "original"],
                "subtitles_available": bool(data.get("subtitles") or data.get("automatic_captions")),
            }
    try:
        return await asyncio.to_thread(extract)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not read this media URL. It may be unsupported, private, removed, or blocked by its host.") from exc

@app.post("/api/download")
async def download(req: MediaRequest):
    url = validate_public_url(req.url)
    if req.end is not None and req.start is None:
        raise HTTPException(status_code=400, detail="Set a start time when using an end time.")
    if req.start is not None and req.end is not None and req.end <= req.start:
        raise HTTPException(status_code=400, detail="End time must be later than start time.")
    if req.end is not None and req.end - (req.start or 0) > MAX_DURATION:
        raise HTTPException(status_code=413, detail="Requested clip exceeds the configured duration limit.")
    cleanup_old_jobs()
    job = ROOT / f"job-{os.urandom(12).hex()}"
    job.mkdir(mode=0o700)
    output_template = str(job / "media.%(ext)s")
    opts = ydl_base(output_template)
    fmt = req.format
    if fmt == "mp4":
        height = {"1080": 1080, "720": 720, "480": 480, "360": 360}.get(req.quality)
        opts["format"] = (f"bestvideo[height<={height}]+bestaudio/best[height<={height}]" if height else "bv*+ba/best")
        opts["merge_output_format"] = "mp4"
        opts["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
    elif fmt in ("mp3", "m4a", "aac", "wav", "ogg"):
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": fmt, "preferredquality": "192"}]
    elif fmt == "webm":
        opts["format"] = "bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best"
        opts["merge_output_format"] = "webm"
    else:
        opts["format"] = "best"
    if req.subtitles:
        opts.update({"writesubtitles": True, "writeautomaticsub": True, "subtitleslangs": [req.subtitle_language, "en"], "subtitlesformat": "srt/best"})
    if req.start is not None:
        opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(req.start, req.end)])
        opts["force_keyframes_at_cuts"] = True
    try:
        def run_download():
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                return info
        data = await asyncio.to_thread(run_download)
        files = [p for p in job.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
        if not files:
            raise RuntimeError("No output file was produced.")
        # Prefer final media, not subtitle sidecars.
        media = [p for p in files if p.suffix.lower() not in {".srt", ".vtt", ".ass", ".lrc"}]
        if not media:
            media = files
        selected = max(media, key=lambda p: p.stat().st_size)
        if selected.stat().st_size > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"Output exceeds the {MAX_FILE_MB} MB limit.")
        fallback = data.get("title") or selected.stem
        name = clean_name(req.filename, fallback)
        if "." not in name:
            name += selected.suffix
        return FileResponse(selected, filename=name, media_type="application/octet-stream", background=None)
    except HTTPException:
        shutil.rmtree(job, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(job, ignore_errors=True)
        raise HTTPException(status_code=422, detail="Download or conversion failed. The link may be unsupported, unavailable, protected, or require sign-in. DRM and access controls are not bypassed.") from exc
