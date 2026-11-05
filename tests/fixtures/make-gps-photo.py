# Builds tests/fixtures/gps.jpg: a 640x480 photo (red left, blue right) carrying a real
# Exif block with camera make/model and a GPS position, like a phone photo.
# Run: python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python tests/fixtures/make-gps-photo.py
import pathlib
from PIL import Image
img = Image.new("RGB", (640, 480), (204, 51, 51))
img.paste((51, 51, 204), (320, 0, 640, 480))
exif = Image.Exif()
exif[0x010F] = "SecretCameraMaker"     # Make
exif[0x0110] = "SecretCameraModel"     # Model
gps = {1: "N", 2: (41.0, 9.0, 28.44), 3: "W", 4: (8.0, 37.0, 44.76)}
exif[0x8825] = gps                     # GPS IFD
img.save(pathlib.Path(__file__).with_name("gps.jpg"), "JPEG", quality=90, exif=exif)
