// Small helpers over the D1 binding. D1 has no BEGIN/COMMIT; statements that
// must succeed or fail together go through db.batch(), which is atomic.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// D1 rejects undefined; booleans are stored as 0/1.
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export const stmt = (db, sql, ...params) => db.prepare(sql).bind(...clean(params));
export const one = (db, sql, ...params) => stmt(db, sql, ...params).first();
export const all = async (db, sql, ...params) => (await stmt(db, sql, ...params).all()).results;
export const run = (db, sql, ...params) => stmt(db, sql, ...params).run();

export const str = (v) => (v == null ? '' : String(v).trim());
export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export const isUniqueError = (err) => /UNIQUE constraint failed/i.test(String(err?.message || err));
