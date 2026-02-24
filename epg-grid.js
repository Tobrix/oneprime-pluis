let selectedEpgDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // Formát YYYYMMDD

const PX_PER_MIN = 5; // Měřítko
const EPG_SIDEBAR_WIDTH = 220;

const epgCache = {}; // Zde budou uložena data: epgCache['YYYYMMDD'][channelId]

async function preloadAllDays() {
    const daysToLoad = [];
    const now = new Date();
    
    // Vygenerujeme pole 3 dnů (včera, dnes, zítra)
    for (let i = -1; i <= 1; i++) {
        const d = new Date();
        d.setDate(now.getDate() + i);
        const dStr = d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0');
        daysToLoad.push(dStr);
        if (!epgCache[dStr]) epgCache[dStr] = {};
    }

    const channels = document.querySelectorAll('.channel-item');
    
    // Spustíme stahování pro všechny kombinace den + kanál
    // Používáme Promise.all, aby to běželo paralelně
    for (const day of daysToLoad) {
        channels.forEach(ch => {
            const id = ch.getAttribute('data-id');
            // Stahujeme jen pokud to už v cache náhodou nemáme
            if (!epgCache[day][id]) {
                fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${day}`)
                    .then(res => res.json())
                    .then(data => {
                        epgCache[day][id] = data;
                        // Pokud je to aktuálně vybraný den, rovnou to vykresli do mřížky
                        if (selectedEpgDate === day) {
                            renderRowFromCache(id, data);
                        }
                    })
                    .catch(err => console.error(`Chyba prefetch pro ${id} na den ${day}`, err));
            }        
        });
    }
}



// Pomocná funkce pro získání dnešního data ve formátu YYYYMMDD pro porovnávání
function getTodayStr() {
    const now = new Date();
    return now.getFullYear() + 
           (now.getMonth() + 1).toString().padStart(2, '0') + 
           now.getDate().toString().padStart(2, '0');
}

document.getElementById('epg-grid-btn').onclick = (e) => {
    e.stopPropagation();
    const overlay = document.getElementById('epg-grid-overlay');
    
    if (overlay.classList.contains('show')) {
        closeEPG();
    } else {
        // --- PŘIDÁNO: Zavřeme ostatní menu před otevřením EPG ---
        if (typeof closeQualityMenu === 'function') closeQualityMenu();
        if (typeof closeVolumeMenu === 'function') closeVolumeMenu();
        
        // Pokud máš definovaný detailsWrapper v globálním měřítku (nebo ho najdi):
        const details = document.getElementById('program-details-wrapper');
        if (details) details.classList.add('collapsed');
        
        openEPG();
    }
};

document.getElementById('close-epg-grid').onclick = () => {
    closeEPG();
};

function renderEPGGrid() {
    const scrollArea = document.querySelector('.epg-grid-scroll-area');
    const rowContainer = document.getElementById('epg-rows-container');
    const timeTrack = document.getElementById('epg-time-track');
    
    // 1. ZÍSKÁNÍ A SEŘAZENÍ KANÁLŮ (Oblíbené nahoru)
    const channelElements = Array.from(document.querySelectorAll('.channel-item'));
    channelElements.sort((a, b) => {
        const idA = a.getAttribute('data-id');
        const idB = b.getAttribute('data-id');
        const favA = (typeof favorites !== 'undefined' && favorites.includes(idA)) ? 1 : 0;
        const favB = (typeof favorites !== 'undefined' && favorites.includes(idB)) ? 1 : 0;
        return favB - favA; 
    });
    
    // 2. ČASOVÁ OSA (horní lišta)
    timeTrack.innerHTML = '';
    const spacer = document.createElement('div');
    spacer.className = 'epg-time-spacer';
    spacer.style.minWidth = `${EPG_SIDEBAR_WIDTH}px`; 
    timeTrack.appendChild(spacer);

    for(let i = 0; i < 24; i++) {
        const hourStr = i.toString().padStart(2, '0');
        
        // Celá hodina
        const h00 = document.createElement('div');
        h00.className = 'epg-hour main-hour';
        h00.innerText = `${hourStr}:00`;
        timeTrack.appendChild(h00);

        // Půlhodina
        const h30 = document.createElement('div');
        h30.className = 'epg-hour';
        h30.innerText = `${hourStr}:30`;
        timeTrack.appendChild(h30);
    }

    // 3. VYKRESLENÍ ŘÁDKŮ (podle seřazeného pole)
    // Vymažeme kontejner, aby se řádky vykreslily v novém pořadí (oblíbené nahoře)
    rowContainer.innerHTML = '';

    channelElements.forEach(ch => {
        const id = ch.getAttribute('data-id');
        const name = ch.querySelector('.channel-name').innerText;
        const logo = ch.querySelector('img').src;

        const isFav = (typeof favorites !== 'undefined' && favorites.includes(id));

        const row = document.createElement('div');
        row.className = 'epg-row';
        row.setAttribute('data-channel-id', id);

        // Zvýraznění aktivního kanálu (červený proužek)
        if (typeof currentActiveChannelId !== 'undefined' && currentActiveChannelId === id) {
            row.classList.add('active-row-highlight');
        }

        row.innerHTML = `
            <div class="epg-channel-sticky" style="width: ${EPG_SIDEBAR_WIDTH}px; position: sticky; left: 0; z-index: 100; background: #1a1a1a; border-right: 1px solid rgba(255,255,255,0.2);">
                
                <span class="fav-btn-epg ${isFav ? 'active' : ''}" 
                    onclick="toggleFavorite('${id}', event)">
                    ★
                </span>

                <div style="display: flex; align-items: center; height: 100%; padding: 0 15px;">
                    <img src="${logo}" style="margin-right: 15px; flex-shrink: 0; width: 30px; height: 30px; object-fit: contain;"> 
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; font-size: 13px;">${name}</span>
                </div>
            </div>

            <div class="epg-programs-row" id="grid-row-${id}" style="width: 7200px; position: relative;"></div>
        `;
        
        rowContainer.appendChild(row);
        fetchAndRenderRow(id);
    });

    updateNowLine();
}

function scrollEPGToNow() {
    const now = new Date();
    const scrollArea = document.querySelector('.epg-grid-scroll-area');
    if (!scrollArea) return;

    const scrollPos = (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN;
    const offset = scrollArea.offsetWidth * 0.3; 

    scrollArea.scrollTo({
        left: scrollPos - offset,
        behavior: 'smooth'
    });
}

async function fetchAndRenderRow(id) {
    // 1. KONTROLA CACHE - Pokud už data máme, vykresli je a dál nepokračuj
    if (epgCache[selectedEpgDate] && epgCache[selectedEpgDate][id]) {
        renderRowFromCache(id, epgCache[selectedEpgDate][id]);
        return;
    }

    // 2. FETCH - Pokud data v cache nejsou, stáhni je
    try {
        const response = await fetch(`/epg-data?id=${encodeURIComponent(id)}&full=true&date=${selectedEpgDate}`);
        const programs = await response.json();
        
        // Ulož stažená data do cache pro příště
        if (!epgCache[selectedEpgDate]) epgCache[selectedEpgDate] = {};
        epgCache[selectedEpgDate][id] = programs;

        renderRowFromCache(id, programs);
    } catch(e) { 
        console.error("Chyba při načítání řádku:", e); 
    }
}

function renderRowFromCache(id, programs) {
    const rowWrapper = document.getElementById(`grid-row-${id}`);
    if (!rowWrapper) return;

    rowWrapper.innerHTML = ''; // Vyčistit řádek před vykreslením

    if (!Array.isArray(programs) || programs.length === 0) {
        rowWrapper.innerHTML = '<span style="color: #444; font-size: 11px; padding: 20px; display: block;">Program není k dispozici</span>';
        return;
    }

    // 1. PŘÍPRAVA ČASOVÝCH MANTINELŮ PRO ZOBRAZENÝ DEN
    const year = parseInt(selectedEpgDate.substring(0, 4));
    const month = parseInt(selectedEpgDate.substring(4, 6)) - 1;
    const day = parseInt(selectedEpgDate.substring(6, 8));
    
    // Půlnoc (00:00:00) dne, který v mřížce právě prohlížíme
    const gridDateMidnight = new Date(year, month, day, 0, 0, 0, 0);
    // Půlnoc následujícího dne (konec mřížky)
    const gridDateNextMidnight = new Date(gridDateMidnight.getTime() + 24 * 60 * 60 * 1000);
    
    const nowTime = new Date();

    // Seřadit podle času
    programs.sort((a, b) => parseEPGDate(a.start) - parseEPGDate(b.start));

    programs.forEach(prog => {
        const start = parseEPGDate(prog.start);
        const stop = parseEPGDate(prog.stop);
        if (!start || !stop) return;

        // 2. FILTR: Zobrazíme pořad pouze pokud aspoň částečně zasahuje do vybraného dne
        // (končí po začátku dnešní mřížky A ZÁROVEŇ začíná před jejím koncem)
        if (!(stop > gridDateMidnight && start < gridDateNextMidnight)) return;

        // 3. VÝPOČET MINUT RELATIVNĚ K PŮLNOCI VYBRANÉHO DNE
        // Tímto získáme pozici v minutách (např. -60 pro pořad začínající hodinu před půlnocí)
        let startMins = Math.floor((start - gridDateMidnight) / (1000 * 60));
        let stopMins = Math.floor((stop - gridDateMidnight) / (1000 * 60));

        // 4. VIZUÁLNÍ OŘEZY PRO MŘÍŽKU (0 až 1440 minut)
        let drawStart = Math.max(0, startMins);
        let drawStop = Math.min(1440, stopMins);

        // Pokud po ořezu pořad v tomto dni nemá žádnou délku, přeskočíme
        if (drawStop <= drawStart) return;

        const box = document.createElement('div');
        box.className = 'epg-box';

        // Stavy pořadu
        const isLiveNow = nowTime >= start && nowTime <= stop;
        const isPast = stop < nowTime; 
        
        let isCurrentlyWatching = false;
        if (currentActiveChannelId === id) {
            if (isArchiveMode && currentArchiveData) {
                isCurrentlyWatching = (prog.start === currentArchiveData.start);
            } else if (!isArchiveMode && isLiveNow) {
                isCurrentlyWatching = true;
            }
        }

        if (isLiveNow) box.classList.add('active');
        else if (isPast) box.classList.add('past');
        if (isCurrentlyWatching) box.classList.add('watching');

        // Nastavení pozice a šířky
        box.style.left = `${drawStart * PX_PER_MIN}px`;
        box.style.width = `${(drawStop - drawStart) * PX_PER_MIN - 2}px`; 

        box.innerHTML = `
            <span class="title" title="${prog.title}">${prog.title}</span>
            <span class="time">${formatEPGTime(start)} - ${formatEPGTime(stop)}</span>
        `;

        // --- NÁHLEDOVÉ OKNO PŘI NAJETÍ MYŠÍ ---
        box.onmouseenter = (e) => {
            document.body.classList.add('epg-open');
            const popup = document.getElementById('epg-preview-popup');
            if (!popup) return;

            const pTimeBadge = document.querySelector('.preview-time-badge');
            const pImg = document.getElementById('preview-img');
            const pTitle = document.getElementById('preview-title');
            const pTime = document.getElementById('preview-time');
            const pDesc = document.getElementById('preview-desc');

            if (stop < nowTime) {
                pTimeBadge.style.background = "rgba(80, 80, 80, 0.9)";
            } else if (isLiveNow) {
                pTimeBadge.style.background = "rgba(229, 9, 20, 0.9)";
            } else {
                pTimeBadge.style.background = "rgba(0, 120, 255, 0.8)";
            }

            const durationMs = stop - start; 
            const durationMinutes = Math.round(durationMs / 1000 / 60);

            pTitle.innerText = prog.title;
            pTime.innerText = `${formatEPGTime(start)} - ${formatEPGTime(stop)} (${durationMinutes} min)`;
            pDesc.innerText = prog.desc || "Popis není k dispozici.";
            pImg.src = prog.image || 'https://via.placeholder.com/320x180?text=ONEPRIME+TV';

            popup.classList.add('show');
        };

        box.onmouseleave = () => {
            document.body.classList.remove('epg-open');
            const popup = document.getElementById('epg-preview-popup');
            if (popup) popup.classList.remove('show');
        };

        // --- KLIKNUTÍ (Přehrávání) ---
        box.onclick = (e) => {
            e.stopPropagation();
            if (box.classList.contains('active') || box.classList.contains('past')) {
                const channelItem = document.querySelector(`.channel-item[data-id="${id}"]`);
                if (channelItem) {
                    const url = channelItem.getAttribute('data-url');
                    const name = channelItem.querySelector('.channel-name').innerText;
                    const logo = channelItem.querySelector('img').src;
                    
                    const archiveData = {
                        title: prog.title,
                        desc: prog.desc || "Popis není k dispozici.",
                        image: prog.image,
                        start: prog.start,
                        stop: prog.stop
                    };

                    let startTimeUnix = null;
                    if (box.classList.contains('past')) {
                        startTimeUnix = Math.floor(start.getTime() / 1000);
                    }

                    if (typeof playStream === 'function' && url) {
                        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
                        channelItem.classList.add('active');
                        playStream(url, name, logo, id, startTimeUnix, archiveData);
                        
                        document.querySelectorAll('.epg-box.watching').forEach(el => el.classList.remove('watching'));
                        box.classList.add('watching');
                        closeEPG();
                    }
                }
            }
        };
        rowWrapper.appendChild(box);
    });
}

function updateNowLine() {
    const now = new Date();
    let line = document.getElementById('epg-grid-now-line');
    
    // 1. KONTROLA DATA: Pokud nejsme na dnešním datu, čáru schováme
    if (selectedEpgDate !== getTodayStr()) {
        if (line) line.style.display = 'none';
        return;
    } else {
        if (line) line.style.display = 'block';
    }

    // 2. DYNAMICKÉ ZJIŠTĚNÍ POZICE MŘÍŽKY
    // Najdeme první řádek s programy. Jeho offsetLeft nám řekne přesně, 
    // na kterém pixelu začíná čas 00:00, bez ohledu na šířku sidebaru nebo bordery.
    const firstRow = document.querySelector('.epg-programs-row');
    if (!firstRow) return;
    const gridStartPos = firstRow.offsetLeft;

    // 3. STABILNÍ VÝPOČET ČASU (Lokální čas zařízení)
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutesSinceMidnight = (hours * 60) + minutes;

    // 4. VÝPOČET POZICE
    const pos = totalMinutesSinceMidnight * PX_PER_MIN;
    
    const rowContainer = document.getElementById('epg-rows-container');
    if (!rowContainer) return;

    if(!line) {
        line = document.createElement('div');
        line.id = 'epg-grid-now-line';
        rowContainer.appendChild(line);
    }
    
    // 5. FINÁLNÍ UMÍSTĚNÍ: Skutečný začátek mřížky + vypočtené minuty
    line.style.left = `${gridStartPos + pos}px`;
}

setInterval(() => {
    const overlay = document.getElementById('epg-grid-overlay');
    if (overlay && overlay.classList.contains('show')) {
        updateNowLine();
        if (selectedEpgDate === getTodayStr()) {
            scrollEPGToNow(); 
        }
    }
}, 60000);

const epgOverlay = document.getElementById('epg-grid-overlay');

function openEPG() {
    // Pokud hrajeme ARCHIV, nastavíme datum EPG na datum toho archivu
    if (isArchiveMode && currentArchiveData) {
        const archiveStart = parseEPGDate(currentArchiveData.start);
        const year = archiveStart.getFullYear();
        const month = (archiveStart.getMonth() + 1).toString().padStart(2, '0');
        const day = archiveStart.getDate().toString().padStart(2, '0');
        selectedEpgDate = `${year}${month}${day}`;
    } else {
        // Jinak (LIVE) vynutíme dnešek
        selectedEpgDate = getTodayStr();
    }

    renderEPGDays(); 
    epgOverlay.classList.remove('hide');
    epgOverlay.style.display = 'flex'; 
    epgOverlay.classList.add('show');
    renderEPGGrid();
    
    // Počkáme na vykreslení a pak srolujeme na to, co hraje
    setTimeout(() => {
        scrollToCurrentlyWatching(true); 
    }, 10); // Může být i kratší čas
}

function scrollToCurrentlyWatching(isInstant = false) {
    const scrollArea = document.querySelector('.epg-grid-scroll-area');
    if (!scrollArea) return;

    const now = new Date();
    const todayStr = getTodayStr(); // Dnešní datum YYYYMMDD
    
    let targetTime = new Date(); 
    let playingDateStr = todayStr;

    // 1. Zjistíme, co reálně hraje (zda archiv nebo live)
    if (isArchiveMode && currentArchiveData) {
        const archiveStart = parseEPGDate(currentArchiveData.start);
        const year = archiveStart.getFullYear();
        const month = (archiveStart.getMonth() + 1).toString().padStart(2, '0');
        const day = archiveStart.getDate().toString().padStart(2, '0');
        playingDateStr = `${year}${month}${day}`;
        targetTime = archiveStart;
    }

    // 2. VÝPOČET VODOROVNÉ POZICE (X)
    let targetLeft = scrollArea.scrollLeft;
    
    if (selectedEpgDate === playingDateStr) {
        // Shoda: Zobrazený den v EPG je stejný jako den pořadu v přehrávači
        const minutes = targetTime.getHours() * 60 + targetTime.getMinutes();
        targetLeft = (minutes * PX_PER_MIN) - (scrollArea.offsetWidth * 0.3);
    } 
    else if (selectedEpgDate === todayStr) {
        // Není shoda, ale koukáme na DNEŠEK: Posuneme na aktuální čas (Live čáru)
        const minutesNow = now.getHours() * 60 + now.getMinutes();
        targetLeft = (minutesNow * PX_PER_MIN) - (scrollArea.offsetWidth * 0.3);
    }

    // 3. VÝPOČET SVISLÉ POZICE (Y)
    let targetTop = scrollArea.scrollTop;
    if (currentActiveChannelId) {
        const activeRowElement = document.getElementById(`grid-row-${currentActiveChannelId}`);
        if (activeRowElement) {
            const rowWrapper = activeRowElement.closest('.epg-row');
            if (rowWrapper) {
                const rowTop = rowWrapper.offsetTop;
                const rowHeight = rowWrapper.offsetHeight;
                const areaHeight = scrollArea.offsetHeight;
                targetTop = rowTop - (areaHeight / 2) + (rowHeight / 2);
            }
        }
    }

    // Provedeme skok nebo plynulý posun
    scrollArea.scrollTo({
        left: targetLeft,
        top: targetTop,
        behavior: 'instant'
    });

    scrollArea.style.opacity = '1';
}

function closeEPG() {
    const overlay = document.getElementById('epg-grid-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        overlay.classList.add('hide');
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.classList.remove('hide');
        }, 300);
    }
}

window.addEventListener('click', (e) => {
    if (epgOverlay && epgOverlay.classList.contains('show') && !epgOverlay.contains(e.target) && e.target.id !== 'epg-grid-btn') {
        closeEPG();
    }
});

function renderEPGDays() {
    const container = document.getElementById('epg-days-container');
    if (!container) return;
    container.innerHTML = '';

    const daysShort = ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO'];
    const now = new Date();

    // Vygenerujeme dny: včera, dnes, zítra
    for (let i = -1; i <= 1; i++) {
        const d = new Date();
        d.setDate(now.getDate() + i);
        const dStr = d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0');

        const dayItem = document.createElement('div');
        dayItem.className = `epg-day-item ${selectedEpgDate === dStr ? 'active' : ''}`;
        
        dayItem.onclick = (e) => {
            e.stopPropagation();
            selectedEpgDate = dStr;
            document.querySelectorAll('.epg-day-item').forEach(el => el.classList.remove('active'));
            dayItem.classList.add('active');
            
            renderEPGGrid(); 

            setTimeout(() => {
                const todayStr = getTodayStr();
                let playingDateStr = todayStr;
                if (isArchiveMode && currentArchiveData) {
                    const archDT = parseEPGDate(currentArchiveData.start);
                    playingDateStr = archDT.getFullYear() + 
                                     (archDT.getMonth() + 1).toString().padStart(2, '0') + 
                                     archDT.getDate().toString().padStart(2, '0');
                }

                if (selectedEpgDate === playingDateStr || selectedEpgDate === todayStr) {
                    // Posun na čas (vlevo/vpravo) i na kanál (nahoru/dolů)
                    scrollToCurrentlyWatching();
                } else {
                    // POSUN POUZE NA KANÁL (Svisle), ale vodorovně na 0:00
                    const scrollArea = document.querySelector('.epg-grid-scroll-area');
                    if (scrollArea) {
                        let targetTop = scrollArea.scrollTop;

                        // Výpočet svislé pozice (Y) pro aktuální kanál i pro jiné dny
                        if (currentActiveChannelId) {
                            const activeRowElement = document.getElementById(`grid-row-${currentActiveChannelId}`);
                            if (activeRowElement) {
                                const rowWrapper = activeRowElement.closest('.epg-row');
                                if (rowWrapper) {
                                    const rowTop = rowWrapper.offsetTop;
                                    const rowHeight = rowWrapper.offsetHeight;
                                    const areaHeight = scrollArea.offsetHeight;
                                    targetTop = rowTop - (areaHeight / 2) + (rowHeight / 2);
                                }
                            }
                        }

                        scrollArea.scrollTo({ 
                            left: 0, 
                            top: targetTop, // Tady je ta oprava - skočí to na správný řádek
                            behavior: 'instant' 
                        });
                        scrollArea.style.opacity = '1';
                    }
                }
            }, 10);
        };

        dayItem.innerHTML = `
            <span class="day-name">${i === 0 ? 'Dnes' : daysShort[d.getDay()]}</span>
            <span class="day-date">${d.getDate()}.${d.getMonth() + 1}.</span>
        `;
        container.appendChild(dayItem);
    }

}

