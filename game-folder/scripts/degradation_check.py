"""Compatibility entry point for the numeric assessment map browser check."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('numeric_layers_check.py')), run_name='__main__')
