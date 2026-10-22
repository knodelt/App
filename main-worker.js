import baseWorker from './worker.js';
import { handleAvailability } from './availability.js';
import { handlePersonalizedRecommendations } from './recommendations-api.js';
import { handleHiddenMatch } from './hidden-match-server.js';
import { handleFrameAccount, getVerifiedFrameSession } from './frame-account-server.js';
import { handleFrameAnalytics } from './frame-analytics-server.js';
export { HiddenMatchRoom } from './hidden-match-server.js';
export { FrameAccount } from './frame-account-server.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/account/')) return handleFrameAccount(request, env);
    if (url.pathname.startsWith('/api/analytics/')) return handleFrameAnalytics(request, env, getVerifiedFrameSession);
    if (url.pathname.startsWith('/api/hidden-match/')) {
      return handleHiddenMatch(request, env);
    }
    if (url.pathname === '/api/availability') {
      return handleAvailability(request, env);
    }
    if (url.pathname === '/api/recommendations') {
      return handlePersonalizedRecommendations(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
