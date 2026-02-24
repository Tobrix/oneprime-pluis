let hls;

let isArchiveMode = false;
let isUserBehind = false; // Pojistka: uživatel ručně skočil zpět
let isFirstLoad = true;
const video = document.getElementById('video');
const videoWrapper = document.getElementById('video-wrapper');
const controlsOverlay = document.getElementById('controls-overlay');

// --- Elementy ---
const playBtn = document.getElementById('play-pause');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeContainer = document.querySelector('.volume-slider-container'); // Nový element
const fullscreenBtn = document.getElementById('fullscreen-btn');

// Progress Bary
const epgBar = document.getElementById('player-epg-bar');       // Červená (Pozice)
const liveBar = document.getElementById('player-live-bar');     // Šedá (Live hrana)
const bufferBar = document.getElementById('player-buffer-bar'); // Bílá/Průhledná (Buffer)
const epgContainer = document.getElementById('player-epg-bar-container');
const hoverTimeIndicator = document.querySelector('.hover-time-indicator');

// --- Elementy moderních indikátorů ---
const indicatorCenter = document.getElementById('indicator-center');
const indicatorLeft = document.getElementById('indicator-left');
const indicatorRight = document.getElementById('indicator-right');
const mainStatusIcon = document.getElementById('main-status-icon');

// Načtení oblíbených z paměti prohlížeče
let favorites = JSON.parse(localStorage.getItem('fav_channels')) || [];

function toggleFavorite(channelId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget) event.currentTarget.blur();
    }

    const index = favorites.indexOf(channelId);
    if (index > -1) {
        favorites.splice(index, 1);
    } else {
        favorites.push(channelId);
    }
    
    localStorage.setItem('fav_channels', JSON.stringify(favorites));
    
    // 1. Překreslí sidebar (to už tam máš)
    loadPlaylist(); 

    // 2. OPRAVA: Pokud je EPG otevřené, překresli ho taky, aby se změnily hvězdičky a pořadí
    const epgOverlay = document.getElementById('epg-grid-overlay');
    if (epgOverlay && epgOverlay.classList.contains('show')) {
        // Voláme tvou funkci z epg.js
        if (typeof renderEPGGrid === 'function') {
            renderEPGGrid(); 
        }
    }
}


// --- POMOCNÉ FUNKCE PRO ČAS ---
function parseEPGDate(t) {
    if (!t) return null;
    const cleanT = t.split(' ')[0]; 
    return new Date(
        cleanT.slice(0,4), 
        parseInt(cleanT.slice(4,6)) - 1, 
        cleanT.slice(6,8), 
        cleanT.slice(8,10), 
        cleanT.slice(10,12),
        cleanT.slice(12,14) || 0
    );
}

function formatEPGTime(s) {
    if (!s) return "--:--";
    const d = (typeof s === 'string') ? parseEPGDate(s) : s;
    return d ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}` : "--:--";
}



// --- LOGIKA SKRÝVÁNÍ OVLÁDÁNÍ (AUTO-HIDE) ---
let inactivityTimeout;

// Příklad úpravy tvé funkce pro schování prvků
function hideControls() {
    const isEpgOpen = document.getElementById('epg-grid-overlay').classList.contains('show');
    const isDescOpen = !document.getElementById('program-details-wrapper').classList.contains('collapsed');
    const isQualityOpen = document.getElementById('quality-dropdown').classList.contains('show');

    // POKUD JE COKOLI OTEVŘENO, KONČÍME A NESCHOVÁVÁME
    if (isEpgOpen || isDescOpen || isQualityOpen) return;

    // ... zde pokračuje tvůj kód, který přidává třídy pro schování ...
    videoWrapper.classList.add('user-inactive');
    controlsOverlay.classList.add('controls-hidden');
}

function showControls() {
    controlsOverlay.classList.remove('controls-hidden');
    videoWrapper.classList.remove('user-inactive');
    videoWrapper.style.cursor = 'default'; 
    resetInactivityTimer();
}

function resetInactivityTimer() {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(hideControls, 3000);
}

videoWrapper.addEventListener('mousemove', showControls);
videoWrapper.addEventListener('mousedown', showControls);
videoWrapper.addEventListener('touchstart', showControls);

// --- MODERNI LOGIKA INDIKÁTORŮ ---
function triggerSideIndicator(side) {
    const el = document.getElementById(`indicator-${side}`);
    if (!el) return;
    el.classList.remove('animating');
    void el.offsetWidth; 
    el.classList.add('animating');
    setTimeout(() => {
        el.classList.remove('animating');
    }, 450);
}

function updateCenterIndicator(iconName, isPaused) {
    if (!mainStatusIcon || !indicatorCenter) return;
    
    mainStatusIcon.setAttribute('data-lucide', iconName);
    
    if (window.lucide) {
        lucide.createIcons();
    }
    
    // 1. Resetujeme předchozí stav a vynutíme restart animace
    indicatorCenter.classList.remove('active');
    void indicatorCenter.offsetWidth; 
    
    // 2. Aktivujeme indikátor
    indicatorCenter.classList.add('active');
    
    // 3. LOGIKA ZMIZENÍ
    if (!isPaused) {
        // Pokud pouštíme video (Play), ikona musí zmizet BLESKOVĚ
        // 100-200ms je ideální pro rychlé probliknutí
        setTimeout(() => {
            if (!video.paused) {
                indicatorCenter.classList.remove('active');
            }
        }, 200); 
    } else {
        // Pokud dáváme pauzu, nic neschováváme, ikona zůstane (active)
        // Dokud se znovu nezavolá updateCenterIndicator s isPaused = false
    }
}

video.addEventListener('play', updateLiveStatus);
video.addEventListener('pause', updateLiveStatus);
video.addEventListener('seeking', updateLiveStatus); // DŮLEŽITÉ: reaguje na pohyb prstu po liště
video.addEventListener('timeupdate', updateLiveStatus);

// --- LOGIKA LIVE / ZÁZNAM (RESTART-ODOLNÁ OPRAVA PRO APPLE) ---
function updateLiveStatus() {
    const statusMsg = document.getElementById('status-msg');
    const statusText = document.getElementById('status-text');
    if (!statusMsg || !statusText) return;

    const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const isPaused = video.paused;
    const isSeeking = video.seeking;
    const diff = video.duration - video.currentTime;

    // 1. POJISTKA PRO APPLE: Pokud jsme blízko konce, uživatel prostě NENÍ pozadu
    // Zvedli jsme toleranci na 15 sekund pro lepší stabilitu na iOS
    if (isApple && isFinite(video.duration) && diff < 15) {
        isUserBehind = false;
    }

    let isBehind = false;
    if (isApple) {
        if (!isFinite(video.duration)) {
            isBehind = isUserBehind; 
        } else {
            // Kombinace času (tolerance 25s) a manuálního posunu
            isBehind = (diff > 25) || isUserBehind;
        }
    } else {
        // Standard PC (tolerance 16s)
        isBehind = (diff > 16);
    }

    // 2. VYHODNOCENÍ - REŽIM ARCHIV
    if (isArchiveMode) {
        statusMsg.classList.add('recording-mode');
        statusText.innerText = 'ARCHIV';
    } 
    // 3. KLÍČOVÁ PRIORITA PRO LIVE (Řeší zaseknutí na iPhonu)
    // Pokud jsme matematicky u konce, ignorujeme vše ostatní a dáváme LIVE
    else if (isFinite(video.duration) && diff < 15) {
        statusMsg.classList.remove('recording-mode');
        statusText.innerText = 'LIVE';
        isUserBehind = false; // Pro jistotu čistíme i zde
    }
    // 4. POKUD NEJSME U KONCE, KONTROLUJEME ZPOŽDĚNÍ NEBO PAUZU
    else if (isBehind || isPaused || (isSeeking && diff > 15)) {
        statusMsg.classList.add('recording-mode');
        statusText.innerText = 'ZÁZNAM';
    } 
    else {
        // Výchozí stav (vše ok, hrajeme živě)
        statusMsg.classList.remove('recording-mode');
        statusText.innerText = 'LIVE';
        isUserBehind = false;
    }
}
// --- OVLÁDÁNÍ VIDEA ---
playBtn.onclick = () => {
    if (video.paused) video.play();
    else video.pause();
};

video.onplay = () => { 
    updatePlayIcon(); 
    resetInactivityTimer();
    updateCenterIndicator('play', false); // Spustí animaci a zmizí
};

video.onpause = () => { 
    updatePlayIcon(); 
    showControls(); 
    clearTimeout(inactivityTimeout);
    updateCenterIndicator('pause', true); // Zůstane svítit (isPaused = true)
};

// --- JEDNOTNÁ LOGIKA KLIKNUTÍ (VIDEO + MENU) ---
// Používáme capture phase (true), aby tento listener zachytil klik dříve než cokoli jiného
controlsOverlay.addEventListener('click', (e) => {
    
    // A. Definice prvků, které mají vlastní funkci (tlačítka, lišty)
    const isControlElement = e.target.closest('.overlay-bottom') || 
                             e.target.closest('.overlay-header') || 
                             e.target.closest('.quality-dropdown') ||
                             e.target.closest('.volume-slider-container') ||
                             e.target.closest('#program-details-wrapper') ||
                             e.target.closest('.epg-grid-container');

    if (isControlElement) return;

    // B. Detekce otevřených oken
    const qualityDropdown = document.getElementById('quality-dropdown');
    const epgOverlay = document.getElementById('epg-grid-overlay');
    const volumeContainer = document.querySelector('.volume-slider-container');
    const detailsWrapper = document.getElementById('program-details-wrapper');

    const isAnyMenuOpen = 
        (qualityDropdown && qualityDropdown.classList.contains('show')) ||
        (epgOverlay && epgOverlay.classList.contains('show')) ||
        (volumeContainer && volumeContainer.classList.contains('show')) ||
        (detailsWrapper && !detailsWrapper.classList.contains('collapsed'));

    // C. KLÍČOVÁ LOGIKA ZAVÍRÁNÍ (Kliknutí na plochu videa, když je menu otevřené)
    if (isAnyMenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); 

        if (qualityDropdown && qualityDropdown.classList.contains('show')) closeQualityMenu();
        if (volumeContainer && volumeContainer.classList.contains('show')) closeVolumeMenu();
        if (epgOverlay && epgOverlay.classList.contains('show')) {
            if (typeof closeEPG === 'function') closeEPG();
        }
        if (detailsWrapper && !detailsWrapper.classList.contains('collapsed')) {
            detailsWrapper.classList.add('collapsed');
            const btn = document.getElementById('show-more-btn');
            if (btn) btn.innerText = 'Zobrazit více';
        }
        
        console.log("Kliknuto na plochu: Zavřeno menu, video nechávám běžet.");
        return; 
    }

    // D. OVLÁDÁNÍ VIDEA (Kliknutí na plochu videa, když je vše zavřené)
    console.log("Kliknuto na plochu: Žádné menu nebylo otevřené, měním stav Play/Pause.");
    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
}, true);

// --- UPRAVENÁ FUNKCE PRO SKOKY (Tlačítka zpět/vpřed) ---
window.ytSkip = (s) => {
    if (!video) return;
    try {
        video.currentTime += s;
        
        // Logika pro iPhone: Pokud skočí zpět, zapne se režim ZÁZNAM
        if (s < 0) {
            isUserBehind = true;
        }
        // Pokud skočí vpřed a je blízko konce, vypne se režim ZÁZNAM
        if (s > 0 && (video.duration - video.currentTime < 20)) {
            isUserBehind = false;
        }
    } catch (e) {
        console.warn("Skok v čase nebylo možné provést:", e);
    }
    
    showControls();
    triggerSideIndicator(s > 0 ? 'right' : 'left');
    updateProgressBars(); 
};

function updatePlayIcon() {
    playBtn.innerHTML = video.paused ? '<i data-lucide="play"></i>' : '<i data-lucide="pause"></i>';
    if (window.lucide) lucide.createIcons();
}

// --- UPRAVENÁ LOGIKA HLASITOSTI ---
// Kliknutí na ikonu teď otevírá menu místo okamžitého Mute


// Změna hlasitosti sliderem
if (volumeSlider) {
    volumeSlider.oninput = (e) => { 
        const val = parseFloat(e.target.value);
        video.volume = val; 
        
        // KLÍČOVÝ FIX PRO IPHONE: Pohyb sliderem vypne ztlumení
        if (val > 0) {
            video.muted = false;
        } else {
            video.muted = true;
        }
        updateVolIcon(); 
    };
}

function updateVolIcon() {
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider'); // Přidáno pro jistotu
    if (!muteBtn) return;

    if (video.muted || video.volume === 0) {
        muteBtn.innerHTML = '<i data-lucide="volume-x"></i>';
        if (volumeSlider) volumeSlider.value = 0; // Kulička doleva
    } else if (video.volume < 0.5) {
        muteBtn.innerHTML = '<i data-lucide="volume-1"></i>';
        if (volumeSlider) volumeSlider.value = video.volume; // Kulička podle hlasitosti
    } else {
        muteBtn.innerHTML = '<i data-lucide="volume-2"></i>';
        if (volumeSlider) volumeSlider.value = video.volume; // Kulička doprava
    }

    if (window.lucide) lucide.createIcons();
}

fullscreenBtn.onclick = (e) => {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    
    // Detekce iPadu (včetně nových iPadů, které se hlásí jako Macintosh)
    const isIPad = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    const isFullScreen = document.fullscreenElement || document.webkitFullscreenElement;

    if (!isFullScreen) {
        // POKUD JE TO IPAD/IPHONE -> VYNUTÍME NATIVNÍ PŘEHRÁVAČ
        if (isIPad && video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        } 
        // PRO OSTATNÍ (PC, Android) -> TVŮJ DESIGN
        else if (videoWrapper.requestFullscreen) {
            videoWrapper.requestFullscreen();
        } else if (videoWrapper.webkitRequestFullscreen) {
            videoWrapper.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
};



// --- OVLÁDÁNÍ KLÁVESNICÍ ---
window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    switch(e.code) {
        case 'Space':
            e.preventDefault();
            // Přímo voláme akci, ne simulaci kliku, pokud to jde
            if (video.paused) video.play(); else video.pause();
            break;
        case 'ArrowRight':
            e.preventDefault();
            ytSkip(10);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            ytSkip(-10);
            break;
        case 'KeyF':
            e.preventDefault();
            // Voláme přímo funkci pro fullscreen
            if (!document.fullscreenElement) {
                videoWrapper.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
            break;
    }
});

// --- SEEKING & HOVER NA ČASOVÉ OSE (Vylepšeno pro stabilní zobrazení na iPhone/iPad) ---

function handleTimelineMove(e) {
    // Zabráníme Safari v cukání stránky při tažení prstem po ose
    if (e.cancelable) e.preventDefault();

    let dStart, dStop;

    // 1. Rozhodování o časech (Archiv vs Live)
    if (isArchiveMode && currentArchiveData) {
        dStart = parseEPGDate(currentArchiveData.start);
        dStop = parseEPGDate(currentArchiveData.stop);
    } else {
        const item = document.querySelector(`.channel-item[data-id="${currentActiveChannelId}"]`);
        if (!item) return;
        dStart = parseEPGDate(item.getAttribute('data-start'));
        dStop = parseEPGDate(item.getAttribute('data-stop'));
    }

    if (!dStart || !dStop) return;

    const rect = epgContainer.getBoundingClientRect();
    
    // Získání přesné souřadnice X (myš nebo dotyk)
    let clientX;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
    } else {
        clientX = e.clientX;
    }

    const pos = (clientX - rect.left) / rect.width;
    const safePos = Math.max(0, Math.min(1, pos));
    
    const totalMs = dStop - dStart;
    const hoverTime = new Date(dStart.getTime() + (totalMs * safePos));

    // Zobrazení indikátoru a nastavení textu
    hoverTimeIndicator.style.display = 'block';
    hoverTimeIndicator.innerText = formatEPGTime(hoverTime);
    
    // Stabilizace pozice: Na mobilu lehce nad prst (-12px), na PC těsně nad osu (-8px)
    if (e.touches) {
        hoverTimeIndicator.style.transform = 'translateX(-50%) translateY(-12px)';
    } else {
        hoverTimeIndicator.style.transform = 'translateX(-50%) translateY(-8px)';
    }
    
    hoverTimeIndicator.style.left = `${safePos * 100}%`;
}

// Události pro PC
epgContainer.addEventListener('mousemove', handleTimelineMove);
epgContainer.addEventListener('mouseleave', () => {
    hoverTimeIndicator.style.display = 'none';
});

// Události pro mobilní zařízení (iPhone/iPad/Android)
// DŮLEŽITÉ: passive: false umožňuje blokovat výchozí chování prohlížeče (cukání)
epgContainer.addEventListener('touchstart', (e) => {
    handleTimelineMove(e);
}, { passive: false });

epgContainer.addEventListener('touchmove', (e) => {
    handleTimelineMove(e);
}, { passive: false });

epgContainer.addEventListener('touchend', () => {
    // Čas zůstane chvíli viset, než zmizí (dobré pro čitelnost na dotyku)
    setTimeout(() => {
        hoverTimeIndicator.style.display = 'none';
    }, 800);
});

// --- PŘEHRÁVAČ ---
let currentActiveChannelId = localStorage.getItem('lastChannelId');

// Upravená funkce playStream v script.js
function playStream(url, name, logo, channelId, startTimeUnix = null, archiveData = null) {
    const loader = document.getElementById('video-loader');
    
    // --- PŘIDÁNO: SKRYTÍ PLAY/PAUSE INDIKÁTORU ---
    const indicatorCenter = document.querySelector('.center-indicator');
    if (indicatorCenter) {
        indicatorCenter.classList.remove('active');
        const content = indicatorCenter.querySelector('.indicator-content');
        if (content) content.style.opacity = "0";
    }

    if (loader) {
        loader.style.display = 'flex';
        const spinner = loader.querySelector('.main-spinner');
        if (spinner) {
            spinner.style.animation = 'none';
            spinner.offsetHeight; 
            spinner.style.animation = null; 
        }
    }

    isUserBehind = false;
    isArchiveMode = !!startTimeUnix;
    currentArchiveData = archiveData;
    currentActiveChannelId = channelId;
    localStorage.setItem('lastChannelId', channelId);
    
    refreshDetailsWindow();

    // UI Aktualizace
    const displayNameEl = document.getElementById('display-name');
    if (displayNameEl) displayNameEl.innerText = name;
    
    const logoEl = document.getElementById('current-logo');
    if (logoEl) {
        logoEl.src = logo;
        logoEl.style.display = 'block';
    }

    // Detekce Apple zařízení
    const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Převedeme URL na tvou proxy
    let finalUrl = url.replace('http://94.241.90.115:8889', '/oneplay');

    // --- LOGIKA PRO ARCHIV (S OPRAVOU PŘECHODŮ) ---
    if (startTimeUnix) {
        let stopTimeUnix;
        if (archiveData && archiveData.stop) {
            stopTimeUnix = Math.floor(parseEPGDate(archiveData.stop).getTime() / 1000);
        } else {
            const activeItem = document.querySelector(`.channel-item[data-id="${channelId}"]`);
            const stopDate = activeItem ? parseEPGDate(activeItem.getAttribute('data-stop')) : new Date();
            stopTimeUnix = Math.floor(stopDate.getTime() / 1000);
        }

        // POJISTKA: Pokud stopTime vyšel stejně nebo dřív než start (půlnoční chyba), 
        // přičteme aspoň hodinu, aby URL bylo validní
        if (stopTimeUnix <= startTimeUnix) {
            stopTimeUnix = startTimeUnix + 3600;
        }

        const separator = finalUrl.includes('?') ? '&' : '?';
        // Přidán &cb= pro vynucení nového požadavku na server (řeší zacyklení stejného pořadu)
        finalUrl = `${finalUrl}${separator}utc=${startTimeUnix}&lutc=${stopTimeUnix}&_t=${Date.now()}`;
    }

    // --- ÚPLNÝ RESET ELEMENTU (Klíčové pro iOS a plynulé přepínání) ---
    video.pause();
    if (!isApple) {
        video.src = ""; 
        video.load();
    }

    if (hls) {
        hls.destroy();
        hls = null;
    }

    // --- ROZCESTNÍK PŘEHRÁVÁNÍ ---
    if (Hls.isSupported() && !isApple) {
        hls = new Hls({
            liveSyncDurationCount: isArchiveMode ? 0 : 3,
            enableWorker: true,
            startLevel: -1,
            manifestLoadingMaxRetry: 15, // Zvýšeno pro lepší stabilitu
            levelLoadingMaxRetry: 15
        });

        hls.loadSource(finalUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().then(() => {
                if (loader) loader.style.display = 'none';
            }).catch(e => {
                console.log("Autoplay blocked, čekám na interakci");
            });
            
            if (typeof updatePlayIcon === 'function') updatePlayIcon();
            if (typeof setupQuality === 'function') setupQuality();
        });

        hls.on(Hls.Events.FRAG_BUFFERED, () => {
            if (loader) loader.style.display = 'none';
        });

    } 
    else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Logika pro Apple (iPhone/Safari)
        video.src = finalUrl;
        video.load();
        video.play().then(() => {
            if (loader) loader.style.display = 'none';
        }).catch(e => console.log("Apple play error:", e));
        
        if (typeof updatePlayIcon === 'function') updatePlayIcon();
    }

    video.onloadedmetadata = () => {
        console.log("Délka streamu načtena:", video.duration);
        if (typeof refreshEpgBar === 'function') refreshEpgBar(); 
    };

    const activeChannelElement = document.querySelector(`.channel-item[data-id="${channelId}"]`);
    if (activeChannelElement) {
        activeChannelElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

// Když se video začne bufferovat (kolečko na iPhonu i PC)
video.onwaiting = () => {
    const loader = document.getElementById('video-loader');
    if (loader) loader.style.display = 'flex';
};

// Když se video opět rozjede
video.onplaying = () => {
    const loader = document.getElementById('video-loader');
    if (loader) loader.style.display = 'none';
};

// DOPLNĚK: Tyto listenery přidejte někam do script.js mimo funkci playStream
// Starají se o to, aby se loader ukázal při každém bufferingu (i během přepínání v archivu)
video.addEventListener('waiting', () => {
    const loader = document.getElementById('video-loader');
    if (loader) loader.style.display = 'flex';
});

video.addEventListener('playing', () => {
    const loader = document.getElementById('video-loader');
    if (loader) loader.style.display = 'none';
});

// Pomocná funkce pro získání řetězce zítřejšího dne YYYYMMDD
function getTomorrowStr(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    const d = new Date(year, month, day);
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + 
           (d.getMonth() + 1).toString().padStart(2, '0') + 
           d.getDate().toString().padStart(2, '0');
}

// --- LOGIKA PŘECHODU MEZI POŘADY (ARCHIV) ---

async function playNextProgram() {
    if (!isArchiveMode || !currentArchiveData || !currentActiveChannelId) return;

    // 1. Získáme čas konce aktuálně dohraného pořadu
    const currentStopDate = parseEPGDate(currentArchiveData.stop);
    const currentStopUnix = Math.floor(currentStopDate.getTime() / 1000);

    // 2. Určíme den, ve kterém budeme hledat následovníka (podle času konce)
    const dayStr = currentStopDate.getFullYear() + 
                   (currentStopDate.getMonth() + 1).toString().padStart(2, '0') + 
                   currentStopDate.getDate().toString().padStart(2, '0');

    console.log(`Hledám další pořad startující v ${formatEPGTime(currentStopDate)} (den: ${dayStr})`);

    // 3. Pokusíme se získat data pro tento den (z cache nebo z API)
    let dayData = epgCache[dayStr] ? epgCache[dayStr][currentActiveChannelId] : null;

    if (!dayData) {
        try {
            console.log("Data pro den nejsou v cache, stahuji z API...");
            // POZOR: Tady si uprav URL podle tvé skutečné cesty k API (např. /api/epg nebo server.php)
            const res = await fetch(`/epg?id=${currentActiveChannelId}&date=${dayStr}`);
            const newData = await res.json();
            if (newData && newData.length > 0) {
                if (!epgCache[dayStr]) epgCache[dayStr] = {};
                epgCache[dayStr][currentActiveChannelId] = newData;
                dayData = newData;
            }
        } catch (e) {
            console.error("Chyba při načítání EPG pro přechod:", e);
        }
    }

    // 4. Najdeme první pořad, který začíná přesně tehdy, kdy předchozí skončil (nebo později)
    if (dayData && Array.isArray(dayData)) {
        const next = dayData.find(p => {
            const pStartUnix = Math.floor(parseEPGDate(p.start).getTime() / 1000);
            // Hledáme pořad, který začíná v čas konce toho starého (tolerance 1 sekunda)
            return pStartUnix >= currentStopUnix;
        });

        if (next) {
            console.log("Nalezen následovník:", next.title, "Start:", next.start);
            executeProgramSwitch(next);
            return;
        }
    }

    // 5. Pokud jsme nenašli nic v aktuálním dni (ani po půlnoci), zkusíme ještě zítřek
    const tomorrowStr = getTomorrowStr(dayStr);
    const nowStr = new Date().getFullYear() + 
                   (new Date().getMonth() + 1).toString().padStart(2, '0') + 
                   new Date().getDate().toString().padStart(2, '0');

    if (parseInt(tomorrowStr) <= parseInt(nowStr)) {
        console.log("V tomto dni nic nezačíná, zkouším načíst zítřek...");
        // Zde by se mohla funkce zavolat rekurzivně pro tomorrowStr, 
        // ale pro stabilitu raději přepneme na LIVE, pokud archiv nenavazuje
    }

    console.log("Žádný další pořad v archivu nenalezen, vracím se na LIVE.");
    const activeCh = document.querySelector('.channel-item.active');
    if (activeCh) activeCh.click();
}
// Pomocná funkce pro samotné přepnutí s kompletními daty
function executeProgramSwitch(nextProg) {
    const channelEl = document.querySelector(`.channel-item[data-id="${currentActiveChannelId}"]`);
    if (!channelEl) return;

    const url = channelEl.getAttribute('data-url');
    const name = channelEl.querySelector('.channel-name').innerText;
    const logo = channelEl.querySelector('img').src;

    // Přidáno ID a sjednocení struktury pro refreshDetailsWindow
    const nextArchiveData = {
        id: nextProg.id || null, 
        title: nextProg.title,
        desc: nextProg.desc || "Popis není k dispozici.",
        image: nextProg.image,
        start: nextProg.start,
        stop: nextProg.stop
    };

    const startTimeUnix = Math.floor(parseEPGDate(nextProg.start).getTime() / 1000);
    
    console.log(`Automatické přepnutí na: ${nextProg.title}`);
    currentArchiveData = nextProg;
    playStream(url, name, logo, currentActiveChannelId, startTimeUnix, nextArchiveData);
}

// --- SJEDNOCENÁ LOGIKA LOADERU (BUFFERING) ---

const handleLoading = (show) => {
    const loader = document.getElementById('video-loader');
    if (!loader) return;
    
    if (show) {
        // Loader ukážeme jen pokud video není manuálně pozastaveno
        if (!video.paused || isFirstLoad) {
            loader.style.display = 'flex';
        }
    } else {
        loader.style.display = 'none';
        isFirstLoad = false;
    }
};

video.addEventListener('waiting', () => handleLoading(true));
video.addEventListener('playing', () => handleLoading(false));
video.addEventListener('loadstart', () => handleLoading(true));
video.addEventListener('canplay', () => handleLoading(false));

// --- EVENT PRO KONEC VIDEA ---

video.addEventListener('ended', () => {
    console.log("Pořad skončil.");
    if (isArchiveMode) {
        playNextProgram();
    } else {
        console.log("Live stream ukončen (výpadek?), restartuji...");
        const activeCh = document.querySelector('.channel-item.active');
        if (activeCh) activeCh.click();
    }
});

let currentArchiveData = null; // Zde budeme mít info o vybraném pořadu z archivu

function updateProgressBars() {
    const now = new Date();
    const activeItem = document.querySelector(`.channel-item[data-id="${currentActiveChannelId}"]`);

    // 1. AKTUALIZACE SIDEBARU (Seznam kanálů vpravo) - Beze změny
    document.querySelectorAll('.channel-item').forEach(item => {
        const start = parseEPGDate(item.getAttribute('data-start'));
        const stop = parseEPGDate(item.getAttribute('data-stop'));
        
        if (start && stop) {
            const total = stop - start;
            const elapsedLive = now - start;
            let percentLive = Math.max(0, Math.min(100, (elapsedLive / total) * 100));
            
            const miniBar = item.querySelector('.epg-bar-inner');
            if (miniBar) miniBar.style.width = percentLive + '%';
            
            if (percentLive >= 100 && !isArchiveMode) {
                fetchEPG(item.getAttribute('data-id'));
            }
        }
    });

    // 2. DATA PRO HLAVNÍ PŘEHRÁVAČ (Timeline pod videem)
    let dTitle, dStart, dStop;

    if (isArchiveMode && currentArchiveData) {
        dTitle = currentArchiveData.title;
        dStart = parseEPGDate(currentArchiveData.start);
        dStop = parseEPGDate(currentArchiveData.stop);
    } else if (activeItem) {
        dTitle = activeItem.getAttribute('data-title');
        dStart = parseEPGDate(activeItem.getAttribute('data-start'));
        dStop = parseEPGDate(activeItem.getAttribute('data-stop'));
    }

    if (dTitle && dStart && dStop) {
        const totalDurationMs = dStop - dStart;
        
        // Aktualizace titulku pořadu
        const mainTitleEl = document.getElementById('current-program-title');
        if (mainTitleEl && mainTitleEl.innerText !== dTitle) {
            mainTitleEl.innerText = dTitle;
        }

        // --- NASTAVENÍ FIXNÍCH ČASŮ (MANTINELY POŘADU) ---
        const startTimeEl = document.getElementById('epg-start-time');
        const stopTimeEl = document.getElementById('epg-stop-time');

        // Vlevo bude vždy čas začátku pořadu (např. 16:35)
        if (startTimeEl) startTimeEl.innerText = formatEPGTime(dStart);
        // Vpravo bude vždy čas konce pořadu (např. 17:35)
        if (stopTimeEl) stopTimeEl.innerText = formatEPGTime(dStop);

        if (isArchiveMode) {
            // --- REŽIM ARCHIV ---
            const finalPercent = (video.duration > 0) ? (video.currentTime / video.duration) * 100 : 0;
            if (epgBar) epgBar.style.width = finalPercent + '%';
            if (liveBar) liveBar.style.width = '100%';
            
            // Poznámka: startTimeEl už neaktualizujeme podle currentTime, zůstává dStart
        } else {
            // --- REŽIM LIVE (S FIXEM PRO PAUZU A IPHONE) ---
            const elapsedFromStartToNow = now - dStart;
            const percentLiveEdge = Math.max(0, Math.min(100, (elapsedFromStartToNow / totalDurationMs) * 100));
            
            let liveEdge = 0;
            if (video.seekable && video.seekable.length > 0) {
                liveEdge = video.seekable.end(0);
            } else if (hls && hls.liveSyncPosition) {
                liveEdge = hls.liveSyncPosition;
            } else {
                liveEdge = video.duration;
            }

            let finalPercent;
            if (isFinite(liveEdge) && liveEdge > 0) {
                const secondsBehind = liveEdge - video.currentTime;
                const myActualPosMs = elapsedFromStartToNow - (secondsBehind * 1000);
                finalPercent = Math.max(0, Math.min(percentLiveEdge, (myActualPosMs / totalDurationMs) * 100));
            } else {
                finalPercent = percentLiveEdge;
            }

            // Červená čára s kuličkou (skutečná pozice videa)
            if (epgBar) epgBar.style.width = finalPercent + '%';
            // Šedá čára (kde je reálný čas v TV)
            if (liveBar) liveBar.style.width = percentLiveEdge + '%';
            
            // Poznámka: startTimeEl už neaktualizujeme podle kuličky, zůstává dStart
        }
    }

    if (typeof updateLiveStatus === 'function') updateLiveStatus();
}

// DOPLNĚK: Přidej tyto dva řádky hned pod funkci, aby timeline reagovala okamžitě
video.addEventListener('seeked', updateProgressBars);
video.addEventListener('timeupdate', updateProgressBars);

// Pomocná funkce pro formátování vteřin na 00:00
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- LOGIKA PRO KLIKNUTÍ NA TIMELINE (SEEKING) ---
function handleSeek(e) {
    // Zabráníme Safari, aby při dotyku na lištu scrollovalo stránku
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    const activeItem = document.querySelector(`.channel-item[data-id="${currentActiveChannelId}"]`);
    
    // FIX PRO APPLE: Odstraněna podmínka "duration === Infinity"
    if (!activeItem || (!video.currentTime && video.currentTime !== 0)) return;

    const rect = epgContainer.getBoundingClientRect();
    // Podpora pro myš (clientX) i dotyk na iPhone (touches[0].clientX)
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pos = (clientX - rect.left) / rect.width; 
    const safePos = Math.max(0, Math.min(1, pos));
    
    // --- OPRAVA PRO IPHONE (isUserBehind) ---
    // Pokud uživatel klikne na více než 96 % délky lišty, považujeme to za návrat do LIVE.
    // Jinak (kliknutí dozadu) natvrdo aktivujeme stav ZÁZNAM.
    if (safePos > 0.96) {
        isUserBehind = false;
    } else {
        isUserBehind = true;
    }

    if (isArchiveMode) {
        // V ARCHIVU: Pokud duration je Infinity, zkusíme aspoň posun podle currentTime
        if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration * safePos;
        }
    } else {
        // LIVE REŽIM - Výpočet zpoždění od živého vysílání
        const start = parseEPGDate(activeItem.getAttribute('data-start'));
        const stop = parseEPGDate(activeItem.getAttribute('data-stop'));
        
        if (start && stop) {
            const totalDurationMs = stop - start;
            const targetTimeMs = start.getTime() + (totalDurationMs * safePos);
            const nowMs = Date.now();
            const secondsBehindLive = (nowMs - targetTimeMs) / 1000;

            // Zjištění živého konce (Live Edge)
            let livePoint = 0;
            if (video.seekable && video.seekable.length > 0) {
                // Pro Apple (Safari) je nejstabilnější seekable.end
                livePoint = video.seekable.end(0);
            } else if (hls && hls.liveSyncPosition) {
                // Pro PC (Hls.js)
                livePoint = hls.liveSyncPosition;
            } else {
                livePoint = video.duration;
            }

            // Samotný skok v čase
            if (isFinite(livePoint)) {
                video.currentTime = Math.max(0, livePoint - secondsBehindLive);
            } else {
                // Pokud vše selže (iPhone s velmi specifickým streamem), 
                // zkusíme skok relativně k aktuálnímu času
                const currentDiff = (nowMs - (start.getTime() + (totalDurationMs * (video.currentTime / video.duration)))) / 1000;
                video.currentTime = video.currentTime + (currentDiff - secondsBehindLive);
            }
        }
    }
    
    // Vynutíme okamžitou aktualizaci nápisu LIVE/ZÁZNAM
    if (typeof updateLiveStatus === 'function') updateLiveStatus();
    
    showControls();
}

// Navázání událostí: mousedown pro PC, touchstart pro iPhone/iPad
epgContainer.addEventListener('mousedown', handleSeek);
epgContainer.addEventListener('touchstart', handleSeek, { passive: false });
// Odstraníme starý epgContainer.onclick, aby se to netlouklo
epgContainer.onclick = null;

function refreshEpgBar() {
    // Jednoduše přesměrujeme na hlavní funkci, která je už odladěná
    updateProgressBars();
}

let userSelectedQuality = -1; // Defaultně Auto

function setupQuality() {
    const qualList = document.getElementById('quality-options-list');
    const label = document.getElementById('current-quality-label');
    if (!qualList) return;
    
    qualList.innerHTML = '';
    
    // Detekce Apple zařízení (iPhone, iPad, Safari na Macu)
    const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // SPECIÁLNÍ LOGIKA PRO APPLE (Kde hls.js levels nefungují)
    if (isApple || !hls || !hls.levels || hls.levels.length === 0) {
        const d = document.createElement('div');
        d.className = 'quality-option active';
        // Na iOS si kvalitu řídí systém sám automaticky
        d.innerHTML = `<span>Automaticky (iOS)</span> <i data-lucide="check" style="width:16px; margin-left:8px;"></i>`;
        qualList.appendChild(d);
        
        if (label) label.innerText = 'Auto';
        if (window.lucide) lucide.createIcons();
        return; // Ukončíme funkci, zbytek pro PC se neprovede
    }

    // LOGIKA PRO PC / ANDROID (Kde hls.js levels fungují)
    const seenHeights = new Set();
    const activeSelection = userSelectedQuality; 

    const addOption = (text, index) => {
        const d = document.createElement('div'); 
        d.className = 'quality-option'; 
        
        if (index === activeSelection) {
            d.classList.add('active');
            d.innerHTML = `<span>${text}</span> <i data-lucide="check" style="width:16px; margin-left:8px;"></i>`;
        } else {
            d.innerText = text;
        }

        d.onclick = (e) => {
            e.stopPropagation();
            
            // 1. Uložíme volbu do proměnné
            userSelectedQuality = index;
            
            // 2. Nastavíme HLS přehrávač
            hls.currentLevel = index; 
            hls.loadLevel = index;

            // 3. Aktualizujeme text tlačítka
            if (label) label.innerText = text;
            
            // 4. Překreslíme menu a zavřeme
            setupQuality(); 
            setTimeout(closeQualityMenu, 200);
        };
        qualList.appendChild(d);
    };

    // 1. Auto volba
    addOption('Auto', -1);

    // 2. Jednotlivá rozlišení (od nejvyššího)
    const sortedLevels = [...hls.levels].reverse();
    const originalCount = hls.levels.length - 1;

    sortedLevels.forEach((level, index) => {
        const realIndex = originalCount - index;
        const h = level.height;

        if (!seenHeights.has(h)) {
            addOption(h + 'p', realIndex);
            seenHeights.add(h);
        }
    });

    if (window.lucide) lucide.createIcons();
}



function closeAllPopups() {
    // 1. Zavřeme Zvuk
    const volumeContainer = document.querySelector('.volume-slider-container');
    if (volumeContainer && volumeContainer.classList.contains('show')) {
        closeVolumeMenu();
    }
    
    // 2. Zavřeme Rozlišení
    const qualDropdown = document.getElementById('quality-dropdown');
    if (qualDropdown && qualDropdown.classList.contains('show')) {
        closeQualityMenu();
    }
    
    // 3. Zavřeme EPG overlay (mřížku)
    const epgOverlay = document.getElementById('epg-grid-overlay');
    if (epgOverlay && epgOverlay.classList.contains('show')) {
        if (typeof closeEPG === 'function') closeEPG();
    }
    
    // 4. Zavřeme Informace o pořadu (volitelné - podle toho, kdo funkci volá)
    const detailsWrapper = document.getElementById('program-details-wrapper');
    if (detailsWrapper && !detailsWrapper.classList.contains('collapsed')) {
        detailsWrapper.classList.add('collapsed');
        const btn = document.getElementById('show-more-btn');
        if (btn) btn.innerText = 'Zobrazit více';
    }
}

function closeVolumeMenu() {
    if (!volumeContainer.classList.contains('show')) return;
    volumeContainer.classList.remove('show');
    volumeContainer.classList.add('hide');
    setTimeout(() => {
        volumeContainer.classList.remove('hide');
        // volumeContainer.style.display = 'none'; // Raději odstraň, pokud používáš show/hide v CSS
    }, 300);
}

function closeQualityMenu() {
    if (!qualDropdown.classList.contains('show')) return;
    qualDropdown.classList.remove('show');
    qualDropdown.classList.add('hide');
    setTimeout(() => {
        qualDropdown.classList.remove('hide');
    }, 300);
}
function updateQualityBadge() {
    const badge = document.getElementById('quality-badge');
    // Pokud není přehrávač připraven, badge schováme
    if (!hls || hls.currentLevel === -1 || !hls.levels[hls.currentLevel] || !badge) {
        // badge.style.display = 'none'; // Volitelně schovat, když není info
        return;
    }

    const h = hls.levels[hls.currentLevel].height;
    badge.style.display = 'inline-block';

    if (h >= 1080) {
        badge.innerText = 'FULL HD';
        badge.style.background = '#e50914'; // Červená pro 1080p
    } else if (h >= 720) {
        badge.innerText = 'HD';
        badge.style.background = '#2ecc71'; // Zelená pro 720p
    } else {
        badge.innerText = 'SD';
        badge.style.background = '#95a5a6'; // Šedá pro SD
    }
}

// DŮLEŽITÉ: Tuto funkci musíš volat v intervalu (např. v tom, co už máš pro progress bar)
setInterval(() => {
    updateProgressBars();
    updateQualityBadge(); // Přidej to sem!
}, 500);

async function fetchEPG(id) {
    try {
        const response = await fetch(`/epg-data?id=${encodeURIComponent(id)}`);
        const data = await response.json();
        
        // Najdeme prvek v sidebaru
        const item = document.querySelector(`.channel-item[data-id="${id}"]`);
        
        if (item && data.title) {
            // 1. Aktualizace dat v atributech (pro výpočty progress baru)
            item.setAttribute('data-start', data.start);
            item.setAttribute('data-stop', data.stop);
            item.setAttribute('data-title', data.title);
            item.setAttribute('data-desc', data.desc || "Popis není k dispozici.");
            item.setAttribute('data-img', data.image || "");

            // 2. KLÍČOVÁ OPRAVA: Přepsání textu v sidebaru
            const epgNowEl = item.querySelector('.epg-now');
            if (epgNowEl) {
                epgNowEl.innerText = data.title;
            }

            // 3. Aktualizace přehrávače, pokud tento kanál právě běží
            if (id === currentActiveChannelId && !isArchiveMode) {
                const mainTitleEl = document.getElementById('current-program-title');
                if (mainTitleEl) mainTitleEl.innerText = data.title;
                
                const stopTimeEl = document.getElementById('epg-stop-time');
                if (stopTimeEl) stopTimeEl.innerText = formatEPGTime(data.stop);
            }
        }
    } catch (e) { 
        console.error("EPG Update Error pro " + id, e); 
    }
}



async function loadPlaylist() {
    try {
        const res = await fetch('playlist.m3u');
        const text = await res.text();
        const lines = text.split('\n');
        const cont = document.getElementById('channels-container');
        cont.innerHTML = '';
        
        let channelsData = [];

        // 1. Nejdříve načteme data do pole (abychom mohli řadit podle oblíbených)
        for(let i=0; i<lines.length; i++) {
            if(lines[i].startsWith('#EXTINF')) {
                const nameMatch = lines[i].match(/tvg-name="([^"]+)"/) || [null, lines[i].split(',')[1]];
                const idMatch = lines[i].match(/tvg-id="([^"]+)"/);
                const logoMatch = lines[i].match(/tvg-logo="([^"]+)"/);
                const name = nameMatch[1]?.trim();
                const id = idMatch ? idMatch[1] : name;
                const logo = logoMatch ? logoMatch[1] : '';
                let url = '';
                for(let j=i+1; j<lines.length; j++) { if(lines[j].startsWith('http')) { url = lines[j].trim(); break; } }
                
                if(url) {
                    channelsData.push({ id, name, logo, url });
                }
            }
        }

        // 2. Seřadíme: Oblíbené nahoru (používá tvoji globální proměnnou favorites)
        channelsData.sort((a, b) => {
            const aFav = favorites.includes(a.id) ? 1 : 0;
            const bFav = favorites.includes(b.id) ? 1 : 0;
            return bFav - aFav;
        });

        // 3. Vykreslíme seřazené kanály
        channelsData.forEach(ch => {
            const isFav = favorites.includes(ch.id);
            const el = document.createElement('div');
            el.className = 'channel-item';

            if (ch.id === currentActiveChannelId) {
                    el.classList.add('active');
                }

            el.setAttribute('data-id', ch.id);
            el.setAttribute('data-url', ch.url);
            
            // Tady je ten vtip: Přidal jsem hvězdičku do tvého původního innerHTML
            el.innerHTML = `
                <i data-lucide="star" class="fav-btn ${isFav ? 'active' : ''}" 
                   onclick="toggleFavorite('${ch.id}', event)"></i>
                <img src="${ch.logo}" onerror="this.src='https://via.placeholder.com/50?text=TV'">
                <div class="channel-info">
                    <span class="channel-name">${ch.name}</span>
                    <span class="epg-now">Načítám...</span>
                    <div class="epg-mini-progress"><div class="epg-bar-inner"></div></div>
                </div>`;

            el.onclick = (e) => {
                if (e.target.closest('.fav-btn')) {
                    return; 
                }
                const epgOverlay = document.getElementById('epg-grid-overlay');
                if (epgOverlay && epgOverlay.classList.contains('show')) {
                    if (typeof closeEPG === 'function') closeEPG();
                    e.stopPropagation();
                    return;
                }
                document.querySelectorAll('.channel-item').forEach(x => x.classList.remove('active'));
                el.classList.add('active');
                playStream(ch.url, ch.name, ch.logo, ch.id);
            };

            cont.appendChild(el);
            if(ch.id) fetchEPG(ch.id);
        });

        // DŮLEŽITÉ: Inicializace ikon po vykreslení
        if (window.lucide) lucide.createIcons();

        const lastId = localStorage.getItem('lastChannelId');
        if (lastId && isFirstLoad) { // Přidána podmínka isFirstLoad
            const lastEl = document.querySelector(`.channel-item[data-id="${lastId}"]`);
            if (lastEl) {
                setTimeout(() => {
                    lastEl.click();
                    isFirstLoad = false; // Po prvním kliku vypneme, aby to dál neblikalo
                }, 100);
            }
        } else {
            isFirstLoad = false; // Pro jistotu vypnout i když lastId není
        }
    } catch(e) { console.log("Playlist error", e); }
}

if (currentActiveChannelId) {
    const lastEl = document.querySelector(`.channel-item[data-id="${currentActiveChannelId}"]`);
    if (lastEl) {
        // Simulujeme kliknutí na poslední kanál pro spuštění obrazu
        lastEl.click();
    }
}

const qualBtn = document.getElementById('quality-btn');
const qualDropdown = document.getElementById('quality-dropdown');

if (qualBtn) {
    qualBtn.onclick = (e) => {
        e.stopPropagation();

        // Pokud je menu už otevřené, zavřeme ho
        if (qualDropdown.classList.contains('show')) {
            closeQualityMenu();
        } else {
            // 1. NEJDŮLEŽITĚJŠÍ: Před zobrazením menu vygenerujeme aktuální seznam kvalit
            if (typeof setupQuality === 'function') {
                setupQuality();
            }

            // 2. Zavřeme ostatní vyskakovací okna, aby se nepřekrývala
            // Zvuk
            const volumeContainer = document.querySelector('.volume-slider-container');
            if (volumeContainer) volumeContainer.classList.remove('show');

            // Detaily pořadu
            const detailsWrapper = document.getElementById('program-details-wrapper');
            const showMoreBtn = document.getElementById('show-more-btn');
            if (detailsWrapper) detailsWrapper.classList.add('collapsed');
            if (showMoreBtn) showMoreBtn.innerText = 'Zobrazit více';

            // EPG mřížka
            if (typeof closeEPG === 'function') {
                const epgOverlay = document.getElementById('epg-grid-overlay');
                if (epgOverlay && epgOverlay.classList.contains('show')) {
                    closeEPG();
                }
            }

            // 3. Nakonec menu zobrazíme
            qualDropdown.classList.remove('hide');
            qualDropdown.classList.add('show');
        }
    };
}

// Obsluha tlačítka (včetně otevírání menu a odmutování)
if (muteBtn) {
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        
        // Pokud je video ztlumené (časté po auto-startu na iOS),
        // první kliknutí na ikonu zvuk zapne (unmute).
        if (video.muted) {
            video.muted = false;
            if (video.volume === 0) {
                video.volume = 0.5;
            }
               if (volumeSlider) volumeSlider.value = video.volume; 
            updateVolIcon();
            return; // Důležité: po zapnutí zvuku menu hned neotvíráme, nebo naopak otevřeme? 
                    // Pokud chceš jen zapnout zvuk bez otevření slideru, nech zde return.
        }

        if (volumeContainer.classList.contains('show')) {
            closeVolumeMenu();
        } else {
            // Zavřeme vše ostatní, než otevřeme Zvuk
            if (qualDropdown) qualDropdown.classList.remove('show');
            const detailsWrapper = document.getElementById('program-details-wrapper');
            if (detailsWrapper) detailsWrapper.classList.add('collapsed');
            const showMoreBtn = document.getElementById('show-more-btn');
            if (showMoreBtn) showMoreBtn.innerText = 'Zobrazit více';
            
            if (typeof closeEPG === 'function') {
                 const epgOverlay = document.getElementById('epg-grid-overlay');
                 if (epgOverlay && epgOverlay.classList.contains('show')) closeEPG();
            }
            volumeContainer.classList.add('show');
        }
    };
}

function filterChannels() {
    const query = document.getElementById('search-box').value.toLowerCase();
    const items = document.querySelectorAll('.channel-item');
    items.forEach(item => {
        const name = item.querySelector('.channel-name').innerText.toLowerCase();
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

// Ovládání vysouvání popisu pořadu
const showMoreBtn = document.getElementById('show-more-btn');
const detailsWrapper = document.getElementById('program-details-wrapper');

if (showMoreBtn) {
    showMoreBtn.onclick = (e) => {
        e.stopPropagation();
        const detailsWrapper = document.getElementById('program-details-wrapper');
        const programDesc = document.getElementById('program-desc');
        const isCollapsed = detailsWrapper.classList.contains('collapsed');
        
        if (isCollapsed) {
            /* --- NOVINKA: ZAVŘENÍ OSTATNÍCH OKEN --- */
            // Zavřeme zvuk
            if (volumeContainer) volumeContainer.classList.remove('show');
            
            // Zavřeme rozlišení
            if (qualDropdown) qualDropdown.classList.remove('show');
            
            // Zavřeme EPG mřížku (pokud existuje funkce closeEPG)
            const epgOverlay = document.getElementById('epg-grid-overlay');
            if (epgOverlay && epgOverlay.classList.contains('show')) {
                if (typeof closeEPG === 'function') closeEPG();
            }
            /* --------------------------------------- */

            const activeItem = document.querySelector('.channel-item.active');
            if (activeItem) {
                // ZÍSKÁNÍ DAT
                const desc = isArchiveMode ? currentArchiveData.desc : activeItem.getAttribute('data-desc');
                const img = isArchiveMode ? currentArchiveData.image : (activeItem.getAttribute('data-img') || activeItem.getAttribute('data-image'));
                const start = isArchiveMode ? currentArchiveData.start : activeItem.getAttribute('data-start');
                const stop = isArchiveMode ? currentArchiveData.stop : activeItem.getAttribute('data-stop');
                const finalImg = (img && img !== "") ? img : 'https://via.placeholder.com/320x180?text=Sledujte+Nyní';
                
                // DYNAMICKÁ TVORBA OBSAHU
                const startTime = parseEPGDate(start);
                const stopTime = parseEPGDate(stop);
                const now = new Date();
                
                let badgeColor = "rgba(0, 120, 255, 0.8)"; // Budoucnost
                if (stopTime < now) badgeColor = "rgba(80, 80, 80, 0.9)"; // Archiv
                else if (startTime <= now && stopTime >= now) badgeColor = "rgba(229, 9, 20, 0.9)"; // Live

                const durationMinutes = Math.round((stopTime - startTime) / 1000 / 60);

                // Vstříkneme HTML strukturu
                programDesc.innerHTML = `
                    <div class="preview-content-horizontal">
                        <div class="preview-image-container-new">
                            <img id="details-program-img" src="${finalImg}" alt="Program image">
                            <div class="preview-time-badge" style="background: ${badgeColor}">
                                ${formatEPGTime(startTime)} - ${formatEPGTime(stopTime)} (${durationMinutes} min)
                            </div>
                        </div>
                        <div class="preview-info">
                            <div id="details-program-text">${desc || "Popis není k dispozici."}</div>
                        </div>
                    </div>
                `;
            }

            detailsWrapper.classList.remove('collapsed');
            showMoreBtn.innerText = 'Zobrazit méně';
        } else {
            detailsWrapper.classList.add('collapsed');
            showMoreBtn.innerText = 'Více informací';
        }
    };
}

function refreshDetailsWindow() {
    const detailsWrapper = document.getElementById('program-details-wrapper');
    // Pokud je okno zavřené, nic neděláme
    if (!detailsWrapper || detailsWrapper.classList.contains('collapsed')) return;

    // Pokud je otevřené, simulujeme kliknutí, aby se data přenačetla
    // Nebo sem přesuň tu logiku s programDesc.innerHTML
    const showMoreBtn = document.getElementById('show-more-btn');
    if (showMoreBtn) {
        // Tímto trikem vynutíme překreslení obsahu
        detailsWrapper.classList.add('collapsed'); // Na moment zavřít
        showMoreBtn.click(); // Znovu otevřít s novými daty
    }
}

setInterval(updateProgressBars, 1000);
// --- INICIALIZACE PŘI STARTU ---
// Toto přidej úplně dolů k loadPlaylist()
document.addEventListener('DOMContentLoaded', () => {
    updateVolIcon(); // Nastaví správnou ikonu (x nebo vlny)
    if (volumeSlider) {
        // Nastaví slider podle toho, jestli video začíná jako muted
        volumeSlider.value = video.muted ? 0 : video.volume;
    }
    loadPlaylist();
});


































