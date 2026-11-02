const PREFIX = 'backgroundJob:';
// Store only outcome metadata. Request bodies, API responses and provider error
// text can contain credentials or secret variable values and must stay in memory.
export function createJobManager(storage, execute) {
    let active = null, recovery;
    async function records() {
        const values = await storage.get(null);
        return Object.entries(values).filter(([key])=>key.startsWith(PREFIX));
    }
    async function recover() {
        const interrupted = (await records()).filter(([, record]) => record.status === 'running');
        if (interrupted.length) {
            return storage.set(Object.fromEntries(interrupted.map(([key, record]) => [key, {...record, status:'unknown', finishedAt:Date.now()}])));
        }
    }
    function initialize() {
        recovery ||= recover();
        return recovery;
    }
    return {
        busy:()=>!!active,
        async list(profileId) {
            await initialize();
            return (await records()).map(([,value])=>value).filter(value=>value.profileId===profileId).sort((a,b)=>b.startedAt-a.startedAt).slice(0,20);
        },
        async start(job) {
            if (active) {throw new Error('An action is already in progress. Wait for its result before starting another.');}
            if (!/^[a-zA-Z0-9-]{1,80}$/.test(job.id || '')) {throw new Error('Invalid action ID.');}
            active = job.id;
            const key=PREFIX+job.id;
            try {
                await initialize();
                const entries=await records();
                if(entries.some(([existing])=>existing===key)){throw new Error('This action was already submitted. Check its result before retrying.');}
                const old=entries.toSorted((a,b)=>b[1].startedAt-a[1].startedAt).slice(39).map(([id])=>id);
                if(old.length){await storage.remove(old);}
                const record={id:job.id,profileId:job.config?.profileId || '',kind:job.kind,status:'running',startedAt:Date.now()};
                await storage.set({[key]:record});
                try {
                    const result=await execute(job);
                    // Pipeline results contain only safe, locally generated summaries.
                    const outcomes=job.kind==='pipelines' && Array.isArray(result)?result.map(item=>({id:String(item.pipeline.id),ok:item.ok,message:item.ok?item.message:'Failed; refresh pipeline state before retrying.'})):undefined;
                    await storage.set({[key]:{...record,status:outcomes?.some(item=>!item.ok || item.message.startsWith('Skipped:'))?'partial':'completed',finishedAt:Date.now(),...(outcomes?{outcomes}:{})}});
                    return result;
                } catch(error) {
                    await storage.set({[key]:{...record,status:'failed',finishedAt:Date.now()}});
                    throw error;
                }
            } finally {active=null;}
        }
    };
}
