import baseWorker from './worker.js';
import { handleAvailability } from './availability.js';
import { handlePersonalizedRecommendations } from './recommendations-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/availability') {
      return handleAvailability(request, env);
    }
    if (url.pathname === '/api/recommendations') {
      return handlePersonalizedRecommendations(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
