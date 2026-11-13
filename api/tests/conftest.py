import os
import tempfile

os.environ["SILENTVOICE_DB"] = os.path.join(tempfile.gettempdir(), "silentvoice-test.db")
os.environ["SUARASAH_DB"] = os.environ["SILENTVOICE_DB"]
os.environ["SILENTVOICE_RL_DISABLE"] = "1"
os.environ["SUARASAH_RL_DISABLE"] = "1"

for _leftover in (os.environ["SILENTVOICE_DB"], os.environ["SILENTVOICE_DB"] + "-wal"):
    if os.path.exists(_leftover):
        try:
            os.remove(_leftover)
        except OSError:
            pass
