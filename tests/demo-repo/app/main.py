"""Entry point for the demo app."""
from app.config import load_config
from app.db import connect, query, close
from app.utils import slugify


def main():
    """Load config and run the app."""
    cfg = load_config()
    run(cfg)


def run(cfg):
    """Connect to the database, run a query, then close the connection."""
    conn = connect(cfg.values["DB_URL"])
    rows = query(conn, "select 1")
    close(conn)
    title = slugify("Demo App Report")
    return title, rows


if __name__ == "__main__":
    main()
