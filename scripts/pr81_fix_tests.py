from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing expected fragment: {label}')
    return text.replace(old, new, 1)


main_path = Path('tests/public-homepage-main-simplification.test.js')
text = main_path.read_text(encoding='utf-8')
text = replace_once(text,
    "assert.equal(actualHubItems.length, 12, '소식·기록은 두 환경정비 활동을 포함한 공개 콘텐츠를 함께 표시합니다');",
    "assert.equal(actualHubItems.length, 13, '소식·기록은 두 환경정비 활동과 새 환경정비 브이로그를 포함한 공개 콘텐츠를 함께 표시합니다');",
    'hub count')
text = replace_once(text,
    "  'activity-environment-cleanup-second',\n  'activity-terrarium-business-start-2026-08',",
    "  'activity-environment-cleanup-second',\n  'youtube-mIb0wN_Wi8w',\n  'activity-terrarium-business-start-2026-08',",
    'hub ids')
text = replace_once(text,
    "  '두 번째 환경정비 활동을 진행했습니다',\n  '테라리움 제조사업을 시작합니다',",
    "  '두 번째 환경정비 활동을 진행했습니다',\n  '[태장 브이로그] 8월 24일, 더운 날씨 속에서도 정말 뿌듯했던 환경정비 활동',\n  '테라리움 제조사업을 시작합니다',",
    'hub titles')
text = replace_once(text,
    "assert.deepEqual(Array.from(actualRecentItems, item => item.title), ['두 번째 환경정비 활동을 진행했습니다', '테라리움 제조사업을 시작합니다', '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장', '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사', '태장 소개영상', \"[현장] '경남형 장애인 동행일자리' 1호점 가보니\", '태장의 새로운 사업장이 문을 열었습니다', '한 줄 한 줄 정성으로 완성되는 태장의 하루']);",
    "assert.deepEqual(Array.from(actualRecentItems, item => item.title), ['두 번째 환경정비 활동을 진행했습니다', '[태장 브이로그] 8월 24일, 더운 날씨 속에서도 정말 뿌듯했던 환경정비 활동', '테라리움 제조사업을 시작합니다', '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장', '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사', '태장 소개영상', \"[현장] '경남형 장애인 동행일자리' 1호점 가보니\", '태장의 새로운 사업장이 문을 열었습니다']);",
    'recent titles')
for old, new, label in [
    ("assert.equal(actualRecentItems[4].thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');", "assert.equal(actualRecentItems[5].thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');", 'intro thumbnail index'),
    ("assert.equal(actualRecentItems[4].thumbnailAlt, '태장 공식 소개영상 썸네일');", "assert.equal(actualRecentItems[5].thumbnailAlt, '태장 공식 소개영상 썸네일');", 'intro alt index'),
    ("assert.equal(actualRecentItems[4].externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');", "assert.equal(actualRecentItems[5].externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');", 'intro url index'),
    ("assert.deepEqual(Array.from(actualHubItems.filter(item => item.source === 'youtube' && item.publisher === '태장 공식 유튜브'), item => item.id), ['youtube-qvqNyeyfQsA', 'youtube-8x7yg5YBK9g', 'youtube-FbEOcteBSJ4']);", "assert.deepEqual(Array.from(actualHubItems.filter(item => item.source === 'youtube' && item.publisher === '태장 공식 유튜브'), item => item.id), ['youtube-mIb0wN_Wi8w', 'youtube-qvqNyeyfQsA', 'youtube-8x7yg5YBK9g', 'youtube-FbEOcteBSJ4']);", 'official youtube ids'),
    ("assert.equal(actualRecentItems[2].externalUrl, 'https://www.youtube.com/watch?v=qvqNyeyfQsA');", "assert.equal(actualRecentItems[3].externalUrl, 'https://www.youtube.com/watch?v=qvqNyeyfQsA');", 'changwon index'),
    ("assert.equal(actualRecentItems[3].externalUrl, 'https://www.youtube.com/watch?v=8x7yg5YBK9g');", "assert.equal(actualRecentItems[4].externalUrl, 'https://www.youtube.com/watch?v=8x7yg5YBK9g');", 'gyeongnam index'),
    ("assert.equal(actualRecentItems[5].externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');", "assert.equal(actualRecentItems[6].externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');", 'knn index'),
]:
    text = replace_once(text, old, new, label)
marker = "assert.equal(actualRecentItems[5].externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');\n"
insert = (
    "assert.equal(actualRecentItems[1].id, 'youtube-mIb0wN_Wi8w');\n"
    "assert.equal(actualRecentItems[1].thumbnail, 'https://i.ytimg.com/vi/mIb0wN_Wi8w/hqdefault.jpg');\n"
    "assert.equal(actualRecentItems[1].externalUrl, 'https://www.youtube.com/watch?v=mIb0wN_Wi8w');\n"
)
text = replace_once(text, marker, marker + insert, 'vlog recent assertions')
main_path.write_text(text, encoding='utf-8')

ext_path = Path('tests/public-external-content.test.js')
text = ext_path.read_text(encoding='utf-8')
text = replace_once(text,
    'assert.equal(window.TAEJANG_CONTENT.hub.length, 6);',
    'assert.equal(window.TAEJANG_CONTENT.hub.length, 7);',
    'external count')
text = replace_once(text,
    "const knn = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-8x4Rf3knAb8');",
    "const vlog = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-mIb0wN_Wi8w');\nconst knn = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-8x4Rf3knAb8');",
    'vlog fixture')
marker = "assert.equal(youtube.publishedAt, '2026-08-13');\n"
block = """

assert.equal(vlog.type, 'external');
assert.equal(vlog.source, 'youtube');
assert.equal(vlog.publisher, '태장 공식 유튜브');
assert.equal(vlog.category, 'ESG·사회공헌');
assert.equal(vlog.title, '[태장 브이로그] 8월 24일, 더운 날씨 속에서도 정말 뿌듯했던 환경정비 활동');
assert.equal(vlog.status, 'published');
assert.equal(vlog.publishedAt, '2026-08-24');
assert.equal(vlog.externalUrl, 'https://www.youtube.com/watch?v=mIb0wN_Wi8w');
assert.equal(vlog.thumbnail, 'https://i.ytimg.com/vi/mIb0wN_Wi8w/hqdefault.jpg');
assert.equal(vlog.externalLabel, '유튜브에서 보기');
"""
text = replace_once(text, marker, marker + block, 'vlog assertions')
text = replace_once(text,
    "assert.equal(window.TAEJANG_CONTENT.hub.length, 6, '같은 외부 콘텐츠를 중복 등록하지 않습니다');",
    "assert.equal(window.TAEJANG_CONTENT.hub.length, 7, '같은 외부 콘텐츠를 중복 등록하지 않습니다');",
    'duplicate count')
ext_path.write_text(text, encoding='utf-8')
