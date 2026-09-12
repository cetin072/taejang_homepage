export const STAGING_PROJECT_REF = 'jgsxpdflgkqroecfjzxq';

const LOCAL_SUPABASE_HOSTS = new Set(['kong', '127.0.0.1', 'localhost', 'host.docker.internal']);

export function qaEnvironment(supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol === 'https:' && url.hostname === `${STAGING_PROJECT_REF}.supabase.co`) return 'staging';
    if (url.protocol === 'http:' && LOCAL_SUPABASE_HOSTS.has(url.hostname)) return 'local';
    return null;
  } catch {
    return null;
  }
}

export function allowedQaOrigin(origin, environment) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (environment === 'local' && url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return origin;
    if (environment !== 'staging' || url.protocol !== 'https:') return null;
    if (host.startsWith('deploy-preview-') && host.endsWith('--taejang-homepage.netlify.app')) return origin;
    return null;
  } catch {
    return null;
  }
}
