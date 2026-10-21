const TOKEN = 'https://ims-na1.adobelogin.com/ims/token/v3';
export const TOKEN_KEYS = ['token', 'tokenClientId', 'tokenOrgId', 'tokenExpiresAt'];

export async function generateAccessToken(clientId, clientSecret, scopes, {fetcher = fetch, now = Date.now} = {}) {
    clientId = clientId.trim();
    const scope = [...new Set(scopes.split(/[\s,]+/).filter(Boolean))].join(',');
    if (!clientId || !clientSecret.trim() || !scope) throw new Error('Enter Client ID, Client Secret, and the scopes from your Server-to-Server credential.');
    const started = now();
    let response;
    try {
        response = await fetcher(TOKEN, {
            method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope}),
            signal: AbortSignal.timeout(30000)
        });
    } catch { throw new Error('Could not reach Adobe to generate a token. Check your connection and try again.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error(`Adobe returned an unreadable token response (HTTP ${response.status}).`); }
    if (!response.ok) {
        // Do not surface provider response bodies: they can contain submitted credentials.
        if (data?.error === 'invalid_client' || data?.error === 'invalid_client_secret') throw new Error('Adobe rejected the Client ID and Client Secret. Use values from the same OAuth Server-to-Server credential.');
        if (data?.error === 'invalid_scope') throw new Error('Adobe rejected the scopes. Copy the scopes enabled for this Server-to-Server credential.');
        throw new Error(`Adobe token generation failed (HTTP ${response.status}). Check the Server-to-Server credential and its API access.`);
    }
    const expiresAt = started + Number(data?.expires_in) * 1000;
    if (typeof data?.access_token !== 'string' || !data.access_token.trim() || String(data.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(expiresAt) || expiresAt <= started) throw new Error('Adobe returned an invalid token response.');
    return {token: data.access_token, tokenClientId: clientId, tokenExpiresAt: expiresAt};
}
