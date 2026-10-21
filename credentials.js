import {encryptSecret, decryptSecret} from './vault.js';
import {generateAccessToken, TOKEN_KEYS} from './auth.js';

const CONFIG_KEYS = ['clientId', 'orgId', 'programId', 'oauthScopes'];
const LEGACY_KEYS = ['unlockedCredential', 'legacyCredential'];
const sameIdentity = (a, b) => a?.clientId === b?.clientId && a?.orgId === b?.orgId;
const configFrom = data => Object.fromEntries(CONFIG_KEYS.map(key => [key, String(data?.[key] || '').trim()]));
function validate(config) {
    if (!config.clientId || !config.orgId || !config.programId) throw new Error('Enter Client ID, Organization ID, and Program ID.');
}

// One worker queue serializes saves, token renewals, and deletion. Queued callers
// reuse a freshly generated token rather than exchanging the secret again.
export function createCredentialController(storage, generate = generateAccessToken) {
    let queue = Promise.resolve(), renewalFailure;
    async function initialize() {
        await storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
        await storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
        const old = await storage.local.get(['rememberedSecret', 'rememberSecret', 'credentialVault']);
        if (old.rememberedSecret?.secret && !old.credentialVault) {
            await storage.session.set({legacyCredential: old.rememberedSecret});
        }
        await storage.local.remove(['rememberedSecret', 'rememberSecret']);
    }
    async function handle(message) {
        await initialize();
        const local = await storage.local.get([...CONFIG_KEYS, 'credentialVault']);
        const session = await storage.session.get([...TOKEN_KEYS, ...LEGACY_KEYS]);
        const vault = local.credentialVault, previous = configFrom(local);
        const config = configFrom(message.config);
        const legacy = session.legacyCredential || (vault?.version === 1 && session.unlockedCredential?.id === vault.id ? session.unlockedCredential : null);
        const savedSecret = async identity => {
            if (!vault || !sameIdentity(vault, identity)) throw new Error('Enter and save a matching Adobe Client Secret in Settings to enable automatic renewal.');
            return decryptSecret(vault);
        };
        const storeToken = async result => {
            // Replace metadata atomically with the token; manual tokens use expiry 0.
            const bound = {token: result.token, tokenClientId: config.clientId, tokenOrgId: config.orgId, tokenExpiresAt: result.tokenExpiresAt || 0};
            await storage.session.set(bound);
            renewalFailure = undefined;
            return bound;
        };
        switch (message.action) {
            case 'status':
                return {saved: vault?.version === 2, passwordProtected: vault?.version === 1,
                    clientId: vault?.clientId, orgId: vault?.orgId, migrationPending: !!legacy};
            case 'saveVault': {
                if (message.consent !== true) throw new Error('Explicit consent is required to save a secret on this device.');
                validate(config);
                if (!config.oauthScopes.split(/[\s,]+/).some(Boolean)) throw new Error('Enter the Adobe OAuth scopes before saving credentials for automatic renewal.');
                const secret = message.secret || (sameIdentity(legacy, config) ? legacy.secret : '');
                const record = await encryptSecret(secret, config);
                if (await decryptSecret(record) !== secret) throw new Error('Credential verification failed.');
                if (!sameIdentity(previous, config) || previous.oauthScopes !== config.oauthScopes) await storage.session.remove(TOKEN_KEYS);
                await storage.local.set({...config, credentialVault: record});
                await storage.session.remove(LEGACY_KEYS);
                renewalFailure = undefined;
                return {};
            }
            case 'forget':
                await storage.session.remove([...LEGACY_KEYS, ...TOKEN_KEYS]);
                await storage.local.remove(['credentialVault', 'rememberedSecret', 'rememberSecret']);
                renewalFailure = undefined;
                return {};
            case 'clearToken':
                await storage.session.remove(TOKEN_KEYS);
                renewalFailure = undefined;
                return {};
            case 'saveManual': {
                validate(config);
                const token = String(message.token || '').trim();
                if (!token) throw new Error('Paste an access token, or use Generate access token.');
                if (session.token === token && (previous.clientId !== config.clientId || (session.tokenClientId && session.tokenClientId !== config.clientId))) throw new Error('Client ID changed. Paste a token for this client or generate a new token.');
                if (session.token === token && (previous.orgId !== config.orgId || (session.tokenOrgId && session.tokenOrgId !== config.orgId))) throw new Error('Organization ID changed. Paste a token for this organization or generate a new token.');
                if (!sameIdentity(previous, config)) await storage.session.remove(TOKEN_KEYS);
                await storage.local.set(config);
                await storeToken({token, tokenExpiresAt: session.token === token ? session.tokenExpiresAt : 0});
                return {};
            }
            case 'generate': {
                validate(config);
                const secret = message.secret || await savedSecret(config);
                const result = await generate(config.clientId, secret, config.oauthScopes);
                if (!sameIdentity(previous, config)) await storage.session.remove(TOKEN_KEYS);
                await storage.local.set(config);
                await storeToken(result);
                return {};
            }
            case 'ensureToken': {
                validate(config);
                if (CONFIG_KEYS.some(key => config[key] !== previous[key])) throw new Error('Connection changed. Refresh the extension and try again.');
                const fresh = session.token && (!session.tokenExpiresAt || Date.now() < session.tokenExpiresAt - 30000);
                const matches = (!session.tokenClientId || session.tokenClientId === config.clientId) && (!session.tokenOrgId || session.tokenOrgId === config.orgId);
                if (fresh && matches && session.token !== message.rejectedToken) return Object.fromEntries(TOKEN_KEYS.map(key => [key, session[key]]));
                const failureKey = JSON.stringify([config, vault?.id]);
                if (renewalFailure?.key === failureKey && Date.now() < renewalFailure.until) throw new Error(renewalFailure.message);
                try {
                    const secret = await savedSecret(config);
                    return await storeToken(await generate(config.clientId, secret, config.oauthScopes));
                } catch (error) {
                    renewalFailure = {key: failureKey, until: Date.now() + 30000, message: error.message};
                    throw error;
                }
            }
            default: throw new Error('Unknown credential operation.');
        }
    }
    return message => {
        const result = queue.then(() => handle(message));
        queue = result.catch(() => {});
        return result;
    };
}
