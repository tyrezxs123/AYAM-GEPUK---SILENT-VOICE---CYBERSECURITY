import os
import tempfile

os.environ["SUARASAH_DB"] = os.path.join(tempfile.gettempdir(), "suarasah-test.db")
os.environ["SUARASAH_RL_DISABLE"] = "1"

for _leftover in (os.environ["SUARASAH_DB"], os.environ["SUARASAH_DB"] + "-wal"):
    if os.path.exists(_leftover):
        try:
            os.remove(_leftover)
        except OSError:
            pass
