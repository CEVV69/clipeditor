import os
import re
import shutil
import tempfile
import uuid
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.concurrency import run_in_threadpool
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import yt_dlp

MAX_DURATION_SECONDS = 20 * 60

ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
}

ALLOWED_ORIGINS = [
    "https://cevv69.github.io",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
]

limiter = Limiter(key_func=get_remote_address)

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length"],
)


def validate_youtube_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="URL inválida")
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS or parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="Por ahora solo se aceptan links de youtube.com o youtu.be",
        )
    return url


YDL_EXTRACTOR_ARGS = {}

COOKIES_FILE_PATH = "/tmp/yt_cookies.txt"


def _write_cookies_file() -> str | None:
    raw = os.environ.get("YT_COOKIES")
    if not raw:
        return None
    with open(COOKIES_FILE_PATH, "w") as f:
        f.write(raw)
    return COOKIES_FILE_PATH


COOKIES_FILE = _write_cookies_file()


def base_ydl_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extractor_args": YDL_EXTRACTOR_ARGS,
    }
    if COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    return opts


def extract_info_sync(url: str) -> dict:
    with yt_dlp.YoutubeDL(base_ydl_opts()) as ydl:
        return ydl.extract_info(url, download=False)


def safe_filename(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", title or "video").strip()
    return cleaned[:80] or "video"


@app.get("/")
async def health():
    return {"status": "ok"}


@app.get("/info")
@limiter.limit("20/minute")
async def info(request: Request, url: str):
    validate_youtube_url(url)
    try:
        data = await run_in_threadpool(extract_info_sync, url)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(status_code=422, detail=f"No se pudo leer ese video: {e}")

    duration = data.get("duration") or 0
    return JSONResponse(
        {
            "title": data.get("title"),
            "duration": duration,
            "thumbnail": data.get("thumbnail"),
            "exceedsMaxDuration": duration > MAX_DURATION_SECONDS,
            "maxDurationSeconds": MAX_DURATION_SECONDS,
        }
    )


def download_sync(url: str, workdir: str) -> str:
    out_template = os.path.join(workdir, "%(id)s.%(ext)s")
    opts = {
        **base_ydl_opts(),
        "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "outtmpl": out_template,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info_data = ydl.extract_info(url, download=True)
        return ydl.prepare_filename(info_data)


@app.get("/extract")
@limiter.limit("6/minute")
async def extract(request: Request, url: str, background_tasks: BackgroundTasks):
    validate_youtube_url(url)

    try:
        preflight = await run_in_threadpool(extract_info_sync, url)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(status_code=422, detail=f"No se pudo leer ese video: {e}")

    duration = preflight.get("duration") or 0
    if duration > MAX_DURATION_SECONDS:
        raise HTTPException(
            status_code=413,
            detail=f"El video dura más de {MAX_DURATION_SECONDS // 60} minutos, no se puede importar",
        )

    workdir = os.path.join(tempfile.gettempdir(), f"clipeditor-{uuid.uuid4().hex}")
    os.makedirs(workdir, exist_ok=True)

    try:
        filepath = await run_in_threadpool(download_sync, url, workdir)
    except yt_dlp.utils.DownloadError as e:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"No se pudo descargar ese video: {e}")
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Error inesperado al procesar el video")

    if not os.path.isfile(filepath):
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="El video no se generó correctamente")

    filename = safe_filename(preflight.get("title")) + ".mp4"
    filesize = os.path.getsize(filepath)

    def cleanup():
        shutil.rmtree(workdir, ignore_errors=True)

    background_tasks.add_task(cleanup)

    def iterfile():
        with open(filepath, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(filesize),
        },
        background=background_tasks,
    )
