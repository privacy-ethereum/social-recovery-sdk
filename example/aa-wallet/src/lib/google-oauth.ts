const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CALLBACK_MESSAGE_TYPE = 'aa-wallet-google-oauth-callback';
const DEFAULT_POPUP_WIDTH = 520;
const DEFAULT_POPUP_HEIGHT = 700;
const DEFAULT_TIMEOUT_MS = 120_000;

interface GooglePopupMessage {
  type?: string;
  idToken?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface GoogleIdTokenPopupOptions {
  clientId: string;
  scopes?: string[];
  timeoutMs?: number;
}

export interface GoogleIdTokenPopupResult {
  idToken: string;
  nonce: string;
}

function centerPopupFeatures(width: number, height: number): string {
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
    'toolbar=no',
    'menubar=no',
    'location=yes',
    'status=no',
  ].join(',');
}

function toOAuthUrl(params: URLSearchParams): string {
  return `${GOOGLE_OAUTH_URL}?${params.toString()}`;
}

function randomToken(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export async function requestGoogleIdTokenPopup(
  options: GoogleIdTokenPopupOptions,
): Promise<GoogleIdTokenPopupResult> {
  if (typeof window === 'undefined') {
    throw new Error('Google OAuth requires a browser environment.');
  }

  const clientId = options.clientId.trim();
  if (!clientId) {
    throw new Error('Google OAuth client ID is missing.');
  }

  const scopes = (options.scopes && options.scopes.length > 0 ? options.scopes : ['openid', 'email']).join(' ');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nonce = randomToken('nonce');
  const state = randomToken('state');
  const redirectUri = new URL('/google-oauth-callback.html', window.location.origin).toString();

  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: scopes,
    nonce,
    state,
    prompt: 'consent',
  });

  const popup = window.open(
    toOAuthUrl(authParams),
    'aa-wallet-google-oauth',
    centerPopupFeatures(DEFAULT_POPUP_WIDTH, DEFAULT_POPUP_HEIGHT),
  );

  if (!popup) {
    throw new Error('Google OAuth popup was blocked. Allow popups and try again.');
  }

  return await new Promise<GoogleIdTokenPopupResult>((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeout);
    };

    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      cleanup();
      fn();
    };

    const onMessage = (event: MessageEvent<GooglePopupMessage>) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!event.data || event.data.type !== GOOGLE_CALLBACK_MESSAGE_TYPE) {
        return;
      }
      if (event.data.state !== state) {
        done(() => reject(new Error('Google OAuth state mismatch.')));
        return;
      }
      if (event.data.error) {
        const errorDescription = event.data.errorDescription || event.data.error;
        done(() => reject(new Error(`Google OAuth failed: ${errorDescription}`)));
        return;
      }
      if (!event.data.idToken) {
        done(() => reject(new Error('Google OAuth did not return an id_token.')));
        return;
      }

      done(() =>
        resolve({
          idToken: event.data.idToken!,
          nonce,
        }),
      );
    };

    const timeout = window.setTimeout(() => {
      done(() => {
        try {
          popup.close();
        } catch (_err) {
          // Ignore and continue.
        }
        reject(new Error('Google OAuth timed out. Please try again.'));
      });
    }, timeoutMs);

    window.addEventListener('message', onMessage);
  });
}
