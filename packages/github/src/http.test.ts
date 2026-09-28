import { describe, expect, it } from 'vitest';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { GitHubHttp } from './http.ts';

describe('GitHubHttp', () => {
  it('sends the token to paths and to full URLs on the API', async () => {
    const fake = new FakeFetch([{ body: {} }, { body: {} }]);
    const http = new GitHubHttp(fakeTokens, fake.fn);

    await http.request('GET', 'user');
    await http.request('GET', 'https://api.github.com/notifications?page=2');

    expect(fake.requests.map((request) => request.url)).toEqual(['https://api.github.com/user', 'https://api.github.com/notifications?page=2']);
  });

  it('refuses any other full URL before it reads the token', async () => {
    const fake = new FakeFetch([]);
    const http = new GitHubHttp(fakeTokens, fake.fn);

    for (const url of ['https://evil.example/x', 'https://api.github.com.evil.example/x', 'http://api.github.com/user', 'https://uploads.github.com/x']) {
      await expect(http.request('GET', url)).rejects.toThrow('refusing to send the GitHub token');
    }
    expect(fake.requests).toEqual([]);
  });

  it('forgets the token after a 401, so a fresh gh login is read next time', async () => {
    const fake = new FakeFetch([{ status: 401, body: { message: 'Bad credentials' } }, { body: {} }]);
    let forgotten = 0;
    const http = new GitHubHttp({ token: async () => 'old-token', forget: () => (forgotten += 1) }, fake.fn);

    await expect(http.requestOk('GET', 'user')).rejects.toMatchObject({ status: 401 });
    await http.request('GET', 'user');

    expect(forgotten).toBe(1);
  });
});
