"""Build a source + browser preview archive without local runtime or credentials."""
from pathlib import Path
import hashlib
import json
import zipfile
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
archive = root.parent / f'ripple-chat-v{version}-源码与预览.zip'
folders = {'src', 'public', 'electron', 'docs', 'tests', 'scripts', 'dist'}
files = {'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'index.html', 'README.md', 'CHANGELOG.md', '.gitignore', 'start.sh', '启动桌面.cmd'}
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as target:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if not file.is_file() or file.is_symlink():
            continue
        if relative.parts[0] not in folders and str(relative) not in files:
            continue
        if any(part.startswith(('.env', 'core.')) for part in relative.parts) or file.suffix in {'.log', '.pyc'}:
            continue
        target.write(file, Path('ripple-chat') / relative)
with zipfile.ZipFile(archive) as target:
    assert target.testzip() is None
    assert all('node_modules/' not in f and '/core.' not in f for f in target.namelist())
print(archive)
print(f'{archive.stat().st_size / 1024 / 1024:.2f} MiB')
print('SHA256', hashlib.sha256(archive.read_bytes()).hexdigest())
