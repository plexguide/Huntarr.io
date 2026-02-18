# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import pathlib
import glob

# Find the project root directory from the spec file location
spec_dir = pathlib.Path(os.path.dirname(os.path.abspath(SPECPATH)))
project_dir = spec_dir.parent.parent  # Go up two levels to project root

# In GitHub Actions, the current working directory is already the project root
if os.environ.get('GITHUB_ACTIONS'):
    project_dir = pathlib.Path(os.getcwd())

print(f"Current directory: {os.getcwd()}")
print(f"Project directory: {project_dir}")

# Find main.py file
main_py_path = project_dir / 'main.py'
if not main_py_path.exists():
    main_py_files = list(glob.glob(f"{project_dir}/**/main.py", recursive=True))
    if main_py_files:
        main_py_path = pathlib.Path(main_py_files[0])
        print(f"Found main.py at: {main_py_path}")
    else:
        print("ERROR: main.py not found!")
        main_py_path = project_dir / 'main.py'

block_cipher = None

# ---------------------------------------------------------------------------
# Data files to bundle.
# PyInstaller 6.x places these under _internal/ (sys._MEIPASS).
# We include frontend/templates and frontend/static under 'frontend/' so
# code using _MEIPASS/frontend/templates finds them.
# We explicitly EXCLUDE node_modules and frontend/src (dev-only).
# ---------------------------------------------------------------------------

from PyInstaller.building.datastruct import Tree

# Collect frontend/templates and frontend/static, skipping node_modules and src
frontend_templates = Tree(
    str(project_dir / 'frontend' / 'templates'),
    prefix='frontend/templates',
    excludes=['*.pyc', '__pycache__'],
)
frontend_static = Tree(
    str(project_dir / 'frontend' / 'static'),
    prefix='frontend/static',
    excludes=['*.pyc', '__pycache__'],
)

datas = [
    (str(project_dir / 'src'), 'src'),
]

# Also add templates/static at top-level as legacy fallback
datas.append((str(project_dir / 'frontend' / 'templates'), 'templates'))
datas.append((str(project_dir / 'frontend' / 'static'), 'static'))

# Add apprise data files
try:
    import apprise
    apprise_path = os.path.dirname(apprise.__file__)
    for subdir in ('attachment', 'plugins', 'config'):
        p = os.path.join(apprise_path, subdir)
        if os.path.exists(p):
            datas.append((p, f'apprise/{subdir}'))
    print(f"Added apprise data directories from: {apprise_path}")
except ImportError:
    print("Warning: apprise not found, skipping apprise data files")

# Add tools directory if it exists
if os.path.exists(str(project_dir / 'tools')):
    datas.append((str(project_dir / 'tools'), 'tools'))

# Add assets directory if it exists
if os.path.exists(str(project_dir / 'assets')):
    datas.append((str(project_dir / 'assets'), 'assets'))

# Add distribution/windows/resources for system tray and helpers
resources_dir = project_dir / 'distribution' / 'windows' / 'resources'
if resources_dir.exists():
    datas.append((str(resources_dir), 'resources'))
    print(f"Including Windows resources from: {resources_dir}")

# Debug: verify frontend files
template_dir = project_dir / 'frontend' / 'templates'
if template_dir.exists():
    print("Available templates:")
    for f in os.listdir(template_dir):
        print(f"  - {f}")
else:
    print(f"WARNING: Template directory not found at {template_dir}")

a = Analysis(
    [str(main_py_path)],
    pathex=[str(project_dir)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'waitress',
        'pyotp',
        'win32serviceutil',
        'win32service',
        'win32event',
        'servicemanager',
        'win32timezone',
        'pywin32',
        'bcrypt',
        'qrcode',
        'PIL.Image',
        'flask',
        'flask.json',
        'flask.sessions',
        'markupsafe',
        'jinja2',
        'jinja2.ext',
        'werkzeug',
        'werkzeug.exceptions',
        'itsdangerous',
        'logging.handlers',
        'email',
        'importlib',
        'json',
        'sqlite3',
        'requests',
        'urllib3',
        'certifi',
        'idna',
        'charset_normalizer',
        'queue',
        'threading',
        'socket',
        'datetime',
        'time',
        'os',
        'sys',
        're',
        'winreg',
        'hashlib',
        'base64',
        'uuid',
        'pathlib',
        'concurrent.futures',
        # Apprise notification support
        'apprise',
        'apprise.common',
        'apprise.conversion',
        'apprise.decorators',
        'apprise.locale',
        'apprise.logger',
        'apprise.manager',
        'apprise.utils',
        'apprise.URLBase',
        'apprise.AppriseAsset',
        'apprise.AppriseAttachment',
        'apprise.AppriseConfig',
        'apprise.cli',
        'apprise.config',
        'apprise.attachment',
        'apprise.plugins',
        'apprise.plugins.NotifyEmail',
        'apprise.plugins.NotifyDiscord',
        'apprise.plugins.NotifySlack',
        'apprise.plugins.NotifyTelegram',
        'apprise.plugins.NotifyWebhookJSON',
        'apprise.plugins.NotifyWebhookXML',
        'markdown',
        'yaml',
        'cryptography',
        'cryptography.fernet',
        'cryptography.hazmat',
        'cryptography.hazmat.primitives',
        'cryptography.hazmat.primitives.hashes',
        'cryptography.hazmat.primitives.ciphers',
        'cryptography.hazmat.backends',
        'cryptography.hazmat.backends.openssl',
        # System tray support
        'pystray',
        'pystray._win32',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Huntarr',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # Hide console window — runs as system tray app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(project_dir / 'frontend' / 'static' / 'logo' / 'huntarr.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    frontend_templates,
    frontend_static,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Huntarr',
)
