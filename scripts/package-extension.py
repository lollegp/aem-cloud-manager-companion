#!/usr/bin/env python3
"""Build and verify a deterministic Chrome Web Store ZIP from runtime files only."""
import hashlib
import json
import re
import struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = {
    'manifest.json', 'background.js', 'credentials.js', 'vault.js', 'auth.js',
    'api.js', 'options.html', 'options.js', 'popup.html', 'popup.js', 'pipeline.js',
    'history.js', 'cache.js', 'variables.js', 'theme.js', 'style.css', 'privacy.html',
}


def build_package():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    assert manifest['manifest_version'] == 3, 'Only Manifest V3 is supported.'
    assert re.fullmatch(r'(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}', manifest['version']), 'Invalid release version.'
    assert all(int(part) <= 65535 for part in manifest['version'].split('.')) and any(int(part) for part in manifest['version'].split('.')), 'Chrome version components must be 0–65535 and not all zero.'
    assert manifest.get('permissions') == ['storage'], 'Review changed permissions before packaging.'
    assert set(manifest.get('host_permissions', [])) == {
        'https://cloudmanager.adobe.io/*', 'https://ims-na1.adobelogin.com/*'
    }, 'Review changed API hosts before packaging.'
    assert not any(manifest.get(key) for key in ['content_scripts', 'externally_connectable', 'web_accessible_resources']), 'Review newly exposed extension surfaces.'
    csp = manifest['content_security_policy']['extension_pages']
    assert "script-src 'self'" in csp and 'unsafe-eval' not in csp and 'unsafe-inline' not in csp
    assert json.loads((ROOT / 'package.json').read_text())['version'] == manifest['version'], 'Package and extension versions differ.'
    assert set(manifest['icons']) == {'16', '32', '48', '128'}, 'Required icon sizes are missing.'
    icons = set(manifest['icons'].values()) | set(manifest['action']['default_icon'].values())
    assert all(re.fullmatch(r'icons/icon-(16|32|48|128)\.png', path) for path in icons)
    files = sorted(RUNTIME | icons)
    data = {}
    for name in files:
        path = ROOT / name
        assert path.is_file() and not path.is_symlink(), f'Missing or linked runtime file: {name}'
        data[name] = path.read_bytes()
        if path.suffix == '.png':
            assert data[name][:8] == b'\x89PNG\r\n\x1a\n', f'Invalid PNG: {name}'
            expected_size = int(path.stem.split('-')[-1])
            assert struct.unpack('>II', data[name][16:24]) == (expected_size, expected_size), f'Wrong icon dimensions: {name}'
        if path.suffix in ['.js', '.html', '.css']:
            text = data[name].decode()
            assert not re.search(r'\beval\s*\(|new\s+Function\s*\(', text), f'Dynamic code in {name}'
            references = re.findall(r'(?:from\s+|import\s*)[\'\"](\./[^\'\"]+)[\'\"]', text) if path.suffix == '.js' else re.findall(r'(?:src|href)=[\'\"]([^\'\"]+)[\'\"]', text) if path.suffix == '.html' else []
            for reference in references:
                if re.match(r'^[a-z]+:', reference) or reference.startswith('#'):
                    continue
                target = (path.parent / reference.split('#')[0]).resolve().relative_to(ROOT).as_posix()
                assert target in files, f'{name} references an unpackaged file: {target}'
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    archive = output / f'aem-cloud-manager-companion-{manifest["version"]}.zip'
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as zipped:
        for name in files:
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zipped.writestr(info, data[name])
    with ZipFile(archive) as zipped:
        assert zipped.testzip() is None, 'Archive CRC verification failed.'
        assert sorted(zipped.namelist()) == files
        assert json.loads(zipped.read('manifest.json')) == manifest
        assert all(zipped.read(name) == content for name, content in data.items())
    report = {
        'version': manifest['version'], 'archive': archive.name,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'runtimeFiles': {name: hashlib.sha256(content).hexdigest() for name, content in data.items()},
        'submissionStatus': 'candidate; credential security review required',
        'validationScope': 'Package structure and source files only; not Store approval or live Adobe verification.'
    }
    (output / 'release-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Built and verified {archive.relative_to(ROOT)} ({len(files)} runtime files).')
    print(f'SHA-256: {report["sha256"]}')
    print('Candidate only: credential security review and live Adobe verification are required before submission.')


if __name__ == '__main__':
    build_package()
