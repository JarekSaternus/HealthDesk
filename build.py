"""Build HealthDesk into a standalone Windows executable using PyInstaller.

Also downloads ffmpeg (ffplay) for YouTube Radio support.
"""
import subprocess
import sys
import os
import shutil
import urllib.request
import zipfile

# Ensure we run from project root
os.chdir(os.path.dirname(os.path.abspath(__file__)))

FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
FFMPEG_DIR = "ffmpeg_tmp"


def get_customtkinter_path():
    """Find customtkinter package directory for bundling its theme files."""
    import customtkinter
    return os.path.dirname(customtkinter.__file__)


def download_ffmpeg():
    """Download ffmpeg and extract ffplay.exe into dist/HealthDesk/."""
    dist_dir = os.path.join("dist", "HealthDesk")

    # Skip if already present
    if os.path.exists(os.path.join(dist_dir, "ffplay.exe")):
        print("  ffplay.exe already in dist, skipping download")
        return True

    zip_path = os.path.join(FFMPEG_DIR, "ffmpeg.zip")
    os.makedirs(FFMPEG_DIR, exist_ok=True)

    print("  Downloading ffmpeg (for YouTube Radio)...")
    try:
        urllib.request.urlretrieve(FFMPEG_URL, zip_path)
    except Exception as e:
        print(f"  WARNING: Could not download ffmpeg: {e}")
        print("  YouTube Radio will not work without ffplay.exe")
        return False

    print("  Extracting ffplay.exe...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Find ffplay.exe inside the zip (nested in a folder)
            for name in zf.namelist():
                if name.endswith("bin/ffplay.exe"):
                    data = zf.read(name)
                    os.makedirs(dist_dir, exist_ok=True)
                    with open(os.path.join(dist_dir, "ffplay.exe"), "wb") as f:
                        f.write(data)
                    print("  ffplay.exe extracted OK")
                    break
            else:
                print("  WARNING: ffplay.exe not found in zip")
                return False
    except Exception as e:
        print(f"  WARNING: Could not extract ffmpeg: {e}")
        return False
    finally:
        # Cleanup
        shutil.rmtree(FFMPEG_DIR, ignore_errors=True)

    return True


def build():
    # Generate icon first
    from generate_icon import generate_icon
    generate_icon()

    ctk_path = get_customtkinter_path()

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--noconsole",
        "--name", "HealthDesk",
        "--icon", "assets/icon.ico",
        # Bundle customtkinter theme/json files
        "--add-data", f"{ctk_path};customtkinter/",
        # Bundle app assets
        "--add-data", "assets;assets/",
        # Hidden imports that PyInstaller misses
        "--hidden-import", "pystray._win32",
        "--hidden-import", "numpy",
        "--hidden-import", "sounddevice",
        "--hidden-import", "_sounddevice_data",
        "--hidden-import", "PIL._tkinter_finder",
        "--hidden-import", "yt_dlp",
        # Collect sounddevice native libs
        "--collect-data", "sounddevice",
        "--collect-data", "_sounddevice_data",
        # Entry point
        "main.py",
    ]

    print("Building HealthDesk with PyInstaller...")
    print(f"  customtkinter path: {ctk_path}")
    print(f"  Command: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd)
    if result.returncode != 0:
        print("\nBuild FAILED!")
        sys.exit(1)

    print("\nPyInstaller OK!")

    # Download ffmpeg/ffplay for YouTube Radio
    print("\nAdding ffplay for YouTube Radio...")
    download_ffmpeg()

    print(f"\nBuild complete!")
    print(f"  Output: {os.path.abspath('dist/HealthDesk/HealthDesk.exe')}")
    print()
    print("To create installer, run Inno Setup on installer.iss:")
    print('  iscc installer.iss')


if __name__ == "__main__":
    build()
