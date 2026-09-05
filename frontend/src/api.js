const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    // Create a proper error object with structured details
    const error = new Error('Request failed');
    error.status = res.status;
    
    // Extract detail from structured error responses
    if (data.detail) {
      if (typeof data.detail === 'string') {
        error.detail = data.detail;
      } else if (typeof data.detail === 'object') {
        error.detail = data.detail.message || data.detail.code || JSON.stringify(data.detail);
        if (data.detail.code) {
          error.code = data.detail.code;
        }
        if (data.detail.violations) {
          error.violations = data.detail.violations;
        }
      }
    } else if (data.message) {
      error.detail = data.message;
    } else {
      error.detail = 'Request failed';
    }
    
    throw error;
  }
  
  return data;
}
