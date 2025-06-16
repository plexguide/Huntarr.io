# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import pathlib
import glob

# Find the project root directory from the spec file location
spec_dir = pathlib.Path(os.path.dirname(os.path.abspath(SPECPATH)))
project_dir = spec_dir.parent.parent  # Go up two levels to project root

# In GitHub Actions, the current working directory is already the project root
# Check if we're in GitHub Actions by looking at the environment
if os.environ.get('GITHUB_ACTIONS'):
    # Use the current directory instead
    project_dir = pathlib.Path(os.getcwd())

# Print current directory and list files for debugging
print(f"Current directory: {os.getcwd()}")
print(f"Project directory: {project_dir}")
print("Files in current directory:")
for file in os.listdir(os.getcwd()):
    print(f"  {file}")

# Find main.py file
main_py_path = project_dir / 'main.py'
if not main_py_path.exists():
    main_py_files = list(glob.glob(f"{project_dir}/**/main.py", recursive=True))
    if main_py_files:
        main_py_path = pathlib.Path(main_py_files[0])
        print(f"Found main.py at: {main_py_path}")
    else:
        print("ERROR: main.py not found!")
        # Use a placeholder that will cause an error with a clearer message
        main_py_path = project_dir / 'main.py'

block_cipher = None

# Create a list of data files to include with absolute paths
datas = [
    (str(project_dir / 'frontend'), 'frontend'),
    (str(project_dir / 'src'), 'src'),
]

# Add apprise data files to fix attachment directory error
try:
    import apprise
    import os
    apprise_path = os.path.dirname(apprise.__file__)
    # Add apprise's attachment, plugins, and config directories
    apprise_attachment_path = os.path.join(apprise_path, 'attachment')
    apprise_plugins_path = os.path.join(apprise_path, 'plugins')
    apprise_config_path = os.path.join(apprise_path, 'config')
    
    if os.path.exists(apprise_attachment_path):
        datas.append((apprise_attachment_path, 'apprise/attachment'))
    if os.path.exists(apprise_plugins_path):
        datas.append((apprise_plugins_path, 'apprise/plugins'))
    if os.path.exists(apprise_config_path):
        datas.append((apprise_config_path, 'apprise/config'))
        
    print(f"Added apprise data directories from: {apprise_path}")
except ImportError:
    print("Warning: apprise not found, skipping apprise data files")

# Add tools directory if it exists
if os.path.exists(str(project_dir / 'tools')):
    datas.append((str(project_dir / 'tools'), 'tools'))

# Add assets directory if it exists
if os.path.exists(str(project_dir / 'assets')):
    datas.append((str(project_dir / 'assets'), 'assets'))

# Ensure all frontend template files are included
if os.path.exists(str(project_dir / 'frontend')):
    print(f"Including frontend directory at {str(project_dir / 'frontend')}")
    # Make sure we include all frontend template files
    datas.append((str(project_dir / 'frontend/templates'), 'templates'))
    datas.append((str(project_dir / 'frontend/static'), 'static'))

    # Explicitly check for the login template
    login_template = project_dir / 'frontend/templates/login.html'
    if os.path.exists(login_template):
        print(f"Found login.html at {login_template}")
    else:
        print(f"WARNING: login.html not found at {login_template}")

    # List all available templates for debugging
    template_dir = project_dir / 'frontend/templates'
    if os.path.exists(template_dir):
        print("Available templates:")
        for template_file in os.listdir(template_dir):
            print(f" - {template_file}")
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(project_dir / 'frontend/static/logo/huntarr.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Huntarr',
)
