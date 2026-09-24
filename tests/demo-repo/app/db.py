"""Tiny in-memory database stub used by the demo app."""
from app.utils import retry

_CONNECTIONS = {}


def connect(url):
    """Open (or reuse) a connection to `url`."""
    def _open():
        conn = _CONNECTIONS.get(url)
        if conn is None:
            conn = {"url": url, "open": True}
            _CONNECTIONS[url] = conn
        return conn

    return retry(_open)


def query(conn, sql):
    """Run `sql` against `conn` and return a list of rows."""
    def _run():
        if not conn.get("open"):
            raise RuntimeError("connection closed")
        return [{"sql": sql}]

    return retry(_run)


def close(conn):
    """Close `conn`."""
    conn["open"] = False
