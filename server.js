const fastify = require('fastify')({ logger: false });
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');

// Registrace CORS a statických souborů
fastify.register(require('@fastify/cors'), { origin: "*" });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, ''), 
    prefix: '/', 
});

let cachedEpg = [];

// Funkce pro aktualizaci EPG
async function updateEpg() {
    try {
        console.log('⏳ Stahuji EPG data...');
        const response = await axios.get('http://94.241.90.115:8889/epg');
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);
        
        if (result.tv && result.tv.programme) {
            cachedEpg = result.tv.programme;
            const formatDate = (s) => `${s.substring(0,4)}-${s.substring(4,6)}-${s.substring(6,8)}`;
            const rawDays = cachedEpg.map(p => p.$.start.substring(0, 8));
            const uniqueDays = [...new Set(rawDays)].sort();
            
            console.log(`✅ EPG aktualizováno (${cachedEpg.length} pořadů)`);
            uniqueDays.forEach(day => console.log(`   👉 ${formatDate(day)}`));
        }
    } catch (err) {
        console.error('❌ Chyba EPG:', err.message);
    }
}

// Interval pro EPG (každou hodinu)
setInterval(updateEpg, 60 * 60 * 1000); 
updateEpg();

// Endpoint pro získání EPG dat
fastify.get('/epg-data', async (request, reply) => {
    const queryId = decodeURIComponent(request.query.id);
    const isFull = request.query.full === 'true';
    const queryDate = request.query.date; 
    
    if (!queryId || cachedEpg.length === 0) {
        return isFull ? [] : { title: "Program není k dispozici" };
    }

    const channelProgrammes = cachedEpg.filter(p => p.$.channel === queryId);

    const formatProg = (p) => ({
        title: (typeof p.title[0] === 'object') ? p.title[0]._ : p.title[0],
        desc: p.desc ? ((typeof p.desc[0] === 'object') ? p.desc[0]._ : p.desc[0]) : "",
        start: p.$.start,
        stop: p.$.stop,
        image: (p.icon && p.icon[0].$) ? p.icon[0].$.src : ""        
    });

    if (isFull) {
        if (queryDate) {
            const filtered = channelProgrammes.filter(p => {
                const startsToday = p.$.start.startsWith(queryDate);
                const stopsToday = p.$.stop.startsWith(queryDate);
                return startsToday || stopsToday;
            });
            return filtered.map(formatProg);
        }
        return channelProgrammes.map(formatProg);
    }

    const now = new Date();
    const czTime = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(now);

    const t = {};
    czTime.forEach(({type, value}) => t[type] = value);
    const nowStr = `${t.year}${t.month}${t.day}${t.hour}${t.minute}${t.second}`;

    const current = channelProgrammes.find(p => {
        const start = p.$.start.split(' ')[0];
        const stop = p.$.stop.split(' ')[0];
        return nowStr >= start && nowStr <= stop;
    });

    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (current) {
        return formatProg(current);
    } else {
        const upcoming = channelProgrammes.find(p => p.$.start.split(' ')[0] > nowStr);
        return upcoming ? formatProg(upcoming) : { title: "Program není k dispozici" };
    }
});

// --- PROXY SEKCE SE STABILIZACÍ PRO IOS ---

// Proxy pro /oneplay
fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/oneplay',
    replyOptions: { 
        rewriteRequestHeaders: (req, headers) => ({ 
            ...headers, 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
            'host': '94.241.90.115:8889',
            'connection': 'keep-alive' 
        }),
        getUpstream: (req, base) => base,
        undici: {
            bodyTimeout: 0,    // Nekonečný timeout pro data (klíčové pro iOS)
            headersTimeout: 0, 
            keepAliveTimeout: 60000 
        }
    }
});

// Proxy pro /play
fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/play',
    replyOptions: { 
        rewriteRequestHeaders: (req, headers) => ({ 
            ...headers, 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
            'host': '94.241.90.115:8889',
            'connection': 'keep-alive'
        }),
        undici: {
            bodyTimeout: 0,
            headersTimeout: 0,
            keepAliveTimeout: 60000
        }
    }
});

// Start serveru
const start = async () => {
    try {
        const port = process.env.PORT || 3000;
        await fastify.listen({ port: parseInt(port), host: '0.0.0.0' });
        console.log(`🚀 Server běží na portu ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
