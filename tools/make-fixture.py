"""Builds the tiny synthetic fixtures the tests read from tests/fixtures/."""
import io
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"


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


def grey_image(width, height, image_format):
    bio = io.BytesIO()
    Image.new("RGB", (width, height), (200, 200, 200)).save(bio, format=image_format)
    return bio.getvalue()


def wall_point(point_id, floor_id, x, y):
    return {"id": point_id, "location": {"floorPlanId": floor_id, "coord": {"x": x, "y": y}}}


def access_point(ap_id, name, vendor, model, floor_id, x, y):
    return {"id": ap_id, "name": name, "vendor": vendor, "model": model,
            "location": {"floorPlanId": floor_id, "coord": {"x": x, "y": y}}}


ESX_JSON = {
    "project.json": {"project": {"title": "Fixture Síte"}},
    "floorPlans.json": {"floorPlans": [
        {"id": "fp-g", "name": "Ground", "width": 400.0, "height": 300.0, "metersPerUnit": 0.05, "imageId": "g"},
        {"id": "fp-f", "name": "First floor", "width": 640.0, "height": 480.0, "metersPerUnit": 0.04, "imageId": "f"},
    ]},
    "images.json": {"images": [
        {"id": "g", "imageFormat": "PNG", "resolutionWidth": 400, "resolutionHeight": 300},
        {"id": "f", "imageFormat": "PNG", "resolutionWidth": 640, "resolutionHeight": 480},
    ]},
    "wallTypes.json": {"wallTypes": [
        {"id": "wt-dry", "name": "Drywall", "color": "#c0c0c0", "thickness": 0.1, "propagationProperties": [
            {"band": "FIVE", "attenuationFactor": 30.0}, {"band": "TWO", "attenuationFactor": 25.0}]},
        {"id": "wt-brick", "name": "Brick", "color": "#a0522d", "thickness": 0.25, "propagationProperties": [
            {"band": "TWO", "attenuationFactor": 12.34}]},
        {"id": "wt-unused", "name": "Unused", "color": "#123456", "thickness": 0.3, "propagationProperties": [
            {"band": "FIVE", "attenuationFactor": 5.0}]},
    ]},
    "wallPoints.json": {"wallPoints": [
        wall_point("g1", "fp-g", 10.0, 20.0),
        wall_point("g2", "fp-g", 390.0, 20.0),
        wall_point("g3", "fp-g", 390.0, 280.5),
        wall_point("g4", "fp-g", 10.25, 280.5),
        wall_point("f1", "fp-f", 50.0, 60.0),
        wall_point("f2", "fp-f", 600.0, 60.0),
        wall_point("f3", "fp-f", 600.0, 440.75),
    ]},
    "wallSegments.json": {"wallSegments": [
        {"id": "s1", "wallPoints": ["g1", "g2"], "wallTypeId": "wt-dry"},
        {"id": "s2", "wallPoints": ["g2", "g3"], "wallTypeId": "wt-brick"},
        {"id": "s3", "wallPoints": ["g3", "g4"], "wallTypeId": "wt-dry"},
        {"id": "s4", "wallPoints": ["g4", "g1"], "wallTypeId": "wt-brick"},
        {"id": "s5", "wallPoints": ["f1", "f2"], "wallTypeId": "wt-dry"},
        {"id": "s6", "wallPoints": ["f2", "f3"], "wallTypeId": "wt-brick"},
        {"id": "s7", "wallPoints": ["g1", "missing-point"], "wallTypeId": "wt-dry"},
    ]},
    "accessPoints.json": {"accessPoints": [
        access_point("ap-a", "AP-A", "Mist", "AP34", "fp-g", 100.0, 150.0),
        access_point("ap-b", "AP-B", "Mist", "AP34", "fp-g", 9999.0, 75.5),
        access_point("ap-c", "AP-C", "Acme", "X1", "fp-f", 320.0, 240.0),
    ]},
}


def write_fixed_time(z, name, data):
    # A fixed timestamp keeps the committed fixture byte-identical across runs
    z.writestr(zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)


def run_esx2oi(esx_path):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.zip"
        subprocess.run([str(ROOT / ".venv" / "bin" / "python"), str(ROOT / "esx2oi.py"),
                        "--esx", str(esx_path), "--out", str(out)], check=True)
        with zipfile.ZipFile(out) as z:
            openintent = json.loads(z.read("openintent.json"))
            images = {n: list(Image.open(io.BytesIO(z.read(n))).size)
                      for n in z.namelist() if n.startswith("images/") and not n.endswith("/")}
    return openintent, images


def esx_fixture():
    esx_path = FIXTURES / "fixture.esx"
    with zipfile.ZipFile(esx_path, "w") as z:
        for name, data in ESX_JSON.items():
            write_fixed_time(z, name, json.dumps(data))
        # image-g goes before image-f: the JPEG test relies on this archive order
        write_fixed_time(z, "image-g", grey_image(400, 300, "PNG"))
        write_fixed_time(z, "image-f", grey_image(640, 480, "PNG"))
    # Stand-in for image-g in the test that a JPEG floor image goes through toPng
    (FIXTURES / "ground.jpg").write_bytes(grey_image(400, 300, "JPEG"))

    openintent, images = run_esx2oi(esx_path)
    expected = {"openintent": openintent, "images": images}
    (FIXTURES / "fixture.expected.json").write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    zip_fixtures()
    esx_fixture()
