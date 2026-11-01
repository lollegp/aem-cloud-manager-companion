// Share in-flight reads only. Never cache variable responses or replay writes.
export function createReadQueue(limit = 6) {
    const pending = new Map(), waiting = [];
    let active = 0;
    function drain() {
        while (active < limit && waiting.length) {
            const next = waiting.shift();
            active++;
            Promise.resolve().then(next.work).then(next.resolve,next.reject).finally(() => {
                active--;pending.delete(next.key);drain();
            });
        }
    }
    return (key, work) => {
        if (pending.has(key)) return pending.get(key);
        let resolve,reject;
        const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
        pending.set(key,promise);waiting.push({key,work,resolve,reject});drain();
        return promise;
    };
}
