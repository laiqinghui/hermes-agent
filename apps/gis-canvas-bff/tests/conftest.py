import pathlib
import sys

# Make `app` importable when running pytest from apps/gis-canvas-bff/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
