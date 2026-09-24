"""Small utility helpers used across the demo app."""
import time


def read_file(path):
    """Read a text file and return its contents."""
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def slugify(text):
    """Turn a string into a lowercase, dash-separated slug."""
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in text.strip().lower())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")


def retry(fn, times=3):
    """Call fn() up to `times` times, returning the first success."""
    last_error = None
    for attempt in range(times):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0)
    raise last_error
