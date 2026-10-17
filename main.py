"""Desktop entry point and the Eel/Bottle transport boundary."""
import gevent.monkey
gevent.monkey.patch_all()

import logging
import os
import tempfile
from pathlib import Path

import bottle
import eel
from dotenv import load_dotenv
from gevent.lock import Semaphore

from backend.imports import MAX_UPLOAD_BYTES
from backend.service import get_homepage_stats
from backend.year_filter import filter_dashboard

ROOT = Path(__file__).resolve().parent

load_dotenv(ROOT / ".env")
eel.init(str(ROOT / "web"))

LOGGER = logging.getLogger(__name__)

_job_lock = Semaphore(1)
_pending_upload = None
_dashboard_context = None


@bottle.post("/upload")
def upload_file():
    global _pending_upload

    if not _job_lock.acquire(blocking=False):
        bottle.abort(409, "An import is already running.")

    temporary = None

    try:
        upload = bottle.request.files.get("file")

        if upload is None or not upload.filename.lower().endswith(".zip"):
            bottle.abort(
                400,
                "Please select a Letterboxd ZIP export.",
            )

        if bottle.request.content_length > MAX_UPLOAD_BYTES + 1024 * 1024:
            bottle.abort(
                413,
                "The upload must be smaller than 100 MB.",
            )

        with tempfile.NamedTemporaryFile(
            prefix="letterboxd-",
            suffix=".zip",
            delete=False,
        ) as target:
            temporary = Path(target.name)
            remaining = MAX_UPLOAD_BYTES

            while chunk := upload.file.read(
                min(1024 * 1024, remaining + 1)
            ):
                remaining -= len(chunk)

                if remaining < 0:
                    bottle.abort(
                        413,
                        "The upload must be smaller than 100 MB.",
                    )

                target.write(chunk)

        if _pending_upload:
            _pending_upload.unlink(missing_ok=True)

        _pending_upload = temporary
        temporary = None

        return "success"

    finally:
        if temporary:
            temporary.unlink(missing_ok=True)

        _job_lock.release()


@eel.expose
def process_data():
    global _pending_upload, _dashboard_context

    if not _job_lock.acquire(blocking=False):
        return {
            "status": "error",
            "message": "An import is already running.",
        }

    path = _pending_upload
    _pending_upload = None

    try:
        if path is None:
            raise ValueError(
                "Please upload a Letterboxd export first."
            )

        def progress(current, total):
            eel.updateProgress(current, total)

        context = {}

        stats = get_homepage_stats(
            path,
            progress_callback=progress,
            dashboard_context=context,
        )

        _dashboard_context = context

        return {
            "status": "success",
            "data": stats,
        }

    except ValueError as exc:
        return {
            "status": "error",
            "message": str(exc),
        }

    except Exception:
        LOGGER.exception("Letterboxd import failed")

        return {
            "status": "error",
            "message": (
                "The import could not be completed. "
                "See the Python log for details."
            ),
        }

    finally:
        if path:
            path.unlink(missing_ok=True)

        _job_lock.release()


@eel.expose
def filter_year(year=None):
    if not _job_lock.acquire(blocking=False):
        return {
            "status": "error",
            "message": (
                "An import or filter update is already running."
            ),
        }

    try:
        return {
            "status": "success",
            "data": filter_dashboard(
                _dashboard_context,
                year,
            ),
        }

    except ValueError as exc:
        return {
            "status": "error",
            "message": str(exc),
        }

    except Exception:
        LOGGER.exception("Year filter failed")

        return {
            "status": "error",
            "message": (
                "The year filter could not be applied. "
                "See the Python log."
            ),
        }

    finally:
        _job_lock.release()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    options = (
        {"mode": None}
        if os.getenv("LETTERBOXD_HEADLESS") == "1"
        else {}
    )

    eel.start(
        "index.html",
        size=(1100, 850),
        host="localhost",
        **options,
    )