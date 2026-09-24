"""Config loading and validation."""
from app.utils import read_file


def load_config(path=".env"):
    """Load a Config from a dotenv-style file at `path`."""
    text = read_file(path)
    env = parse_env(text)
    cfg = Config(env)
    return cfg.validate()


def parse_env(text):
    """Parse KEY=VALUE lines into a dict."""
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


class Config:
    def __init__(self, values):
        self.values = values

    def validate(self):
        """Ensure required keys are present, return self."""
        for key in ("DB_URL",):
            if key not in self.values:
                raise ValueError(f"missing required config key: {key}")
        return self
