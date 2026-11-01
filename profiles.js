import {createCredentialController} from './credentials.js';
import {TOKEN_KEYS} from './auth.js';

export const PROFILE_KEY = 'connectionProfiles';
const CONFIG_KEYS = ['clientId','orgId','programId','oauthScopes'];
const LOCAL_KEYS = [...CONFIG_KEYS,'credentialVault','rememberedSecret','rememberSecret'];
const SESSION_KEYS = [...TOKEN_KEYS,'unlockedCredential','legacyCredential'];
export const profilePrefix = id => id ? `profile:${id}:` : '';
export const profileSessionKey = id => `profileSession:${id}`;
const pick = (data, keys) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key,data[key]]));
const emptyProfile = name => ({id:crypto.randomUUID(),name,clientId:'',orgId:'',programId:'',oauthScopes:''});
const label = value => {
    const name = String(value || '').trim();
    if (!name || name.length > 80) throw new Error('Enter a profile name between 1 and 80 characters.');
    return name;
};
export function publicProfiles(state) {
    return {activeProfileId:state.activeProfileId,profiles:state.profiles.map(profile => ({...pick(profile,['id','name',...CONFIG_KEYS])}))};
}
export function createProfileController(storage, generate) {
    let queue=Promise.resolve();
    const controllers=new Map();
    const read = async () => (await storage.local.get([PROFILE_KEY]))[PROFILE_KEY];
    async function cleanupDeleted(state) {
        if(!state.deletedProfileIds?.length)return;
        for(const id of state.deletedProfileIds){
            for(const area of ['local','session']){
                const data=await storage[area].get(null);
                const keys=Object.keys(data).filter(key=>key.startsWith(profilePrefix(id)) || key===profileSessionKey(id));
                if(keys.length)await storage[area].remove(keys);
            }
            controllers.delete(id);
        }
        delete state.deletedProfileIds;
        await storage.local.set({[PROFILE_KEY]:state});
    }
    async function initialize() {
        await storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
        await storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
        let state=await read();
        if (!state) {
            const previous=await storage.local.get(LOCAL_KEYS),session=await storage.session.get(SESSION_KEYS);
            const profile={...emptyProfile(previous.programId ? `Program ${previous.programId}` : 'My program'),...pick(previous,[...CONFIG_KEYS,'credentialVault'])};
            if(previous.rememberedSecret?.secret && !previous.credentialVault)session.legacyCredential=previous.rememberedSecret;
            state={version:1,activeProfileId:profile.id,profiles:[profile]};
            // Keep the legacy keys until both copies are durable. A failed local
            // write leaves the original connection available for a later retry.
            if(Object.keys(session).length)await storage.session.set({[profileSessionKey(profile.id)]:session});
            const local=await storage.local.get(null),preferences={};
            state.legacyPreferenceKeys=Object.keys(local).filter(key=>/^(environmentAlias|environmentOrder|hiddenPipelineEnvironments):/.test(key));
            for(const key of state.legacyPreferenceKeys)preferences[profilePrefix(profile.id)+key]=local[key];
            const previousSession=await storage.session.get(null);
            state.legacySessionCacheKeys=Object.keys(previousSession).filter(key=>key.startsWith('pipelineSnapshot:v1:'));
            try {await storage.local.set({[PROFILE_KEY]:state,...preferences});}
            catch(error){await storage.session.remove(profileSessionKey(profile.id));throw error;}
        }
        // Also finish cleanup after a worker restart interrupted migration.
        if(state.legacyPreferenceKeys || state.legacySessionCacheKeys){
            if(state.legacyPreferenceKeys?.length)await storage.local.remove(state.legacyPreferenceKeys);
            if(state.legacySessionCacheKeys?.length)await storage.session.remove(state.legacySessionCacheKeys);
            delete state.legacyPreferenceKeys;delete state.legacySessionCacheKeys;
            await storage.local.set({[PROFILE_KEY]:state});
        }
        await cleanupDeleted(state);
        await storage.local.remove(LOCAL_KEYS);
        await storage.session.remove(SESSION_KEYS);
        return state;
    }
    function scopedStorage(id) {
        const area = name => ({
            get:async keys => {
                const data=name==='local' ? (await read()).profiles.find(p=>p.id===id) : (await storage.session.get([profileSessionKey(id)]))[profileSessionKey(id)] || {};
                if(!data)throw new Error('Program profile no longer exists.');
                return structuredClone(keys == null ? data : pick(data,keys));
            },
            set:async values => {
                if(name==='local'){
                    const state=await read(),profile=state.profiles.find(p=>p.id===id);
                    if(!profile)throw new Error('Program profile no longer exists.');
                    Object.assign(profile,values);await storage.local.set({[PROFILE_KEY]:state});
                }else{
                    const key=profileSessionKey(id),data=(await storage.session.get([key]))[key] || {};
                    await storage.session.set({[key]:{...data,...values}});
                }
            },
            remove:async keys => {
                keys=Array.isArray(keys)?keys:[keys];
                if(name==='local'){
                    const state=await read(),profile=state.profiles.find(p=>p.id===id);
                    if(!profile)throw new Error('Program profile no longer exists.');
                    const changed=keys.some(key=>key in profile);
                    for(const key of keys)delete profile[key];
                    if(changed)await storage.local.set({[PROFILE_KEY]:state});
                }else{
                    const key=profileSessionKey(id),data=(await storage.session.get([key]))[key];
                    if(!data)return;
                    for(const key of keys)delete data[key];
                    if(Object.keys(data).length)await storage.session.set({[key]:data});else await storage.session.remove(key);
                }
            },
            setAccessLevel:async value=>storage[name].setAccessLevel(value)
        });
        return {local:area('local'),session:area('session')};
    }
    async function handle(message) {
        const state=await initialize();
        if(message.action==='listProfiles')return publicProfiles(state);
        if(message.action==='addProfile'){
            if(state.profiles.length>=20)throw new Error('You can save up to 20 program profiles.');
            const profile=emptyProfile(label(message.name));
            state.profiles.push(profile);state.activeProfileId=profile.id;
            await storage.local.set({[PROFILE_KEY]:state});return publicProfiles(state);
        }
        const id=message.profileId || message.config?.profileId || state.activeProfileId;
        const profile=state.profiles.find(p=>p.id===id);
        if(!profile)throw new Error('Program profile no longer exists. Add or select a profile in Settings.');
        if(message.action==='selectProfile'){
            state.activeProfileId=id;await storage.local.set({[PROFILE_KEY]:state});return publicProfiles(state);
        }
        if(id!==state.activeProfileId)throw new Error('Active program profile changed. Select it again before continuing.');
        if(message.action==='renameProfile'){
            profile.name=label(message.name);await storage.local.set({[PROFILE_KEY]:state});return publicProfiles(state);
        }
        if(message.action==='deleteProfile'){
            state.profiles=state.profiles.filter(p=>p.id!==id);state.activeProfileId=state.profiles[0]?.id || '';
            state.deletedProfileIds=[...(state.deletedProfileIds || []),id];
            // Commit the deletion before cleanup so late writes can detect it.
            // The tombstone lets startup finish cleanup after an interruption.
            await storage.local.set({[PROFILE_KEY]:state});
            await cleanupDeleted(state);return publicProfiles(state);
        }
        if(!controllers.has(id))controllers.set(id,createCredentialController(scopedStorage(id),generate));
        return controllers.get(id)(message);
    }
    return message => {
        const result=queue.then(()=>handle(message));
        queue=result.catch(()=>{});return result;
    };
}

export async function profileCommand(action, extra={}) {
    let timer;
    try{
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Program operation timed out after 45 seconds. Reload to check the selected program and operation result before retrying.')),45000);});
        const result=await Promise.race([chrome.runtime.sendMessage({type:'credentials',action,...extra}),deadline]);
        if(!result?.ok)throw new Error(result?.error || 'Program profiles are unavailable. Reload the extension and try again.');
        return result.data;
    }finally{clearTimeout(timer);}
}
export function fillProfileSelect(select,state) {
    select.replaceChildren();
    for(const profile of state.profiles){
        const option=document.createElement('option');option.value=profile.id;
        option.textContent=`${profile.name}${profile.programId ? ` · ${profile.programId}` : ' · Not connected'}${profile.orgId ? ` · ${profile.orgId}` : ''}`;
        select.append(option);
    }
    if(!state.profiles.length){const option=document.createElement('option');option.value='';option.textContent='Add a program in Settings';select.append(option);}
    select.value=state.activeProfileId;
}

export async function saveProfilePreference(config,key,value,storage=chrome.storage.local) {
    if(config.profileId){
        if(!key.startsWith(profilePrefix(config.profileId)))throw new Error('Unexpected program preference key.');
        const state=(await storage.get([PROFILE_KEY]))[PROFILE_KEY];
        if(state?.activeProfileId!==config.profileId)throw new Error('Active program changed. Refresh before saving preferences.');
    }
    await storage.set({[key]:value});
    if(config.profileId){
        const state=(await storage.get([PROFILE_KEY]))[PROFILE_KEY];
        if(!state?.profiles.some(profile=>profile.id===config.profileId))await storage.remove(key);
    }
}
