// CONFIGURAZIONE MOCKAPI - Inserisci qui l'URL del tuo progetto MockAPI
const MOCKAPI_BASE_URL = "https://6a5a87fdad8332e75f029048.mockapi.io";
// Owner dell'app: eredita una-tantum i vecchi dati condivisi (record unico) sul
// proprio account quando si passa ai dati separati per-account.
const LEGACY_DATA_OWNER_EMAIL = "marta.giuliana.ag@gmail.com";
// Ipotizzando gli endpoint: /socialchat_data (per posts, chats, communities) e /database_utenti (per i login)

const initialMockData = {
    chats: [],
    contacts: [], 
    posts: [
        { 
            id: "101", 
            author: "Marta - Social Chat", 
            title: "Benvenuti su SocialChat!", 
            description: "Questo è il canale bacheca ufficiale. I messaggi inviati nelle vostre chat verranno rimossi automaticamente dopo 50 giorni dal sistema per garantire la massima riservatezza.", 
            file: null, 
            likes: 0, 
            likedBy: [],
            comments: []
        }
    ],
    communities: [],
    user: {
        id: 'me',
        name: 'Alessandro',
        bio: 'Sviluppatore appassionato di tecnologia 💻',
        photo: 'https://i.pravatar.cc/150?img=0',
        email: '',
        phone: ''
    }
};

let mockData = initialMockData;
let mockDataRecordId = null; // ID del record dati dell'account su MockAPI
let mockDataRecordEmail = null; // email/chiave del record dati dell'account
let currentAccountEmail = null; // email dell'account loggato (minuscolo)

// I record "tecnici" che contengono i dati dell'app non sono persone reali:
// quello vecchio condiviso e quelli per-account (socialchat_appdata_<email>).
function isAppDataEmail(email) {
    if (!email) return false;
    const e = String(email).toLowerCase();
    return e === 'socialchat_app_data' || e.startsWith('socialchat_appdata_') || e.startsWith('socialchat_chat_');
}

// ============================================================
// SISTEMA CHAT CONDIVISE TRA ACCOUNT
// ------------------------------------------------------------
// Prima ogni account salvava i "chats" solo nel proprio record
// personale su MockAPI: se Lilly scriveva a Jane, il messaggio
// restava chiuso nel record di Lilly e Jane non lo vedeva mai
// (sembrava che Lilly avesse scritto "a se stessa"). Ora ogni
// conversazione ha un ID deterministico basato sui numeri di
// telefono dei partecipanti, ed è salvata in UN SOLO record
// condiviso su MockAPI (stesso trucco già usato per i "dati app":
// riusiamo l'endpoint /users come contenitore). Entrambi gli
// account leggono e scrivono lo STESSO record.
// ============================================================

function normalizePhone(phone) {
    return (phone || '').toString().replace(/\s+/g, '').trim();
}

// ID stabile e uguale per tutti i partecipanti, indipendentemente
// da chi lo calcola o in che ordine sono stati selezionati i contatti.
function buildChatId(phonesArray) {
    const clean = (phonesArray || []).map(normalizePhone).filter(Boolean);
    const unique = Array.from(new Set(clean)).sort();
    return 'chat_' + unique.join('_').replace(/[^a-zA-Z0-9_]/g, '');
}

// Restituisce {ok, record}. "ok" distingue "ho controllato e non c'è nulla"
// (ok=true, record=null) da "non sono riuscito a controllare" (ok=false, per
// errore di rete/timeout). Questa distinzione è FONDAMENTALE: prima, un
// semplice intoppo di rete veniva scambiato per "la chat non esiste ancora" e
// il chiamante creava un SECONDO record duplicato per la stessa chat. Da quel
// momento i due account leggevano record diversi e i messaggi sembravano
// sparire per sempre: è il bug più probabile dietro "il messaggio non arriva".
async function fetchSharedChatRecord(chatId, attempts = 3) {
    const recordEmail = `socialchat_chat_${chatId}`;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(`${MOCKAPI_BASE_URL}/users`, { signal: createTimeoutSignal(10000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const users = await res.json();
            const found = users.find(u => u.email === recordEmail) || null;
            return { ok: true, record: found };
        } catch (err) {
            console.error(`Errore lettura chat condivisa (tentativo ${i + 1}/${attempts})`, err);
            if (i < attempts - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
        }
    }
    return { ok: false, record: null };
}

async function saveSharedChatRecord(chatId, chatData, existingRecordId) {
    const payload = {
        name: 'SocialChat Chat Data',
        email: `socialchat_chat_${chatId}`,
        phone: '',
        password: '',
        chatData: chatData
    };
    try {
        if (existingRecordId) {
            await fetch(`${MOCKAPI_BASE_URL}/users/${existingRecordId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: createTimeoutSignal(10000)
            });
            return existingRecordId;
        } else {
            const res = await fetch(`${MOCKAPI_BASE_URL}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: createTimeoutSignal(10000)
            });
            const created = await res.json();
            return created.id;
        }
    } catch (err) {
        console.error("Errore salvataggio chat condivisa", err);
        return existingRecordId || null;
    }
}

// Recupera (o crea, se non esiste ancora) il record condiviso di una chat.
async function getOrCreateSharedChat(chatId, defaults) {
    const { ok, record } = await fetchSharedChatRecord(chatId);
    if (record && record.chatData) {
        return { recordId: record.id, chatData: record.chatData };
    }
    if (!ok) {
        // Non sappiamo se la chat esiste già: MEGLIO fermarsi che creare un
        // secondo record duplicato che spezzerebbe la conversazione in due.
        throw new Error("Impossibile verificare la chat condivisa (rete non raggiungibile). Riprova.");
    }
    const chatData = Object.assign({
        id: chatId,
        isGroup: false,
        participants: [],
        messages: []
    }, defaults);
    const recordId = await saveSharedChatRecord(chatId, chatData, null);
    return { recordId, chatData };
}

// Calcola quanti messaggi non letti (scritti da altri) ci sono in una chat locale.
function countUnreadMessages(chat) {
    if (!chat.messages) return 0;
    const lastRead = chat.lastReadTimestamp || 0;
    const myPhone = normalizePhone(mockData.user.phone);
    return chat.messages.filter(m =>
        m.authorPhone && normalizePhone(m.authorPhone) !== myPhone &&
        m.dateTimestamp && m.dateTimestamp > lastRead
    ).length;
}

// Ricontrolla periodicamente (polling) i record condivisi delle chat dell'utente,
// per "ricevere" i messaggi scritti nel frattempo da altri account.
async function syncChatsFromServer() {
    let allRecords;
    try {
        const res = await fetch(`${MOCKAPI_BASE_URL}/users`);
        if (!res.ok) return;
        allRecords = await res.json();
    } catch (err) {
        console.error("Errore sync chat", err);
        return;
    }

    const myPhone = normalizePhone(mockData.user.phone);
    const chatRecordsByEmail = {};
    allRecords.forEach(u => {
        if (typeof u.email === 'string' && u.email.startsWith('socialchat_chat_') && u.chatData) {
            chatRecordsByEmail[u.email] = u;
        }
    });

    let changed = false;

    // 1) Aggiorna i messaggi delle chat che ho già in lista.
    if (mockData.chats) {
        mockData.chats.forEach(chat => {
            if (!chat.chatId) return; // chat "di sistema" (es. feedback), non condivisa
            const record = chatRecordsByEmail[`socialchat_chat_${chat.chatId}`];
            if (record && record.chatData && record.chatData.messages) {
                const oldCount = (chat.messages || []).length;
                const newMessages = record.chatData.messages;
                if (newMessages.length !== oldCount) {
                    chat.messages = newMessages;
                    chat.lastMessage = newMessages.length > 0 ?
                        (newMessages[newMessages.length - 1].text || '📎 Allegato') : chat.lastMessage;
                    changed = true;
                }
                chat.unreadCount = countUnreadMessages(chat);
            }
        });
    }

    // 2) Scopre chat condivise create/avviate da un ALTRO account in cui sono
    // partecipante ma che non ho ancora nella mia lista locale (es. Jane apre
    // l'app dopo che Lilly le ha scritto per la prima volta).
    if (!mockData.chats) mockData.chats = [];
    Object.values(chatRecordsByEmail).forEach(record => {
        const cd = record.chatData;
        const participants = cd.participants || [];
        const amIParticipant = participants.some(p => normalizePhone(p.phone) === myPhone);
        if (!amIParticipant) return;
        if (mockData.chats.find(c => c.id === cd.id)) return;

        const others = participants.filter(p => normalizePhone(p.phone) !== myPhone);
        const displayName = (others.map(o => o.name).join(', ') || 'Nuova chat').substring(0, 30);
        const messages = cd.messages || [];

        // Per chat 1-a-1, usa un avatar deterministico basato sul nome dell'altra persona
        // così entrambi vedono la stessa foto per la stessa persona
        const avatarSeed = others.length === 1 ? others[0].name : Math.floor(Math.random() * 50);
        const avatarUrl = `https://i.pravatar.cc/150?img=${typeof avatarSeed === 'string' ? (avatarSeed.charCodeAt(0) % 70) : avatarSeed}`;

        const newLocalChat = {
            id: cd.id,
            chatId: cd.id,
            name: displayName,
            avatar: avatarUrl,
            lastMessage: messages.length ? (messages[messages.length - 1].text || '📎 Allegato') : '',
            timestamp: 'Ora',
            isGroup: !!cd.isGroup,
            participantCount: participants.length,
            participantPhones: participants.map(p => normalizePhone(p.phone)),
            messages: messages,
            lastReadTimestamp: 0
        };
        newLocalChat.unreadCount = countUnreadMessages(newLocalChat);

        mockData.chats.unshift(newLocalChat);
        changed = true;
    });

    if (changed) {
        // Come in WhatsApp: la chat con l'attività più recente sale in cima,
        // così un nuovo messaggio si nota subito anche senza scorrere la lista.
        // Inoltre, le chat con messaggi non letti hanno priorità assoluta.
        mockData.chats.sort((a, b) => {
            const unreadA = a.unreadCount || 0;
            const unreadB = b.unreadCount || 0;
            
            // Priorità ai messaggi non letti
            if (unreadA > 0 && unreadB === 0) return -1;
            if (unreadB > 0 && unreadA === 0) return 1;
            if (unreadA > 0 && unreadB > 0) return unreadB - unreadA;
            
            // Se entrambe hanno 0 non letti, ordina per timestamp
            const lastA = (a.messages && a.messages.length) ? (a.messages[a.messages.length - 1].dateTimestamp || 0) : 0;
            const lastB = (b.messages && b.messages.length) ? (b.messages[b.messages.length - 1].dateTimestamp || 0) : 0;
            return lastB - lastA;
        });
        await saveDataLocalOnly();
        renderChatsList();
        if (activeChat) {
            const refreshed = mockData.chats.find(c => c.id === activeChat.id);
            if (refreshed) {
                activeChat = refreshed;
                renderActiveChatMessages(refreshed);
            }
        }
    }
}

// Salva solo la cache locale, senza rimandare tutto mockData al record account su
// MockAPI ad ogni polling: i messaggi vivono già nel record condiviso della chat.
async function saveDataLocalOnly() {
    try {
        const cacheKey = currentAccountEmail ? `socialchat_data_${currentAccountEmail}` : 'socialchat_data';
        localStorage.setItem(cacheKey, JSON.stringify(mockData));
    } catch (err) {
        console.error("Errore salvataggio localStorage:", err && err.message);
    }
}
let activeChat = null;
let activeCommunityChat = null;
let selectedFiles = [];
let selectedCommunityFiles = [];
let selectedUsersForChat = []; 

let postAttachedFile = null;
let communityAttachedAvatar = "https://i.pravatar.cc/150?img=12";

document.addEventListener("DOMContentLoaded", () => {
    checkSessionAndInit();
});

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Ridimensiona e comprime un'immagine prima di salvarla come base64.
// Le foto degli iPhone possono pesare diversi MB: senza compressione il JSON
// salvato in localStorage supera la quota (~5MB su iOS) e blocca Safari.
// I file non-immagine vengono restituiti invariati.
function resizeImageFile(file, maxSize = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            fileToBase64(file).then(resolve).catch(reject);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width >= height && width > maxSize) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else if (height > width && height > maxSize) {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (err) {
                    resolve(e.target.result);
                }
            };
            img.onerror = () => resolve(e.target.result);
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function applyDataRetentionPolicy() {
    const now = Date.now();
    const fiftyDaysMs = 50 * 24 * 60 * 60 * 1000;

    if (mockData.posts) {
        mockData.posts = mockData.posts.filter(post => {
            if (post.id === "101") return true; 
            return (now - parseInt(post.id || now, 10)) < fiftyDaysMs; 
        });
    }

    if (mockData.chats) {
        mockData.chats.forEach(chat => {
            if (chat.messages) {
                chat.messages = chat.messages.filter(msg => {
                    if (!msg.dateTimestamp) return true; 
                    return (now - msg.dateTimestamp) < fiftyDaysMs;
                });
            }
        });
    }

    if (mockData.communities) {
        mockData.communities.forEach(comm => {
            if (comm.messages) {
                comm.messages = comm.messages.filter(msg => {
                    if (!msg.dateTimestamp) return true;
                    return (now - msg.dateTimestamp) < fiftyDaysMs;
                });
            }
        });
    }
    saveData();
}

async function loadDataFromMockAPI(accountEmail) {
    currentAccountEmail = accountEmail ? accountEmail.toLowerCase() : null;
    const cacheKey = currentAccountEmail ? `socialchat_data_${currentAccountEmail}` : 'socialchat_data';

    // Prima carica la copia locale dell'account (priorità ai dati locali, offline).
    const localData = localStorage.getItem(cacheKey);
    if (localData) {
        try {
            mockData = JSON.parse(localData);
            console.log("Dati caricati da localStorage");
        } catch (e) {
            console.error("Errore parsing localStorage:", e);
            mockData = JSON.parse(JSON.stringify(initialMockData));
        }
    } else {
        mockData = JSON.parse(JSON.stringify(initialMockData));
    }

    // Senza account (avvio senza sessione) non c'è record cloud da caricare.
    if (!currentAccountEmail) {
        mockDataRecordId = null;
        mockDataRecordEmail = null;
        return;
    }

    // Poi sincronizza con MockAPI: ogni account ha il PROPRIO record, così lo stesso
    // account vede gli stessi dati su telefono e computer e account diversi restano separati.
    try {
        const res = await fetch(`${MOCKAPI_BASE_URL}/users`);
        if (!res.ok) throw new Error("Impossibile leggere da MockAPI");
        const users = await res.json();

        const recordEmail = `socialchat_appdata_${currentAccountEmail}`;
        const accountRecord = users.find(u => u.email === recordEmail);

        if (accountRecord && accountRecord.mockData) {
            mockDataRecordId = accountRecord.id;
            mockDataRecordEmail = recordEmail;
            Object.assign(mockData, accountRecord.mockData);
            console.log("Dati account sincronizzati con MockAPI");
        } else {
            // Primo accesso di questo account: crea il suo record.
            // Migrazione una-tantum: i vecchi dati condivisi (record unico) appartengono
            // all'owner dell'app e vengono ereditati SOLO dal suo account; gli altri
            // account partono dai dati iniziali. Non ci si può basare su
            // legacy.mockData.user.email perché riflette l'ultimo che ha salvato.
            let seed = JSON.parse(JSON.stringify(initialMockData));
            const legacy = users.find(u => u.email === 'socialchat_app_data');
            if (legacy && legacy.mockData && currentAccountEmail === LEGACY_DATA_OWNER_EMAIL) {
                seed = legacy.mockData;
            }
            mockData = seed;

            const createRes = await fetch(`${MOCKAPI_BASE_URL}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'SocialChat App Data',
                    email: recordEmail,
                    phone: '',
                    password: '',
                    mockData: mockData
                })
            });
            const created = await createRes.json();
            mockDataRecordId = created.id;
            mockDataRecordEmail = recordEmail;
            console.log("Creato record dati per l'account");
        }
    } catch (err) {
        console.error("Errore MockAPI, uso solo localStorage:", err);
        // I dati locali sono già caricati, non fare nulla
    }
}

async function checkSessionAndInit() {
    const savedProfile = localStorage.getItem('socialchat_myprofile');
    const loginTimestamp = localStorage.getItem('socialchat_login_timestamp');

    if (savedProfile && loginTimestamp) {
        const now = Date.now();
        const elapsedMs = now - parseInt(loginTimestamp, 10);
        const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

        if (elapsedMs > tenDaysMs) {
            logout();
            alert("Sessione scaduta dopo 10 giorni. Effettua nuovamente l'accesso.");
            return;
        }

        let profile = null;
        try { profile = JSON.parse(savedProfile); } catch (e) { profile = null; }
        const accountEmail = profile && profile.email ? profile.email : null;

        // Carica i dati DELL'ACCOUNT dal cloud (telefono e computer allineati).
        await loadDataFromMockAPI(accountEmail);

        // Il profilo sul cloud è la fonte di verità; usa il locale solo se il cloud
        // non ha ancora un profilo per questo account.
        const cloudUserOk = mockData.user && mockData.user.email && accountEmail &&
            mockData.user.email.toLowerCase() === accountEmail.toLowerCase();
        if (!cloudUserOk && profile) {
            mockData.user = profile;
        }

        if (!mockData.posts) mockData.posts = initialMockData.posts;
        if (!mockData.communities) mockData.communities = initialMockData.communities;

        applyDataRetentionPolicy();
        showMainApplication();
    } else {
        showAuthScreen();
    }
}

function showAuthScreen() {
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    initLoginHandler();
}

function showMainApplication() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    launchApp();
}

function logout() {
    stopChatPolling();
    localStorage.removeItem('socialchat_myprofile');
    localStorage.removeItem('socialchat_login_timestamp');

    mockDataRecordId = null;
    mockDataRecordEmail = null;
    currentAccountEmail = null;

    document.getElementById('login-phone').value = '';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    const errorMsg = document.getElementById('error-message');
    if (errorMsg) errorMsg.classList.add('hidden');

    showAuthScreen();
}

function initLoginHandler() {
    const formLogin = document.getElementById('form-login');
    formLogin.onsubmit = async (e) => {
        e.preventDefault();
        const phone = document.getElementById('login-phone').value.trim();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            // Chiamata all'endpoint MockAPI degli utenti remoti
            const risposta = await fetch(`${MOCKAPI_BASE_URL}/users`);
            if (!risposta.ok) throw new Error("Database MockAPI non accessibile.");
            
            const utentiAutorizzati = await risposta.json();
            const utenteTrovato = utentiAutorizzati.find(u => 
                u.phone.trim() === phone &&
                u.email.trim().toLowerCase() === email.toLowerCase() &&
                u.password === password
            );

            if (utenteTrovato) {
                // Carica/crea il record dati DELL'ACCOUNT dal cloud, così ritroviamo
                // chat, contatti, community e profilo di QUESTO account (uguali su
                // telefono e computer) e account diversi restano separati.
                await loadDataFromMockAPI(email);

                // Il profilo sul cloud è la fonte di verità. Se manca (primo accesso di
                // questo account) usa il profilo locale per-email, altrimenti i default.
                const cloudUserOk = mockData.user && mockData.user.email &&
                    mockData.user.email.toLowerCase() === email.toLowerCase();

                if (!cloudUserOk) {
                    const emailKey = `socialchat_profile_${email.toLowerCase()}`;
                    const savedProfileStr = localStorage.getItem(emailKey);
                    let userProfileLoaded = false;

                    if (savedProfileStr) {
                        try {
                            mockData.user = JSON.parse(savedProfileStr);
                            userProfileLoaded = true;
                        } catch (pErr) {
                            console.error("Errore nel parsing del profilo salvato:", pErr);
                        }
                    }

                    // Primo accesso in assoluto: imposta i valori iniziali.
                    if (!userProfileLoaded) {
                        if (!mockData.user) mockData.user = {};
                        if (!mockData.user.id) mockData.user.id = 'me';
                        mockData.user.phone = utenteTrovato.phone;
                        mockData.user.email = utenteTrovato.email;
                        const localName = email.split('@')[0];
                        mockData.user.name = localName.charAt(0).toUpperCase() + localName.slice(1);
                        mockData.user.bio = 'Sviluppatore appassionato di tecnologia 💻';
                        mockData.user.photo = utenteTrovato.avatar || 'https://i.pravatar.cc/150?img=0';
                    }
                }

                localStorage.setItem('socialchat_login_timestamp', Date.now().toString());
                localStorage.setItem('socialchat_myprofile', JSON.stringify(mockData.user));
                localStorage.setItem(`socialchat_profile_${email.toLowerCase()}`, JSON.stringify(mockData.user));

                await saveData();
                showMainApplication();
            } else {
                const errorMsg = document.getElementById('error-message');
                if (errorMsg) {
                    errorMsg.innerHTML = `Credenziali errate. Per info, <a href="https://wa.me/393515148526" target="_blank" style="color:var(--primary-color); font-weight:bold;">contatta l'amministratore</a>`;
                    errorMsg.classList.remove('hidden');
                }
            }
        } catch (errore) {
            console.error(errore);
        }
    };
}

async function launchApp() {
    await initializeFeedbackChat();
    updateProfileWidgetDOM();

    document.getElementById('sidebar-logo').onclick = () => {
        if(confirm("Vuoi disconnetterti e tornare alla pagina di accesso?")) {
            logout();
        }
    };

    initSidebarNavTabs();
    initProfileModalHandlers();
    initMessageSystem();
    initPostHandlers();
    initCommunityHandlers();
    initCommunityMessageSystem();

    const searchChatsInput = document.getElementById('search-chats');
    if (searchChatsInput) searchChatsInput.addEventListener('input', renderChatsList);

    const searchContactsInput = document.getElementById('search-contacts');
    if (searchContactsInput) searchContactsInput.addEventListener('input', renderContactsGrid);

    const searchPostsInput = document.getElementById('search-posts');
    if (searchPostsInput) searchPostsInput.addEventListener('input', renderPosts);

    const searchCommunitiesInput = document.getElementById('search-communities');
    if (searchCommunitiesInput) searchCommunitiesInput.addEventListener('input', renderCommunities);

    // Mobile menu handlers
    initMobileMenu();

    // Sincronizzazione immediata delle chat dal server per scoprire nuovi messaggi
    await syncChatsFromServer();

    renderChatsList();
    renderContactsGrid();
    renderPosts();
    renderCommunities();

    startChatPolling();
}

let chatSyncIntervalId = null;

// Controlla ogni pochi secondi se sono arrivati nuovi messaggi nelle chat
// condivise (non c'è un vero backend con notifiche push, quindi si usa il
// polling) e aggiorna lista chat, pallini non letti e conversazione aperta.
function startChatPolling() {
    if (chatSyncIntervalId) clearInterval(chatSyncIntervalId);
    syncChatsFromServer();
    chatSyncIntervalId = setInterval(() => {
        syncChatsFromServer();
    }, 7000);
}

function stopChatPolling() {
    if (chatSyncIntervalId) {
        clearInterval(chatSyncIntervalId);
        chatSyncIntervalId = null;
    }
}

function initMobileMenu() {
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

    mobileNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;

            // Se è il pulsante profilo
            if (item.id === 'mobile-profile-btn') {
                const profileWidget = document.getElementById('user-profile-widget');
                if (profileWidget) {
                    profileWidget.click();
                }
                return;
            }

            // Aggiorna active state
            mobileNavItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Clicca sul corrispondente button della sidebar
            const sidebarBtnId = `btn-nav-${section}`;
            const sidebarBtn = document.getElementById(sidebarBtnId);
            if (sidebarBtn) {
                sidebarBtn.click();
            }
        });
    });

    // Sincronizza active state quando si usa la sidebar su desktop
    const sidebarNavButtons = document.querySelectorAll('.nav-btn');
    sidebarNavButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const sectionId = btn.id.replace('btn-nav-', '');
            mobileNavItems.forEach(item => {
                item.classList.remove('active');
                if (item.dataset.section === sectionId) {
                    item.classList.add('active');
                }
            });
        });
    });
}

async function initializeFeedbackChat() {
    let feedbackChat = mockData.chats.find(c => c.id === 'feedback');
    if (!feedbackChat) {
        try {
            const res = await fetch(`${MOCKAPI_BASE_URL}/users`);
            if (res.ok) {
                const utenti = await res.json();
                const userNames = utenti.filter(u => !isAppDataEmail(u.email)).map(u => u.email.split('@')[0]);
                const totalParticipants = userNames.length + 1;

                feedbackChat = {
                    id: 'feedback',
                    name: "Feedback Sviluppo",
                    avatar: "https://i.pravatar.cc/150?img=68",
                    lastMessage: "Marta-SocialChat: Benvenuti nella bacheca feedback!",
                    timestamp: "Ora",
                    isGroup: true,
                    participantCount: totalParticipants,
                    messages: [
                        {
                            author: "Marta-SocialChat",
                            text: "Benvenuti a tutti in questo canale speciale! 🚀 Qui potrete dare consigli preziosi, condividere idee o segnalare bug direttamente a me e al team di sviluppo per migliorare costantemente SocialChat.",
                            timestamp: "10:00",
                            files: []
                        }
                    ]
                };
                mockData.chats.unshift(feedbackChat);
                await saveData();
            }
        } catch (err) {
            console.error("Errore inizializzazione feedback", err);
        }
    }
}

function updateProfileWidgetDOM() {
    document.getElementById('widget-name').textContent = mockData.user.name;
    if (mockData.user.photo) {
        document.getElementById('widget-avatar').src = mockData.user.photo;
    }
}

function initSidebarNavTabs() {
    const navButtons = {
        'btn-nav-chats': 'section-chats',
        'btn-nav-contacts': 'section-contacts',
        'btn-nav-posts': 'section-posts',
        'btn-nav-community': 'section-community'
    };

    Object.keys(navButtons).forEach(btnId => {
        document.getElementById(btnId).addEventListener('click', (e) => {
            Object.keys(navButtons).forEach(id => {
                document.getElementById(id).classList.remove('active');
                document.getElementById(navButtons[id]).classList.add('hidden');
            });

            e.currentTarget.classList.add('active');
            document.getElementById(navButtons[btnId]).classList.remove('hidden');
            
            if (btnId !== 'btn-nav-community') {
                closeCommunityChat();
            }

            // Cambiando sezione, chiudi la chat a schermo intero su mobile
            // e riporta in vista la bottom nav.
            if (btnId !== 'btn-nav-chats') {
                const chatViewport = document.querySelector('.chat-viewport');
                if (chatViewport) chatViewport.classList.remove('active');
                document.body.classList.remove('mobile-chat-open');
            }
        });
    });
}

// Nome mostrato per una chat: usa il nome personalizzato (rinomina locale
// dell'account, non condivisa con l'altro partecipante) se presente.
function getChatDisplayName(chat) {
    return chat.customName || chat.name;
}

function renderChatsList() {
    const listContainer = document.getElementById('chats-list');
    listContainer.innerHTML = '';
    const searchInput = document.getElementById('search-chats');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredChats = mockData.chats.filter(chat => 
        getChatDisplayName(chat).toLowerCase().includes(filterText) || 
        chat.lastMessage.toLowerCase().includes(filterText)
    );

    filteredChats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `list-item ${activeChat && activeChat.id === chat.id ? 'active' : ''}`;
        const unread = chat.unreadCount || 0;
        const unreadBadge = unread > 0
            ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>`
            : '';
        item.innerHTML = `
            <img src="${chat.avatar}" alt="${getChatDisplayName(chat)}" class="item-avatar">
            <div class="item-details">
                <div class="item-header">
                    <span class="item-title">${getChatDisplayName(chat)}</span>
                    <span class="item-meta">${chat.timestamp}</span>
                </div>
                <p class="item-subtitle">${chat.lastMessage}</p>
            </div>
            ${unreadBadge}
        `;
        item.onclick = () => openChatConversation(chat);
        listContainer.appendChild(item);
    });
}

function openChatConversation(chat) {
    activeChat = chat;
    renderChatsList();

    document.getElementById('message-input-area').classList.remove('hidden');
    const viewportHeader = document.getElementById('chat-header');
    viewportHeader.classList.remove('hidden');

    // Mobile: mostra chat viewport full screen e nascondi la bottom nav, che
    // altrimenti (essendo anch'essa fixed) copre la casella di scrittura.
    const chatViewport = document.querySelector('.chat-viewport');
    if (chatViewport) {
        chatViewport.classList.add('active');
    }
    document.body.classList.add('mobile-chat-open');

    let statusLabel = `<span style="font-size:12px; color:#34C759;">Online</span>`;
    if (chat.isGroup) {
        const count = chat.participantCount || 3;
        statusLabel = `<span style="font-size:12px; color:var(--dark-gray); font-weight:600;">Gruppo • ${count} partecipanti</span>`;
    }

    viewportHeader.innerHTML = `
        <div class="chat-header-active" style="width:100%; display:flex; align-items:center; gap:12px;">
            <button id="btn-back-chat" style="background:none; border:none; color:var(--primary-color); font-size:24px; font-weight:bold; cursor:pointer; padding: 4px 8px; display:flex; align-items:center;">←</button>
            <div id="chat-avatar-edit" title="Clicca per cambiare la foto della chat" style="position:relative; cursor:pointer; width:40px; height:40px; flex-shrink:0;">
                <img src="${chat.avatar}" class="item-avatar" style="width:40px; height:40px;">
                <span style="position:absolute; bottom:-2px; right:-2px; background:var(--primary-color); color:#fff; width:16px; height:16px; border-radius:50%; font-size:9px; display:flex; align-items:center; justify-content:center; border:2px solid #fff;">📷</span>
            </div>
            <input type="file" id="chat-avatar-input" accept="image/*" style="display:none;">
            <div style="flex:1; min-width:0;">
                <h4 style="font-weight:700; font-size:15px; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${getChatDisplayName(chat)}</h4>
                ${statusLabel}
            </div>
            <button id="btn-rename-chat" title="Rinomina questa chat (solo per te)" style="background:none; border:none; font-size:18px; cursor:pointer; padding:4px 8px; flex-shrink:0;">✏️</button>
        </div>
    `;

    const chatAvatarEdit = document.getElementById('chat-avatar-edit');
    const chatAvatarInput = document.getElementById('chat-avatar-input');
    if (chatAvatarEdit && chatAvatarInput) {
        chatAvatarEdit.onclick = () => chatAvatarInput.click();
        chatAvatarInput.onchange = async () => {
            const file = chatAvatarInput.files && chatAvatarInput.files[0];
            if (!file) return;
            const dataUrl = await resizeImageFile(file, 256, 0.7);
            chat.avatar = dataUrl;
            openChatConversation(chat);
            renderChatsList();
            saveData();
        };
    }

    const btnRenameChat = document.getElementById('btn-rename-chat');
    if (btnRenameChat) {
        btnRenameChat.onclick = () => {
            const proposedName = prompt("Nuovo nome per questa chat (visibile solo a te):", getChatDisplayName(chat));
            if (proposedName === null) return;
            const trimmed = proposedName.trim();
            if (!trimmed) return;
            chat.customName = trimmed;
            openChatConversation(chat);
            renderChatsList();
            saveDataLocalOnly();
        };
    }

    // Segna la chat come letta: azzera il pallino blu dei messaggi non letti.
    chat.lastReadTimestamp = Date.now();
    chat.unreadCount = 0;
    saveDataLocalOnly();

    document.getElementById('btn-back-chat').onclick = () => {
        activeChat = null;
        document.getElementById('message-input-area').classList.add('hidden');
        document.getElementById('chat-header').classList.add('hidden');

        // Mobile: nascondi chat viewport e riporta la bottom nav
        if (chatViewport) {
            chatViewport.classList.remove('active');
        }
        document.body.classList.remove('mobile-chat-open');

        document.getElementById('chat-messages').innerHTML = `
            <div class="chat-placeholder" id="chat-placeholder">
                <div class="placeholder-icon">💬</div>
                <h3>Seleziona una chat</h3>
                <p>Scegli una conversazione dalla lista o creane una nuova per iniziare.</p>
            </div>
        `;
        renderChatsList();
    };

    renderActiveChatMessages(chat);
}

// Disegna i messaggi di una chat nel pannello centrale. Separata da
// openChatConversation così il polling può aggiornare solo i messaggi
// (nuovi arrivi) senza ridisegnare tutto l'header ogni pochi secondi.
function renderActiveChatMessages(chat) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';

    if (!chat.messages) {
        chat.messages = [
            { author: chat.isGroup ? "Sistema" : chat.name, text: chat.lastMessage, timestamp: chat.timestamp, files: [], dateTimestamp: Date.now() }
        ];
    }

    const myPhone = normalizePhone(mockData.user.phone);

    chat.messages.forEach(m => {
        // Identità basata sul numero di telefono (affidabile anche tra account
        // diversi); "me"/nome sono un fallback per i vecchi messaggi/di sistema.
        const isSelf = m.authorPhone && normalizePhone(m.authorPhone) === myPhone;
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isSelf ? 'message-sent' : 'message-received'}`;

        let senderHeader = '';
        if (chat.isGroup || !isSelf) {
            const displayAuthor = isSelf ? mockData.user.name : (m.author || 'Sconosciuto');
            senderHeader = `<div style="font-size: 11px; font-weight: 700; margin-bottom: 2px; color: ${isSelf ? 'rgba(255,255,255,0.9)' : 'var(--primary-color)'};">${displayAuthor}</div>`;
        }

        let filesMarkup = '';
        if (m.files && m.files.length > 0) {
            m.files.forEach(file => {
                if (file.type && file.type.startsWith('image/')) {
                    filesMarkup += `
                        <div style="margin-top:8px;">
                            <img src="${file.dataUrl}" style="max-width:100%; max-height:150px; border-radius:8px; cursor:pointer; display:block;" onclick="window.open('${file.dataUrl}', '_blank')">
                            <a href="${file.dataUrl}" download="${file.name}" style="color:inherit; font-size:11px; text-decoration:underline; margin-top:4px; display:inline-block;">Scarica ${file.name}</a>
                        </div>`;
                } else {
                    filesMarkup += `
                        <div style="margin-top:8px; display:flex; align-items:center; gap:6px;">
                            <span style="font-size:18px;">📄</span> 
                            <a href="${file.dataUrl}" download="${file.name}" target="_blank" style="color:inherit; font-size:13px; text-decoration:underline; font-weight:600;">Apri ${file.name}</a>
                        </div>`;
                }
            });
        }

        bubble.innerHTML = `
            ${senderHeader}
            <p style="margin:0; white-space: pre-wrap;">${m.text}</p>
            ${filesMarkup}
            <div class="message-meta">${m.timestamp}</div>
        `;
        messagesContainer.appendChild(bubble);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function initProfileModalHandlers() {
    const widget = document.getElementById('user-profile-widget');
    const modal = document.getElementById('profile-modal');
    const btnClose = document.getElementById('btn-close-profile');
    const btnSave = document.getElementById('btn-save-profile');
    const dropZone = document.getElementById('profile-drop-zone');
    const fileInput = document.getElementById('modal-profile-file');
    const imgPreview = document.getElementById('profile-modal-preview');

    if (widget) {
        widget.addEventListener('click', () => {
            const editUsername = document.getElementById('edit-username');
            const editBio = document.getElementById('edit-bio');
            
            if (editUsername) editUsername.value = mockData.user.name || '';
            if (editBio) editBio.value = mockData.user.bio || '';
            if (imgPreview) imgPreview.src = mockData.user.photo || 'https://i.pravatar.cc/150?img=0';
            
            modal.classList.remove('hidden');
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.add('hidden');
        });
    }

    if (dropZone && fileInput) {
        fileInput.addEventListener('click', (e) => e.stopPropagation());
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if(e.target.files && e.target.files[0]) {
                processAndPreviewProfileImg(e.target.files[0], imgPreview);
            }
        });

        ['dragenter', 'dragover'].forEach(name => {
            dropZone.addEventListener(name, (e) => { 
                e.preventDefault(); 
                dropZone.classList.add('drag-over'); 
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            dropZone.addEventListener(name, (e) => { 
                e.preventDefault(); 
                dropZone.classList.remove('drag-over'); 
            });
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if(file && file.type.startsWith('image/')) {
                processAndPreviewProfileImg(file, imgPreview);
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async (e) => {
            e.preventDefault();
            const editUsername = document.getElementById('edit-username');
            const editBio = document.getElementById('edit-bio');
            const nuovoNome = editUsername ? editUsername.value.trim() : '';

            if (!nuovoNome) {
                alert("Il nome utente non può essere vuoto!");
                return;
            }

            // 1. Aggiorna l'oggetto in memoria
            mockData.user.name = nuovoNome;
            mockData.user.bio = editBio ? editBio.value.trim() : '';
            if (imgPreview && imgPreview.src) {
                mockData.user.photo = imgPreview.src;
            }

            // 2. Salva in localStorage immediatamente per persistenza locale locale
            localStorage.setItem('socialchat_myprofile', JSON.stringify(mockData.user));

            if (mockData.user.email) {
                const emailKey = `socialchat_profile_${mockData.user.email.toLowerCase()}`;
                localStorage.setItem(emailKey, JSON.stringify(mockData.user));
            }

            // 3. Aggiorna subito il widget visibile
            updateProfileWidgetDOM();

            // 4. Esegui il salvataggio remoto e attendi il completamento locale primario
            await saveData();

            // 5. Chiudi la modale SOLO dopo che le operazioni grafiche e di salvataggio sono concluse
            modal.classList.add('hidden');
        });
    }
}

function processAndPreviewProfileImg(file, targetImgElement) {
    resizeImageFile(file, 256, 0.7)
        .then((dataUrl) => { targetImgElement.src = dataUrl; })
        .catch((err) => console.error("Errore elaborazione immagine", err));
}

const btnOpenCreateModal = document.getElementById('btn-open-create-modal');
const createChatModal = document.getElementById('create-chat-modal');
const btnCloseCreateChat = document.getElementById('btn-close-create-chat');
const btnConfirmCreateChat = document.getElementById('btn-confirm-create-chat');
const selectionUsersList = document.getElementById('selection-users-list');

if (btnOpenCreateModal) {
    btnOpenCreateModal.onclick = async () => {
        selectedUsersForChat = [];
        selectionUsersList.innerHTML = '';
        createChatModal.classList.remove('hidden');

        try {
            const res = await fetch(`${MOCKAPI_BASE_URL}/users`);
            if (!res.ok) return;
            const utenti = await res.json();

            utenti.forEach(u => {
                if (isAppDataEmail(u.email)) return;
                const username = u.email.split('@')[0];
                const userPhone = u.phone || u.telefono || '';
                if(userPhone === mockData.user.phone || u.email.toLowerCase() === mockData.user.email.toLowerCase()) return;

                const row = document.createElement('div');
                row.className = 'user-selection-row';
                row.innerHTML = `
                    <span class="selection-circle"></span>
                    <span class="selection-row-name">${username} (${userPhone})</span>
                `;

                row.onclick = () => {
                    row.classList.toggle('selected');
                    if(row.classList.contains('selected')) {
                        selectedUsersForChat.push({ name: username, phone: userPhone });
                    } else {
                        selectedUsersForChat = selectedUsersForChat.filter(item => item.phone !== userPhone);
                    }
                };
                selectionUsersList.appendChild(row);
            });
        } catch (err) {
            console.error("Errore caricamento utenti", err);
        }
    };
}

if (btnCloseCreateChat) btnCloseCreateChat.onclick = () => createChatModal.classList.add('hidden');

if (btnConfirmCreateChat) {
    btnConfirmCreateChat.onclick = async () => {
        if(selectedUsersForChat.length === 0) {
            alert("Seleziona almeno un partecipante.");
            return;
        }

        const groupName = selectedUsersForChat.map(u => u.name).join(', ');
        const isGroup = selectedUsersForChat.length > 1;

        // ID deterministico basato sui partecipanti: se l'altro account crea/apre
        // la stessa conversazione, ottiene esattamente lo stesso ID e vede gli
        // stessi messaggi (prima ogni account aveva una copia privata separata).
        const allPhones = [mockData.user.phone, ...selectedUsersForChat.map(u => u.phone)];
        const chatId = buildChatId(allPhones);

        let existingChat = mockData.chats.find(c => c.id === chatId);
        if (!existingChat) {
            let chatData;
            try {
                ({ chatData } = await getOrCreateSharedChat(chatId, {
                    isGroup: isGroup,
                    participants: selectedUsersForChat.concat([{ name: mockData.user.name, phone: mockData.user.phone }]),
                    messages: [
                        { author: "Sistema", text: "Chat avviata con successo.", timestamp: "Ora", files: [], dateTimestamp: Date.now() }
                    ]
                }));
            } catch (errore) {
                console.error("Errore creazione chat/gruppo", errore);
                alert("Non è stato possibile creare la chat: connessione al server non riuscita. Riprova.");
                return;
            }

            existingChat = {
                id: chatId,
                chatId: chatId,
                name: groupName.substring(0, 30),
                avatar: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 50)}`,
                lastMessage: chatData.messages.length ? (chatData.messages[chatData.messages.length - 1].text || '📎 Allegato') : "Chat avviata con successo.",
                timestamp: "Ora",
                isGroup: isGroup,
                participantCount: selectedUsersForChat.length + 1,
                participantPhones: allPhones.map(normalizePhone),
                messages: chatData.messages,
                unreadCount: 0,
                lastReadTimestamp: Date.now()
            };

            mockData.chats.unshift(existingChat);
            await saveData();
        }

        renderChatsList();
        openChatConversation(existingChat);
        createChatModal.classList.add('hidden');
    };
}

async function renderContactsGrid() {
    const container = document.getElementById('contacts-list-container');
    if (!container) return;
    container.innerHTML = '';
    const searchInput = document.getElementById('search-contacts');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    try {
        const risposta = await fetch(`${MOCKAPI_BASE_URL}/users`);
        if (!risposta.ok) return;
        const utenti = await risposta.json();

        utenti.forEach((utente, idx) => {
            const userPhone = utente.phone || utente.telefono || '';
            const isSelf = (userPhone === mockData.user.phone) || 
                           (utente.email.toLowerCase() === mockData.user.email.toLowerCase());

            // Il record tecnico usato per salvare i dati su MockAPI non è una persona
            if (isAppDataEmail(utente.email)) return;

            if (isSelf) return;

            const cleanName = utente.email.split('@')[0];
            const readableName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).replace('.', ' ');
            const bioMockup = `Entusiasta di far parte della community di SocialChat ⚡`;
            const avatarUrl = utente.avatar || `https://i.pravatar.cc/150?img=${(idx + 10) % 70}`;

            if (filterText && !readableName.toLowerCase().includes(filterText) && !userPhone.includes(filterText)) {
                return;
            }

            const card = document.createElement('div');
            card.className = 'list-item';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'flex-start';
            card.style.borderRadius = '12px';
            card.style.border = '1px solid var(--medium-gray)';
            card.style.backgroundColor = '#FFFFFF';
            card.style.padding = '16px';
            card.style.gap = '12px';

            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px; width:100%;">
                    <img src="${avatarUrl}" class="item-avatar" style="width:50px; height:50px;">
                    <div class="item-details" style="display:flex; flex-direction:column; gap:2px;">
                        <span class="item-title" style="font-size:15px; font-weight:700;">${readableName}</span>
                        <span style="font-size:12px; color:var(--dark-gray); font-style:italic;">${bioMockup}</span>
                    </div>
                </div>
                <button class="btn-primary" style="width:100%; font-size:13px; font-weight:600; padding:8px 0; border-radius:8px; border:none; cursor:pointer;" id="chat-start-${idx}">
                    Inizia a chattare
                </button>
            `;

            container.appendChild(card);

            document.getElementById(`chat-start-${idx}`).onclick = async (e) => {
                e.stopPropagation();

                const chatId = buildChatId([mockData.user.phone, userPhone]);
                let existingChat = mockData.chats.find(c => c.id === chatId);
                if(!existingChat) {
                    let chatData;
                    try {
                        ({ chatData } = await getOrCreateSharedChat(chatId, {
                            isGroup: false,
                            participants: [
                                { name: mockData.user.name, phone: mockData.user.phone },
                                { name: readableName, phone: userPhone }
                            ],
                            messages: [
                                { author: readableName, text: "Chat appena iniziata con questo contatto.", timestamp: "Ora", files: [], dateTimestamp: Date.now() }
                            ]
                        }));
                    } catch (errore) {
                        console.error("Errore avvio chat", errore);
                        alert("Non è stato possibile aprire la chat: connessione al server non riuscita. Riprova.");
                        return;
                    }

                    existingChat = {
                        id: chatId,
                        chatId: chatId,
                        name: readableName,
                        avatar: avatarUrl,
                        lastMessage: chatData.messages.length ? (chatData.messages[chatData.messages.length - 1].text || '📎 Allegato') : "Chat appena iniziata con questo contatto.",
                        timestamp: "Ora",
                        isGroup: false,
                        participantPhones: [normalizePhone(mockData.user.phone), normalizePhone(userPhone)],
                        messages: chatData.messages,
                        unreadCount: 0,
                        lastReadTimestamp: Date.now()
                    };
                    mockData.chats.unshift(existingChat);
                    await saveData();
                }

                document.getElementById('btn-nav-chats').click();
                openChatConversation(existingChat);
            };
        });
    } catch (errore) {
        console.error("Errore di caricamento dei contatti", errore);
    }
}

function initMessageSystem() {
    const inputWrapper = document.getElementById('input-wrapper');
    const textInput = document.getElementById('message-input');
    const btnSend = document.getElementById('btn-send');

    if (inputWrapper) {
        ['dragenter', 'dragover'].forEach(n => {
            inputWrapper.addEventListener(n, (e) => { e.preventDefault(); inputWrapper.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(n => {
            inputWrapper.addEventListener(n, (e) => { e.preventDefault(); inputWrapper.classList.remove('drag-over'); });
        });
        inputWrapper.addEventListener('drop', (e) => {
            if(e.dataTransfer.files.length > 0) handleFilesToQueue(e.dataTransfer.files);
        });
    }

    if (btnSend) btnSend.onclick = executeMessageTransmission;
    
    if (textInput) {
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                executeMessageTransmission();
            }
        });
    }

    const btnAttach = document.getElementById('btn-attach');
    if (btnAttach) {
        btnAttach.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('attach-menu').classList.toggle('hidden');
        };
    }
    document.addEventListener('click', () => {
        const menu = document.getElementById('attach-menu');
        if (menu) menu.classList.add('hidden');
    });

    const attPhoto = document.getElementById('attach-photo');
    if (attPhoto) attPhoto.onclick = () => document.getElementById('photo-input').click();

    const attFile = document.getElementById('attach-file');
    if (attFile) attFile.onclick = () => document.getElementById('file-input').click();

    const photoIn = document.getElementById('photo-input');
    if (photoIn) {
        photoIn.addEventListener('click', (e) => e.stopPropagation());
        photoIn.onchange = (e) => handleFilesToQueue(e.target.files);
    }

    const fileIn = document.getElementById('file-input');
    if (fileIn) {
        fileIn.addEventListener('click', (e) => e.stopPropagation());
        fileIn.onchange = (e) => handleFilesToQueue(e.target.files);
    }
}

function handleFilesToQueue(files) {
    const preview = document.getElementById('attachments-preview');
    Array.from(files).forEach(f => {
        selectedFiles.push(f);
        const thumb = document.createElement('div');
        thumb.className = 'attachment-thumbnail';
        
        if(f.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(f);
            thumb.appendChild(img);
        } else {
            thumb.innerHTML = `<span>Doc...</span>`;
        }

        const rm = document.createElement('button');
        rm.className = 'remove-btn';
        rm.textContent = '✕';
        rm.onclick = (e) => {
            e.stopPropagation();
            selectedFiles = selectedFiles.filter(item => item !== f);
            thumb.remove();
        };
        thumb.appendChild(rm);
        preview.appendChild(thumb);
    });
}

async function executeMessageTransmission() {
    const input = document.getElementById('message-input');
    const msgText = input.value.trim();
    if(!msgText && selectedFiles.length === 0) return;

    const filePromises = selectedFiles.map(async (file) => {
        const base64 = await resizeImageFile(file, 1024, 0.7);
        return { name: file.name, type: file.type, dataUrl: base64 };
    });

    const resolvedFiles = await Promise.all(filePromises);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMessage = {
        author: mockData.user.name,
        authorPhone: mockData.user.phone,
        text: msgText,
        timestamp: currentTime,
        files: resolvedFiles,
        dateTimestamp: Date.now() 
    };

    if(activeChat) {
        if (!activeChat.messages) activeChat.messages = [];

        if (activeChat.chatId) {
            // Riprende prima i messaggi più recenti dal record condiviso (nel caso
            // l'altro account abbia scritto nel frattempo), poi aggiunge il nuovo,
            // così nessun messaggio dell'altra persona viene sovrascritto/perso.
            const { ok, record } = await fetchSharedChatRecord(activeChat.chatId);

            if (!ok) {
                // Non siamo riusciti a leggere il record condiviso (rete/timeout):
                // NON scriviamo alla cieca, altrimenti rischiamo di creare un
                // secondo record duplicato per la stessa chat e perdere per
                // sempre la sincronizzazione con l'altro account.
                alert("Non è stato possibile inviare il messaggio: connessione al server non riuscita. Riprova tra qualche secondo.");
                return;
            }

            const baseMessages = (record && record.chatData && record.chatData.messages)
                ? record.chatData.messages
                : activeChat.messages;
            const mergedMessages = baseMessages.concat([newMessage]);

            // Non azzerare mai i partecipanti: se il record non ha ancora
            // chatData.participants, ricostruiscili dai dati che abbiamo già
            // localmente, così l'altro account continua a "vedere" la chat.
            const fallbackParticipants = (activeChat.participantPhones || []).map(phone =>
                normalizePhone(phone) === normalizePhone(mockData.user.phone)
                    ? { name: mockData.user.name, phone: mockData.user.phone }
                    : { name: activeChat.name, phone: phone }
            );
            const participants = (record && record.chatData && record.chatData.participants && record.chatData.participants.length)
                ? record.chatData.participants
                : fallbackParticipants;

            activeChat.messages = mergedMessages;
            activeChat.lastMessage = msgText ? msgText : `📎 File: ${resolvedFiles[0].name}`;
            activeChat.timestamp = currentTime;
            activeChat.lastReadTimestamp = Date.now();
            activeChat.unreadCount = 0;

            const chatData = Object.assign({}, record && record.chatData, {
                id: activeChat.chatId,
                isGroup: !!activeChat.isGroup,
                participants: participants,
                messages: mergedMessages
            });
            await saveSharedChatRecord(activeChat.chatId, chatData, record ? record.id : null);
            await saveDataLocalOnly();
        } else {
            // Chat "di sistema" (es. feedback), non condivisa tra account.
            activeChat.messages.push(newMessage);
            activeChat.lastMessage = msgText ? msgText : `📎 File: ${resolvedFiles[0].name}`;
            activeChat.timestamp = currentTime;
            await saveData();
        }

        // Porta in cima la chat appena usata, come in WhatsApp.
        const idxJustUsed = mockData.chats.findIndex(c => c.id === activeChat.id);
        if (idxJustUsed > 0) {
            mockData.chats.splice(idxJustUsed, 1);
            mockData.chats.unshift(activeChat);
        }

        renderChatsList();
        openChatConversation(activeChat);
    }

    input.value = '';
    selectedFiles = [];
    document.getElementById('attachments-preview').innerHTML = '';
}

function initPostHandlers() {
    const btnOpen = document.getElementById('btn-open-create-post');
    const btnClose = document.getElementById('btn-close-create-post');
    const btnPublish = document.getElementById('btn-publish-post');
    const modal = document.getElementById('create-post-modal');
    const dropZone = document.getElementById('post-file-drop-zone');
    const fileInput = document.getElementById('post-file-input');
    const previewText = document.getElementById('post-file-preview-text');

    if (btnOpen) {
        btnOpen.onclick = () => {
            document.getElementById('post-title').value = '';
            document.getElementById('post-description').value = '';
            postAttachedFile = null;
            previewText.textContent = "Trascina un file o clicca qui";
            modal.classList.remove('hidden');
        };
    }

    if (btnClose) btnClose.onclick = () => modal.classList.add('hidden');

    if (dropZone && fileInput) {
        fileInput.addEventListener('click', (e) => e.stopPropagation());
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            if(e.target.files && e.target.files[0]) {
                postAttachedFile = e.target.files[0];
                previewText.textContent = `File caricato: ${postAttachedFile.name}`;
            }
        };

        ['dragenter', 'dragover'].forEach(n => {
            dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(n => {
            dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
        });
        dropZone.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if(file) {
                postAttachedFile = file;
                previewText.textContent = `File caricato: ${file.name}`;
            }
        });
    }

    if (btnPublish) {
        btnPublish.onclick = async () => {
            const title = document.getElementById('post-title').value.trim();
            const desc = document.getElementById('post-description').value.trim();

            if(!title || !desc) {
                alert("Compila sia il titolo che la descrizione del post!");
                return;
            }

            const confirmed = confirm("Avviso importante:\n\nQuesto post verrà rimosso automaticamente dopo 50 giorni.\n\nVuoi procedere?");
            if(confirmed) {
                const nuovoPost = {
                    id: String(Date.now()), 
                    author: mockData.user.name,
                    title: title,
                    description: desc,
                    file: postAttachedFile ? postAttachedFile.name : null,
                    likes: 0,
                    likedBy: [],
                    comments: []
                };

                if(!mockData.posts) mockData.posts = [];
                mockData.posts.unshift(nuovoPost);
                await saveData();
                renderPosts();
                modal.classList.add('hidden');
            }
        };
    }
}

function renderPosts() {
    const container = document.getElementById('posts-list-container');
    if (!container) return;
    container.innerHTML = '';
    const searchInput = document.getElementById('search-posts');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let posts = mockData.posts || [];

    let martaPost = posts.find(p => p.id === "101");
    if (!martaPost) {
        martaPost = initialMockData.posts[0];
        posts.unshift(martaPost);
        saveData();
    }

    const otherPosts = posts.filter(p => p.id !== "101");
    const finalOrderedPosts = [martaPost, ...otherPosts];

    finalOrderedPosts.forEach(post => {
        if (filterText) {
            const matchesAuthor = post.author.toLowerCase().includes(filterText);
            const matchesTitle = post.title.toLowerCase().includes(filterText);
            const matchesDesc = post.description.toLowerCase().includes(filterText);
            if (!matchesAuthor && !matchesTitle && !matchesDesc) return;
        }

        const card = document.createElement('div');
        card.className = 'post-card';

        let attachmentMarkup = '';
        if(post.file) {
            attachmentMarkup = `<div class="post-attachment">📎 Allegato: ${post.file}</div>`;
        }

        if(!post.likedBy) post.likedBy = [];
        const hasLiked = post.likedBy.includes(mockData.user.name);
        const likeButtonText = hasLiked ? `👎 Togli Like` : `👍 Aggiungi Like`;

        if(!post.comments) post.comments = [];
        let commentsMarkup = '';
        post.comments.forEach(comment => {
            commentsMarkup += `
                <div class="comment-item" style="font-size: 13px; background: var(--light-gray); padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="font-weight: 700; color: var(--primary-color); font-size: 12px;">${comment.author}</span>
                        <span style="font-size: 10px; color: var(--dark-gray);">${comment.timestamp}</span>
                    </div>
                    <span style="color: var(--text-dark);">${comment.text}</span>
                </div>
            `;
        });

        card.innerHTML = `
            <div class="post-header">
                <span style="font-weight:700; color:var(--primary-color);">${post.author}</span>
                <span style="font-size:11px; color:var(--dark-gray);">${post.id === "101" ? '📌 Post Fissato Permanente' : 'Scomparirà tra 50 giorni'}</span>
            </div>
            <div class="post-title">${post.title}</div>
            <div class="post-description">${post.description}</div>
            ${attachmentMarkup}
            
            <div class="post-actions" style="margin-bottom: 12px; border-bottom: 1px solid var(--light-gray); padding-bottom: 8px;">
                <button class="btn-post-action" id="btn-like-${post.id}" style="font-weight: 700;">
                    ${likeButtonText} (${post.likes || 0})
                </button>
            </div>

            <div class="post-comments-section" style="margin-top: 10px;">
                <div class="post-comments-list" id="comments-list-${post.id}" style="max-height: 150px; overflow-y: auto; padding-right: 4px;">
                    ${commentsMarkup || '<p style="font-size: 12px; color: var(--dark-gray); font-style: italic; margin-bottom: 8px;">Nessun commento.</p>'}
                </div>
                <div class="add-comment-bar" style="display: flex; gap: 8px; margin-top: 10px; align-items: center;">
                    <input type="text" id="input-comment-${post.id}" placeholder="Aggiungi un commento..." style="flex: 1; padding: 8px 12px; border: 1px solid var(--medium-gray); border-radius: 20px; font-size: 13px; outline: none; background: var(--light-gray);">
                    <button class="btn-primary" id="btn-comment-send-${post.id}" style="padding: 8px 16px; border-radius: 20px; font-size: 12px; border: none; cursor: pointer; font-weight: 700; background: var(--primary-color); color: white;">Invia</button>
                </div>
            </div>
        `;

        container.appendChild(card);

        const likeBtn = document.getElementById(`btn-like-${post.id}`);
        likeBtn.onclick = async () => {
            const userIndex = post.likedBy.indexOf(mockData.user.name);
            if (userIndex > -1) {
                post.likedBy.splice(userIndex, 1);
                post.likes = Math.max(0, (post.likes || 1) - 1);
            } else {
                post.likedBy.push(mockData.user.name);
                post.likes = (post.likes || 0) + 1;
            }
            await saveData();
            renderPosts();
        };

        const commentInput = document.getElementById(`input-comment-${post.id}`);
        const commentSendBtn = document.getElementById(`btn-comment-send-${post.id}`);

        if (commentInput && commentSendBtn) {
            const submitComment = async () => {
                const commentText = commentInput.value.trim();
                if (!commentText) return;

                const newComment = {
                    author: mockData.user.name,
                    text: commentText,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                };

                post.comments.push(newComment);
                await saveData();
                renderPosts();
            };

            commentSendBtn.onclick = submitComment;
            commentInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitComment();
                }
            };
        }
    });
}

function initCommunityHandlers() {
    const btnOpen = document.getElementById('btn-open-create-community');
    const btnClose = document.getElementById('btn-close-create-community');
    const btnPublish = document.getElementById('btn-publish-community');
    const modal = document.getElementById('create-community-modal');
    const dropZone = document.getElementById('community-avatar-drop-zone');
    const fileInput = document.getElementById('community-avatar-input');
    const previewImg = document.getElementById('community-modal-preview');

    if (btnOpen) {
        btnOpen.onclick = () => {
            document.getElementById('community-title').value = '';
            document.getElementById('community-description').value = '';
            communityAttachedAvatar = "https://i.pravatar.cc/150?img=12";
            previewImg.src = communityAttachedAvatar;
            modal.classList.remove('hidden');
        };
    }

    if (btnClose) btnClose.onclick = () => modal.classList.add('hidden');

    if (dropZone && fileInput) {
        fileInput.addEventListener('click', (e) => e.stopPropagation());
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            if(e.target.files && e.target.files[0]) processAndPreviewProfileImg(e.target.files[0], previewImg);
        };

        ['dragenter', 'dragover'].forEach(n => {
            dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(n => {
            dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
        });
        dropZone.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if(file && file.type.startsWith('image/')) processAndPreviewProfileImg(file, previewImg);
        });
    }

    if (btnPublish) {
        btnPublish.onclick = async () => {
            const title = document.getElementById('community-title').value.trim();
            const desc = document.getElementById('community-description').value.trim();

            if(!title || !desc) {
                alert("Compila tutti i campi della community!");
                return;
            }

            const nuovaCommunity = {
                id: String(Date.now()),
                title: title,
                description: desc,
                avatar: previewImg.src,
                subscribed: false,
                messages: []
            };

            if(!mockData.communities) mockData.communities = [];
            mockData.communities.unshift(nuovaCommunity);
            await saveData();
            renderCommunities();
            modal.classList.add('hidden');
        };
    }
}

function renderCommunities() {
    const container = document.getElementById('communities-list-container');
    if (!container) return;
    container.innerHTML = '';
    const searchInput = document.getElementById('search-communities');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const communities = mockData.communities || [];
    const filteredCommunities = communities.filter(c => 
        c.title.toLowerCase().includes(filterText) || 
        c.description.toLowerCase().includes(filterText)
    );

    if(filteredCommunities.length === 0) {
        container.innerHTML = `
            <div class="placeholder-view">
                <div class="placeholder-icon">🌐</div>
                <h3>Esplora nuovi gruppi</h3>
                <p>Nessuna community corrisponde alla ricerca.</p>
            </div>
        `;
        return;
    }

    filteredCommunities.forEach(c => {
        const card = document.createElement('div');
        card.className = 'community-card';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'stretch';
        card.style.gap = '14px';

        const isSubscribed = c.subscribed || false;
        const buttonText = isSubscribed ? "Entra nella chat" : "Iscriviti";
        const buttonClass = isSubscribed ? "btn-secondary" : "btn-primary";

        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${c.avatar}" class="item-avatar" style="width: 50px; height: 50px;">
                <div class="community-info" style="flex: 1; min-width: 0;">
                    <div class="community-name" style="font-weight:700;">${c.title}</div>
                    <div class="community-desc" style="font-size:12px; color:var(--dark-gray); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${c.description}</div>
                </div>
            </div>
            <button class="${buttonClass}" id="btn-sub-${c.id}" style="width:100%; border-radius:8px; padding:8px 0; border:none; cursor:pointer; font-weight:600; font-size:13px;">
                ${buttonText}
            </button>
        `;
        container.appendChild(card);

        document.getElementById(`btn-sub-${c.id}`).onclick = async () => {
            if (!c.subscribed) {
                c.subscribed = true;
                if(!c.messages) c.messages = [];
                c.messages.push({ author: "SocialChat", text: `Ti sei unito alla community "${c.title}"! 🎉`, timestamp: "Adesso", files: [] });
                await saveData();
                renderCommunities();
            }
            openCommunityChat(c);
        };
    });
}

function openCommunityChat(community) {
    activeCommunityChat = community;
    document.getElementById('community-main-panel').classList.add('hidden');
    const chatPanel = document.getElementById('community-chat-panel');
    chatPanel.classList.remove('hidden');

    const header = document.getElementById('community-chat-header');
    header.innerHTML = `
        <button id="btn-back-communities" style="background:none; border:none; color:var(--primary-color); font-size:18px; font-weight:bold; cursor:pointer; padding:4px 8px; margin-right:10px;">←</button>
        <img src="${community.avatar}" class="item-avatar" style="width:40px; height:40px;">
        <div style="flex:1;">
            <h4 style="font-weight:700; font-size:15px; margin:0;">${community.title}</h4>
            <span style="font-size:11px; color:var(--dark-gray); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${community.description}</span>
        </div>
    `;

    document.getElementById('btn-back-communities').onclick = closeCommunityChat;
    renderCommunityMessages();
}

function closeCommunityChat() {
    activeCommunityChat = null;
    const chatPanel = document.getElementById('community-chat-panel');
    if (chatPanel) chatPanel.classList.add('hidden');
    const mainPanel = document.getElementById('community-main-panel');
    if (mainPanel) mainPanel.classList.remove('hidden');
}

function renderCommunityMessages() {
    if (!activeCommunityChat) return;
    const container = document.getElementById('community-chat-messages');
    container.innerHTML = '';

    const messages = activeCommunityChat.messages || [];
    messages.forEach(msg => {
        const isSelf = msg.author === mockData.user.name;
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isSelf ? 'message-sent' : 'message-received'}`;
        bubble.style.alignSelf = isSelf ? 'flex-end' : 'flex-start';

        let filesMarkup = '';
        if (msg.files && msg.files.length > 0) {
            msg.files.forEach(file => {
                if (file.type && file.type.startsWith('image/')) {
                    filesMarkup += `
                        <div style="margin-top:8px;">
                            <img src="${file.dataUrl}" style="max-width:100%; max-height:150px; border-radius:8px; cursor:pointer;" onclick="window.open('${file.dataUrl}', '_blank')">
                            <br><a href="${file.dataUrl}" download="${file.name}" style="color:inherit; font-size:11px; text-decoration:underline; display:inline-block; margin-top:4px;">Scarica ${file.name}</a>
                        </div>`;
                } else {
                    filesMarkup += `
                        <div style="margin-top:8px; display:flex; align-items:center; gap:6px;">
                            <span style="font-size:18px;">📄</span> 
                            <a href="${file.dataUrl}" download="${file.name}" target="_blank" style="color:inherit; font-size:13px; text-decoration:underline; font-weight:600;">Apri ${file.name}</a>
                        </div>`;
                }
            });
        }

        bubble.innerHTML = `
            <div style="font-size: 11px; font-weight: 700; margin-bottom: 2px; color: ${isSelf ? 'white' : 'var(--primary-color)'}; opacity: 0.9;">
                ${msg.author}
            </div>
            <p style="margin:0; white-space: pre-wrap;">${msg.text}</p>
            ${filesMarkup}
            <div class="message-meta" style="${isSelf ? 'color:white; opacity:0.7;' : ''}">${msg.timestamp}</div>
        `;
        container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
}

function initCommunityMessageSystem() {
    const inputWrapper = document.getElementById('community-input-wrapper');
    const textInput = document.getElementById('community-message-input');
    const btnSend = document.getElementById('btn-community-send');

    if (inputWrapper) {
        ['dragenter', 'dragover'].forEach(n => {
            inputWrapper.addEventListener(n, (e) => { e.preventDefault(); inputWrapper.classList.add('drag-over'); });
        });
        ['dragleave', 'drop'].forEach(n => {
            inputWrapper.addEventListener(n, (e) => { e.preventDefault(); inputWrapper.classList.remove('drag-over'); });
        });
        inputWrapper.addEventListener('drop', (e) => {
            if(e.dataTransfer.files.length > 0) handleCommunityFilesToQueue(e.dataTransfer.files);
        });
    }

    if (btnSend) btnSend.onclick = executeCommunityMessageTransmission;
    
    if (textInput) {
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                executeCommunityMessageTransmission();
            }
        });
    }

    const btnCommAttach = document.getElementById('btn-community-attach');
    if (btnCommAttach) {
        btnCommAttach.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('community-attach-menu').classList.toggle('hidden');
        };
    }

    const commAttPhoto = document.getElementById('community-attach-photo');
    if (commAttPhoto) commAttPhoto.onclick = () => document.getElementById('community-photo-input').click();

    const commAttFile = document.getElementById('community-attach-file');
    if (commAttFile) commAttFile.onclick = () => document.getElementById('community-file-input').click();

    const commPhotoIn = document.getElementById('community-photo-input');
    if (commPhotoIn) {
        commPhotoIn.addEventListener('click', (e) => e.stopPropagation());
        commPhotoIn.onchange = (e) => handleCommunityFilesToQueue(e.target.files);
    }

    const commFileIn = document.getElementById('community-file-input');
    if (commFileIn) {
        commFileIn.addEventListener('click', (e) => e.stopPropagation());
        commFileIn.onchange = (e) => handleCommunityFilesToQueue(e.target.files);
    }
}

function handleCommunityFilesToQueue(files) {
    const preview = document.getElementById('community-attachments-preview');
    Array.from(files).forEach(f => {
        selectedCommunityFiles.push(f);
        const thumb = document.createElement('div');
        thumb.className = 'attachment-thumbnail';
        
        if(f.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(f);
            thumb.appendChild(img);
        } else {
            thumb.innerHTML = `<span>Doc...</span>`;
        }

        const rm = document.createElement('button');
        rm.className = 'remove-btn';
        rm.textContent = '✕';
        rm.onclick = (e) => {
            e.stopPropagation();
            selectedCommunityFiles = selectedCommunityFiles.filter(item => item !== f);
            thumb.remove();
        };
        thumb.appendChild(rm);
        preview.appendChild(thumb);
    });
}

async function executeCommunityMessageTransmission() {
    if(!activeCommunityChat) return;

    const input = document.getElementById('community-message-input');
    const msgText = input.value.trim();
    if(!msgText && selectedCommunityFiles.length === 0) return;

    const filePromises = selectedCommunityFiles.map(async (file) => {
        const base64 = await resizeImageFile(file, 1024, 0.7);
        return { name: file.name, type: file.type, dataUrl: base64 };
    });

    const resolvedFiles = await Promise.all(filePromises);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if(!activeCommunityChat.messages) activeCommunityChat.messages = [];
    activeCommunityChat.messages.push({
        author: mockData.user.name,
        text: msgText,
        timestamp: currentTime,
        files: resolvedFiles,
        dateTimestamp: Date.now() 
    });

    await saveData();
    renderCommunityMessages();

    input.value = '';
    selectedCommunityFiles = [];
    document.getElementById('community-attachments-preview').innerHTML = '';
}

// Crea un AbortSignal con timeout compatibile anche con vecchie versioni di
// Safari/iOS dove AbortSignal.timeout() non è disponibile (< iOS 16).
function createTimeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    }
    return undefined;
}

async function saveData() {
    // Salva subito in localStorage (sincrono, funziona offline).
    try {
        const cacheKey = currentAccountEmail ? `socialchat_data_${currentAccountEmail}` : 'socialchat_data';
        localStorage.setItem(cacheKey, JSON.stringify(mockData));
    } catch (err) {
        // Es. QuotaExceededError su iOS: non deve bloccare/rompere l'app.
        console.error("Errore salvataggio localStorage:", err && err.message);
    }

    // Sincronizza con MockAPI in background: NON blocca l'UI.
    // Così la modale/i messaggi si aggiornano subito anche se la rete è lenta
    // o assente (fondamentale su mobile/iPhone dove i retry congelavano l'app).
    syncMockDataToAPI();
}

async function syncMockDataToAPI() {
    if (mockDataRecordId) {
        // Retry logic per MockAPI (più robusto su mobile)
        let retries = 3;
        let success = false;
        let payloadTooLarge = false;

        while (retries > 0 && !success) {
            try {
                const response = await fetch(`${MOCKAPI_BASE_URL}/users/${mockDataRecordId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: 'SocialChat App Data',
                        email: mockDataRecordEmail || 'socialchat_app_data',
                        phone: '',
                        password: '',
                        mockData: mockData
                    }),
                    // Timeout di 10 secondi per evitare blocchi su mobile
                    // (fallback per iOS/Safari senza AbortSignal.timeout)
                    signal: createTimeoutSignal(10000)
                });

                if (response.ok) {
                    success = true;
                    console.log("Salvataggio MockAPI riuscito");
                } else if (response.status === 413) {
                    // Payload troppo grande: ritentare è inutile, il corpo è identico.
                    // Succede con immagini troppo pesanti nel record condiviso.
                    payloadTooLarge = true;
                    console.error("MockAPI: payload troppo grande (413)");
                    break;
                } else {
                    retries--;
                    console.warn(`MockAPI retry (${retries} left) - status: ${response.status}`);
                    if (retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s tra retry
                    }
                }
            } catch (err) {
                retries--;
                console.warn(`MockAPI error retry (${retries} left):`, err.message);
                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        if (!success) {
            console.error("MockAPI salvataggio fallito" + (payloadTooLarge ? " (413 payload troppo grande)" : " dopo 3 tentativi"));
            // Avvisa l'utente solo quando l'immagine è troppo grande: è un problema
            // su cui può agire (usare una foto più piccola) e senza avviso i dati
            // sembrerebbero "dimenticati" al prossimo accesso.
            if (payloadTooLarge && typeof alert === 'function') {
                alert("L'immagine è troppo grande per essere salvata online e potrebbe non essere mantenuta al prossimo accesso. Prova a usare una foto più piccola/leggera.");
            }
        }
    }
}
