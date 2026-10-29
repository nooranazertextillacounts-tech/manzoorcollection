export class AuthSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthSessionError';
  }
}

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // Only native wrappers without a local web/api server use the remote defaultBackendUrl
    const isNativeWrapper = origin.startsWith('capacitor://') || origin.startsWith('file://');
    if (!isNativeWrapper) {
      return cleanPath;
    }
  }
  const defaultBackendUrl = "https://ais-pre-v2gbiwkdv54wbq2oajsyt3-715707733413.asia-southeast1.run.app";
  return `${defaultBackendUrl}${cleanPath}`;
}

export async function apiFetch(path: string, options: RequestInit = {}, retries = 2): Promise<any> {
  const url = getApiUrl(path);
  const finalOptions: RequestInit = {
    ...options,
    credentials: 'include' as RequestCredentials,
    headers: {
      ...((options.headers as any) || {}),
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  };
  
  try {
    const res = await fetch(url, finalOptions);
    
    if (!res.ok) {
      if (res.status === 429 && retries > 0) {
        // Wait before retry on 429
        await new Promise(r => setTimeout(r, 1200 * (3 - retries)));
        return apiFetch(path, options, retries - 1);
      }
      let errorText = '';
      try {
        errorText = await res.text();
      } catch (e) {
        errorText = 'Could not read error response';
      }
      
      if (errorText.includes('__cookie_check.html') || errorText.includes('<!doctype html>')) {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 800));
          return apiFetch(path, options, retries - 1);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ais-auth-session-required'));
        }
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
        const msg = isInIframe 
          ? 'Authentication session issue. Please open the app in a new tab using the icon at the top right to authorize your access.' 
          : 'Authentication session expired. Please refresh the page or log in again.';
        throw new AuthSessionError(msg);
      }
      
      throw new Error(`Request failed with status ${res.status}: ${errorText}`);
    }
    
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    } else {
      const text = await res.text();
      if (text.includes('__cookie_check.html') || text.includes('<!doctype html>')) {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 800));
          return apiFetch(path, options, retries - 1);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ais-auth-session-required'));
        }
        const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
        const msg = isInIframe 
          ? 'Authentication session issue. Please open the app in a new tab using the icon at the top right to authorize your access.' 
          : 'Authentication session expired. Please refresh the page or log in again.';
        throw new AuthSessionError(msg);
      }
      throw new Error('Received non-JSON response from server.');
    }
  } catch (err: any) {
    if (err.name === 'AuthSessionError') {
      throw err;
    }
    if (err.message && err.message.includes('429') && retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return apiFetch(path, options, retries - 1);
    }
    throw err;
  }
}
