// Saved progress (fur colour, records, unlocks): one JSON blob in localStorage under 'canopy-progress'.
// Every storage access is wrapped: in a private window / blocked storage it silently keeps an in-memory copy.
const KEY = 'canopy-progress', V = 1;
let data = { v: V };

export function load() {
  try { const s = localStorage.getItem(KEY); const d = s ? JSON.parse(s) : null; if (d && typeof d === 'object') data = { ...d, v: V }; } catch (e) {}
  return data;
}
export const get = (key, def) => (data[key] === undefined ? def : data[key]);
export function set(key, val) { data[key] = val; return val; }
export function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; } }

load();
