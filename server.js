const fastify = require('fastify')({ logger: false });
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path'); // Přidáno pro cesty k souborům

fastify.register(require('@fastify/cors'), { origin: "*" });

fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, ''), 
    prefix: '/', 
});

let cachedEpg = [];

async function updateEpg() {
    try {
        console.log('⏳ Stahuji EPG data...');
        const response = await axios.get('http://94.241.90.115:8889/epg');
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);
        
        if (result.tv && result.tv.programme) {
            cachedEpg = result.tv.programme;
            
            // Pomocná funkce pro tvůj formát YYYY-MM-DD
            const formatDate = (s) => `${s.substring(0,4)}-${s.substring(4,6)}-${s.substring(6,8)}`;

            // Zjistíme unikátní dny v datech
            const rawDays = cachedEpg.map(p => p.$.start.substring(0, 8));
            const uniqueDays = [...new Set(rawDays)].sort();
            
            console.log(`✅ EPG aktualizováno (${cachedEpg.length} pořadů)`);
            console.log(`📅 Dostupná data v souboru:`);
            
            uniqueDays.forEach(day => {
                console.log(`   👉 ${formatDate(day)}`);
            });
            
        }
    } catch (err) {
        console.error('❌ Chyba EPG:', err.message);
    }
}

// Aktualizace každou hodinu
setInterval(updateEpg, 60 * 60 * 1000); 
updateEpg();

fastify.get('/epg-data', async (request, reply) => {
    const queryId = decodeURIComponent(request.query.id);
    const isFull = request.query.full === 'true';
    const queryDate = request.query.date; // Očekává YYYYMMDD
    
    if (!queryId || cachedEpg.length === 0) {
        return isFull ? [] : { title: "Program není k dispozici" };
    }

    // 1. Najdeme VŠECHNY pořady pro daný kanál
    const channelProgrammes = cachedEpg.filter(p => p.$.channel === queryId);

    // Pomocná funkce pro formátování dat z XML
    const formatProg = (p) => ({
        title: (typeof p.title[0] === 'object') ? p.title[0]._ : p.title[0],
        desc: p.desc ? ((typeof p.desc[0] === 'object') ? p.desc[0]._ : p.desc[0]) : "",
        start: p.$.start,
        stop: p.$.stop,
        image: (p.icon && p.icon[0].$) ? p.icon[0].$.src : ""        
    });

    // 2. LOGIKA PRO MŘÍŽKU (isFull)
    // V server.js najdi tuto část:
    if (isFull) {
        if (queryDate) {
            // ZMĚNA: Filtrujeme pořady, které v daný den buď začínají, NEBO v něm končí
            const filtered = channelProgrammes.filter(p => {
                const startsToday = p.$.start.startsWith(queryDate);
                const stopsToday = p.$.stop.startsWith(queryDate);
                return startsToday || stopsToday;
            });
            return filtered.map(formatProg);
        }
        return channelProgrammes.map(formatProg);
    }

    // 3. LOGIKA PRO "PRÁVĚ BĚŽÍ" (Sidebar / Player Info)
    // VYNUCENÍ ČESKÉHO ČASU (i když server běží v cizině)
    const now = new Date();
    const czTime = new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(now);

    const t = {};
    czTime.forEach(({type, value}) => t[type] = value);
    
    // Formát XMLTV: YYYYMMDDHHMMSS
    const nowStr = `${t.year}${t.month}${t.day}${t.hour}${t.minute}${t.second}`;

    const current = channelProgrammes.find(p => {
        // Očistíme start/stop od časových zón (vše po mezeře pryč)
        const start = p.$.start.split(' ')[0];
        const stop = p.$.stop.split(' ')[0];
        return nowStr >= start && nowStr <= stop;
    });

    // PŘIDÁME HLAVIČKU PROTI CACHOVÁNÍ (aby mobil neukazoval stará data)
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (current) {
        return formatProg(current);
    } else {
        // Pokud nenajdeme přesný čas, zkusíme vzít první pořad, který teprve začne
        const upcoming = channelProgrammes.find(p => p.$.start.split(' ')[0] > nowStr);
        return upcoming ? formatProg(upcoming) : { title: "Program není k dispozici" };
    }
});

// Proxy pro streamy se správnými hlavičkami (vynuceno pro Oneplay server)
fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/oneplay',
    replyOptions: { 
        rewriteRequestHeaders: (req, headers) => {
            return { 
                ...headers, 
                // Tady nastavujeme přesně to, co vyžaduje tvůj playlist
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'host': '94.241.90.115:8889'
            };
        } 
    }
});

// Musíme přidat i proxy pro /play/ cestu, kterou používají tvoje URL v playlistu
fastify.register(require('@fastify/http-proxy'), {
    upstream: 'http://94.241.90.115:8889',
    prefix: '/play',
    replyOptions: { 
        rewriteRequestHeaders: (req, headers) => ({ 
            ...headers, 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
            'host': '94.241.90.115:8889'
        }) 
    }
});

// --- KLÍČOVÁ ZMĚNA PRO NORTHFLANK ---
const start = async () => {
    try {
        // Port si vezme z prostředí (Northflank), nebo použije 3000
        const port = process.env.PORT || 3000;
        await fastify.listen({ port: parseInt(port), host: '0.0.0.0' });
        console.log(`🚀 Server běží na portu ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();




