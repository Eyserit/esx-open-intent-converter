"""Builds the tiny synthetic fixtures the tests read from tests/fixtures/."""
import zipfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def zip_fixtures():
    FIXTURES.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(FIXTURES / "python-stored.zip", "w", zipfile.ZIP_STORED) as z:
        z.writestr("a.txt", "hello")
        z.writestr("dir/b.json", '{"x":1}')

    with zipfile.ZipFile(FIXTURES / "python-deflated.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("a.txt", "hello")
        z.writestr("dir/b.json", '{"x":1}')
        z.writestr("images/", "")
        z.writestr("naïve.txt", "ü")

    with zipfile.ZipFile(FIXTURES / "python-zip64.zip", "w", zipfile.ZIP_STORED) as z:
        with z.open("a.txt", "w", force_zip64=True) as f:
            f.write(b"hello")

    (FIXTURES / "not-a-zip.bin").write_bytes(b"\x41" * 100)


if __name__ == "__main__":
    zip_fixtures()
