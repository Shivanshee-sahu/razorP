const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
export async function api(path, options = {}) { const res = await fetch(BASE + path, { headers: {'Content-Type':'application/json'}, ...options }); const data = await res.json(); if (!res.ok) throw new Error(data.detail || 'Request failed'); return data; }
