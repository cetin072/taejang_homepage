export const YOUTUBE_CHANNEL_ID = 'UCMxv6IBvVjkRnn6yHKdXJSg';
const koreaDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function youtubeVideoId(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === 'youtu.be') {
      id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      id = url.pathname === '/watch' && url.searchParams.getAll('v').length === 1
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

export function youtubeJson(html, variable) {
  const match = html.match(new RegExp('var ' + variable + ' = (.*?);</script>', 's'));
  if (!match) throw new Error('Missing YouTube ' + variable);
  return JSON.parse(match[1]);
}
export function youtubeVideoFromHtml(html, videoId, channelId) {
  const data = youtubeJson(html, 'ytInitialPlayerResponse');
  const video = data.videoDetails;
  const meta = data.microformat?.playerMicroformatRenderer;
  if (video?.videoId !== videoId || video.channelId !== channelId ||
      meta?.externalChannelId !== channelId || video.isPrivate || meta.isUnlisted) {
    throw new Error('YouTube video identity or public visibility verification failed');
  }
  // A public premiere landing page is not an already published video.
  if (video.isUpcoming || new Date(meta.liveBroadcastDetails?.startTimestamp).getTime() > Date.now()) return null;
  if (typeof meta.publishDate !== 'string' || !/^\d{4}-\d{2}-\d{2}(T|$)/.test(meta.publishDate)) {
    throw new Error('Missing YouTube publication date');
  }
  const published = new Date(meta.publishDate);
  if (data.playabilityStatus?.status !== 'OK' || !Number.isFinite(published.getTime()) ||
      published.getTime() > Date.now() || typeof video.title !== 'string' || !video.title.trim() || video.title.length > 160) {
    throw new Error('YouTube publication verification failed');
  }
  return officialYouTubeCard(videoId, video.title, koreaDay.format(published));
}

export function officialYouTubeCard(videoId, title, publishedAt) {
  return {
    id: 'youtube-' + videoId, type: 'external', source: 'youtube',
    publisher: '태장 공식 유튜브', category: '회사소식',
    title, summary: '태장 공식 유튜브에 게시된 「' + title.slice(0, 100) + '」 영상입니다.',
    thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
    thumbnailAlt: title + ' 영상 썸네일', publishedAt,
    featured: false, status: 'published',
    externalUrl: 'https://www.youtube.com/watch?v=' + videoId, externalLabel: '유튜브에서 보기'
  };
}
