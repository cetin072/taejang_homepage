import html
import io
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

BLOG_ID = 'taejang-official'
ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_JS = ROOT / 'assets/js/naver-blog-archive.js'
OUT_DIR = ROOT / 'assets/images/archive'
TARGET_SIZE = (720, 405)
MAX_BYTES = 190 * 1024
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'


def fetch(url, referer=None):
    headers = {'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'}
    if referer:
        headers['Referer'] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read(), res.headers.get_content_type()


def extract_image_url(page_html):
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'(https://(?:blogfiles|postfiles)\.pstatic\.net/[^"\'<> ]+)',
        r'(https://blogthumb\.pstatic\.net/[^"\'<> ]+)'
    ]
    for pattern in patterns:
        match = re.search(pattern, page_html, re.I)
        if match:
            return html.unescape(match.group(1)).replace('\\u0026', '&')
    return ''


def write_webp(image_bytes, out_path):
    with Image.open(io.BytesIO(image_bytes)) as source:
        source = source.convert('RGB')
        fitted = ImageOps.fit(source, TARGET_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        for quality in (82, 78, 74, 70, 66, 62, 58, 54):
            buffer = io.BytesIO()
            fitted.save(buffer, format='WEBP', quality=quality, method=6)
            data = buffer.getvalue()
            if len(data) <= MAX_BYTES:
                out_path.write_bytes(data)
                return len(data), quality
        buffer = io.BytesIO()
        fitted.save(buffer, format='WEBP', quality=50, method=6)
        data = buffer.getvalue()
        out_path.write_bytes(data)
        return len(data), 50


def main():
    text = ARCHIVE_JS.read_text(encoding='utf-8')
    log_nos = re.findall(r"\['(\d{12})',\s*'2026-", text)
    if len(set(log_nos)) != 30:
        raise SystemExit(f'expected 30 blog ids, found {len(set(log_nos))}')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures = []
    created = []

    for index, log_no in enumerate(dict.fromkeys(log_nos), start=1):
        out_path = OUT_DIR / f'naver-blog-{log_no}.webp'
        if out_path.exists() and out_path.stat().st_size > 0:
            print(f'[{index}/30] keep existing {out_path.name} ({out_path.stat().st_size} bytes)')
            continue

        post_url = f'https://blog.naver.com/PostView.naver?blogId={BLOG_ID}&logNo={log_no}'
        try:
            page_bytes, _ = fetch(post_url, f'https://blog.naver.com/{BLOG_ID}/{log_no}')
            page_html = page_bytes.decode('utf-8', errors='replace')
            image_url = extract_image_url(page_html)
            if not image_url:
                raise RuntimeError('no representative image found')
            image_bytes, content_type = fetch(image_url, post_url)
            if not content_type.startswith('image/'):
                raise RuntimeError(f'unexpected content type: {content_type}')
            size, quality = write_webp(image_bytes, out_path)
            if size > 200 * 1024:
                raise RuntimeError(f'optimized image too large: {size}')
            created.append(out_path.name)
            print(f'[{index}/30] created {out_path.name} {size} bytes q={quality}')
        except Exception as exc:
            failures.append((log_no, str(exc)))
            print(f'[{index}/30] FAILED {log_no}: {exc}', file=sys.stderr)
        time.sleep(0.2)

    print(f'created={len(created)} existing={30-len(created)-len(failures)} failures={len(failures)}')
    if failures:
        for log_no, error in failures:
            print(f'FAIL {log_no}: {error}', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
