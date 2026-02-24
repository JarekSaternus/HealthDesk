"""Launcher without console window. Double-click this file to start HealthDesk."""
import runpy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
runpy.run_module("main", run_name="__main__")
