import { test, expect } from '@playwright/test';
import { getJson } from '../../helpers/api';

// ─── JSONPlaceholder ─────────────────────────────────────────────────────────
// Fully public fake REST API — no auth, no rate limits, no real writes.
const JPH = 'https://jsonplaceholder.typicode.com';

interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

test.describe('API — JSONPlaceholder Posts (CRUD)', () => {
  test('GET /posts returns an array of 100 posts', async ({ request }) => {
    const posts = await getJson<Post[]>(request, `${JPH}/posts`);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBe(100);
    expect(typeof posts[0].title).toBe('string');
  });

  test('GET /posts/1 returns the correct post shape', async ({ request }) => {
    const post = await getJson<Post>(request, `${JPH}/posts/1`);
    expect(post.id).toBe(1);
    expect(post.userId).toBeGreaterThan(0);
    expect(typeof post.title).toBe('string');
    expect(typeof post.body).toBe('string');
  });

  test('GET /posts?userId=1 filters posts by userId', async ({ request }) => {
    const posts = await getJson<Post[]>(request, `${JPH}/posts?userId=1`);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every(p => p.userId === 1)).toBe(true);
  });

  test('POST /posts creates a new post and returns 201', async ({ request }) => {
    const response = await request.post(`${JPH}/posts`, {
      data: { title: 'Playwright Test Post', body: 'Automated via Playwright', userId: 1 },
    });
    expect(response.status()).toBe(201);
    const created = await response.json() as Post;
    expect(created.title).toBe('Playwright Test Post');
    expect(created.id).toBeDefined();
  });

  test('PUT /posts/1 fully replaces a post and returns 200', async ({ request }) => {
    const response = await request.put(`${JPH}/posts/1`, {
      data: { id: 1, title: 'Updated Title', body: 'Updated body', userId: 1 },
    });
    expect(response.status()).toBe(200);
    const updated = await response.json() as Post;
    expect(updated.title).toBe('Updated Title');
  });

  test('DELETE /posts/1 returns 200', async ({ request }) => {
    const response = await request.delete(`${JPH}/posts/1`);
    expect(response.status()).toBe(200);
  });
});

// ─── Open-Meteo (free weather API — no key required) ─────────────────────────
interface CurrentWeather {
  temperature: number;
  windspeed: number;
  weathercode: number;
  time: string;
}
interface WeatherResponse {
  latitude: number;
  longitude: number;
  current_weather: CurrentWeather;
}

test.describe('API — Open-Meteo Weather', () => {
  const WEATHER_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true';

  test('GET forecast returns current weather with expected fields', async ({ request }) => {
    const data = await getJson<WeatherResponse>(request, WEATHER_URL);
    expect(typeof data.latitude).toBe('number');
    expect(typeof data.longitude).toBe('number');
    expect(typeof data.current_weather.temperature).toBe('number');
    expect(typeof data.current_weather.windspeed).toBe('number');
    expect(typeof data.current_weather.time).toBe('string');
  });
});
