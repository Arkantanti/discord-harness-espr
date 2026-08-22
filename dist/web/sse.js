import { bus } from '../bus.js';
const clients = new Set();
export function handleSse(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    res.on('close', () => clients.delete(res));
}
function broadcast(type, data) {
    const line = `data: ${JSON.stringify({ type, ...data })}\n\n`;
    for (const res of clients) {
        try {
            res.write(line);
        }
        catch {
            clients.delete(res);
        }
    }
}
export function initSse() {
    bus.on('event', (ev) => broadcast('event', { event: ev }));
    bus.on('agent_status', (s) => broadcast('agent_status', s));
    setInterval(() => {
        for (const res of clients) {
            try {
                res.write(': ping\n\n');
            }
            catch {
                clients.delete(res);
            }
        }
    }, 25_000).unref();
}
//# sourceMappingURL=sse.js.map