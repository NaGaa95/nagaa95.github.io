"""Refresh the curated catalogue from GitHub. Standard library only.

Projects are deliberately allowlisted in data/catalog.json. This script never
adds unrelated repositories or changes editorial categories and descriptions.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'data' / 'catalog.json'


def github(path):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'NaGaa95-Portfolio', 'X-GitHub-Api-Version': '2022-11-28'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request('https://api.github.com/' + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def refresh(project):
    project = dict(project)
    try:
        repository = project['repo'].removeprefix('https://github.com/').strip('/')
        if len(repository.split('/')) != 2 or project['repo'] != 'https://github.com/' + repository:
            raise ValueError('Expected a public GitHub repository URL')
        repo = github(f'repos/{repository}')
        releases = []
        page = 1
        while True:
            batch = github(f'repos/{repository}/releases?per_page=100&page={page}')
            releases.extend(release for release in batch if not release['draft'])
            if len(batch) < 100:
                break
            page += 1
        release = max(releases, key=lambda r: r['published_at'] or r['created_at'], default=None)
        downloads = sum(asset['download_count'] for release in releases for asset in release['assets'])
        project.update(stars=repo['stargazers_count'], downloads=downloads, updated=repo['pushed_at'], archived=repo['archived'], branch=repo['default_branch'])
        if release:
            assets = release['assets']
            asset = next((a for a in assets if a['name'].lower().endswith('.nro')), None) or (assets[0] if len(assets) == 1 else None)
            project.update(version=release['tag_name'], released=release['published_at'], releaseUpdated=release.get('updated_at') or release['published_at'], assetUpdated=max((a.get('updated_at') or '' for a in assets), default='') or None, releaseUrl=release['html_url'], releaseNotes=release.get('body') or '', prerelease=release['prerelease'], downloadUrl=asset['browser_download_url'] if asset else None, assetName=asset['name'] if asset else None, assetSize=asset['size'] if asset else None)
        else:
            for field in ('version', 'released', 'releaseUpdated', 'assetUpdated', 'releaseUrl', 'downloadUrl', 'assetName', 'assetSize'):
                project[field] = None
            project['releaseNotes'] = ''
            project['prerelease'] = False
        if repo.get('parent'):
            project['upstream'] = repo['parent']['full_name']
        return project, None
    except Exception as error:
        return project, f'{project["id"]}: {error}'


def main():
    data = json.loads(CATALOG.read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(refresh, data['projects']))
    errors = [error for _, error in results if error]
    for error in errors:
        print('Kept previous data for ' + error, file=sys.stderr)
    if len(errors) == len(results):
        raise SystemExit('No projects could be refreshed; existing catalogue was preserved.')
    data['projects'] = [project for project, _ in results]
    if errors:
        # Do not present a partially refreshed catalogue as completely current.
        data['refreshWarning'] = f'{len(errors)} projects retain earlier release data.'
    else:
        data['generated'] = datetime.now(timezone.utc).isoformat()
        data['downloadsVerified'] = data['generated']
        data.pop('refreshWarning', None)
    temp = CATALOG.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(CATALOG)
    print(f'Refreshed {len(results) - len(errors)}/{len(results)} projects.')


if __name__ == '__main__':
    main()
