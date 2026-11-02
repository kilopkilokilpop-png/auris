import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from './initData.js';

const TOKEN = '123456:TEST-token';
const user = { id: 42, first_name: 'Ада', username: 'ada' };

describe('initData', () => {
  it('accepts correctly signed data', () => {
    const raw = signInitData(user, TOKEN);
    expect(validateInitData(raw, TOKEN, 3600).id).toBe(42);
  });
  it('rejects tampered user', () => {
    const raw = signInitData(user, TOKEN).replace('%22id%22%3A42', '%22id%22%3A43');
    expect(() => validateInitData(raw, TOKEN, 3600)).toThrow();
  });
  it('rejects other bot token', () => {
    expect(() => validateInitData(signInitData(user, TOKEN), '999:other', 3600)).toThrow(/signature/);
  });
  it('rejects expired data', () => {
    const raw = signInitData(user, TOKEN, Math.floor(Date.now() / 1000) - 7200);
    expect(() => validateInitData(raw, TOKEN, 3600)).toThrow(/expired/);
  });
  it('rejects missing hash', () => {
    expect(() => validateInitData('user=%7B%7D&auth_date=1', TOKEN, 0)).toThrow();
  });
});
