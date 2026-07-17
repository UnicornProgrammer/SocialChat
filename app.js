// CONFIGURAZIONE MOCKAPI - Inserisci qui l'URL del tuo progetto MockAPI
const MOCKAPI_BASE_URL = "https://6a5a87fdad8332e75f029048.mockapi.io"; 
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
let mockDataRecordId = null; // ID del record globale su MockAPI
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

async function loadDataFromMockAPI() {
    try {
        const res = await fetch(`${MOCKAPI_BASE_URL}/socialchat_data`);
        if (!res.ok) throw new Error("Impossibile leggere da MockAPI");
        const data = await res.json();
        
        if (data && data.length > 0) {
            mockDataRecordId = data[0].id;
            mockData = data[0].mockData;
        } else {
            // Se vuoto crea il primo record iniziale
            const createRes = await fetch(`${MOCKAPI_BASE_URL}/socialchat_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mockData: initialMockData })
            });
            const created = await createRes.json();
            mockDataRecordId = created.id;
            mockData = created.mockData;
        }
    } catch (err) {
        console.error("Errore MockAPI, fallback su localStorage:", err);
        mockData = JSON.parse(localStorage.getItem('socialchat_data')) || initialMockData;
    }
}

async function checkSessionAndInit() {
    await loadDataFromMockAPI();
    
    const savedProfile = localStorage.getItem('socialchat_myprofile');
    const loginTimestamp = localStorage.getItem('socialchat_login_timestamp');

    if (savedProfile && loginTimestamp) {
        const now = Date.now();
        const elapsedMs = now - parseInt(loginTimestamp, 10);
        const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

        if (elapsedMs > tenDaysMs) {
            logout();
            alert("Sessione scaduta dopo 10 giorni. Effettua nuovamente l'accesso.");
        } else {
            mockData.user = JSON.parse(savedProfile);
            if (!mockData.posts) mockData.posts = initialMockData.posts;
            if (!mockData.communities) mockData.communities = initialMockData.communities;
            
            applyDataRetentionPolicy();
            showMainApplication();
        }
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
    localStorage.removeItem('socialchat_myprofile');
    localStorage.removeItem('socialchat_login_timestamp');

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
                u.telefono.trim() === phone &&
                u.email.trim().toLowerCase() === email.toLowerCase() &&
                u.password === password
            );

            if (utenteTrovato) {
                const emailKey = `socialchat_profile_${email.toLowerCase()}`;
                const savedProfileStr = localStorage.getItem(emailKey);
                let userProfileLoaded = false;

                if (savedProfileStr) {
                    try {
                        const savedProfile = JSON.parse(savedProfileStr);
                        mockData.user = savedProfile;
                        userProfileLoaded = true;
                    } catch (pErr) {
                        console.error("Errore nel parsing del profilo salvato:", pErr);
                    }
                }

                if (!userProfileLoaded) {
                    mockData.user.phone = utenteTrovato.telefono;
                    mockData.user.email = utenteTrovato.email;
                    const localName = email.split('@')[0];
                    mockData.user.name = localName.charAt(0).toUpperCase() + localName.slice(1);
                    mockData.user.bio = 'Sviluppatore appassionato di tecnologia 💻';
                    mockData.user.photo = utenteTrovato.avatar || 'https://i.pravatar.cc/150?img=0';
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

    renderChatsList();
    renderContactsGrid();
    renderPosts();
    renderCommunities();
}

async function initializeFeedbackChat() {
    let feedbackChat = mockData.chats.find(c => c.id === 'feedback');
    if (!feedbackChat) {
        try {
            const res = await fetch(`${MOCKAPI_BASE_URL}/users`);
            if (res.ok) {
                const utenti = await res.json();
                const userNames = utenti.map(u => u.email.split('@')[0]);
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
        });
    });
}

function renderChatsList() {
    const listContainer = document.getElementById('chats-list');
    listContainer.innerHTML = '';
    const searchInput = document.getElementById('search-chats');
    const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredChats = mockData.chats.filter(chat => 
        chat.name.toLowerCase().includes(filterText) || 
        chat.lastMessage.toLowerCase().includes(filterText)
    );

    filteredChats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `list-item ${activeChat && activeChat.id === chat.id ? 'active' : ''}`;
        item.innerHTML = `
            <img src="${chat.avatar}" alt="${chat.name}" class="item-avatar">
            <div class="item-details">
                <div class="item-header">
                    <span class="item-title">${chat.name}</span>
                    <span class="item-meta">${chat.timestamp}</span>
                </div>
                <p class="item-subtitle">${chat.lastMessage}</p>
            </div>
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
    
    let statusLabel = `<span style="font-size:12px; color:#34C759;">Online</span>`;
    if (chat.isGroup) {
        const count = chat.participantCount || 3;
        statusLabel = `<span style="font-size:12px; color:var(--dark-gray); font-weight:600;">Gruppo • ${count} partecipanti</span>`;
    }

    viewportHeader.innerHTML = `
        <div class="chat-header-active" style="width:100%; display:flex; align-items:center; gap:12px;">
            <button id="btn-back-chat" style="background:none; border:none; color:var(--primary-color); font-size:24px; font-weight:bold; cursor:pointer; padding: 4px 8px; display:flex; align-items:center;">←</button>
            <img src="${chat.avatar}" class="item-avatar" style="width:40px; height:40px;">
            <div style="flex:1;">
                <h4 style="font-weight:700; font-size:15px; margin:0;">${chat.name}</h4>
                ${statusLabel}
            </div>
        </div>
    `;

    document.getElementById('btn-back-chat').onclick = () => {
        activeChat = null;
        document.getElementById('message-input-area').classList.add('hidden');
        document.getElementById('chat-header').classList.add('hidden');
        document.getElementById('chat-messages').innerHTML = `
            <div class="chat-placeholder" id="chat-placeholder">
                <div class="placeholder-icon">💬</div>
                <h3>Seleziona una chat</h3>
                <p>Scegli una conversazione dalla lista o creane una nuova per iniziare.</p>
            </div>
        `;
        renderChatsList();
    };

    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (!chat.messages) {
        chat.messages = [
            { author: chat.isGroup ? "Sistema" : chat.name, text: chat.lastMessage, timestamp: chat.timestamp, files: [], dateTimestamp: Date.now() }
        ];
    }

    chat.messages.forEach(m => {
        const isSelf = m.author === 'me' || m.author === mockData.user.name;
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isSelf ? 'message-sent' : 'message-received'}`;

        let senderHeader = '';
        if (chat.isGroup) {
            const displayAuthor = m.author === 'me' ? mockData.user.name : m.author;
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

            mockData.user.name = nuovoNome;
            mockData.user.bio = editBio ? editBio.value.trim() : '';
            if (imgPreview && imgPreview.src) {
                mockData.user.photo = imgPreview.src;
            }
            
            localStorage.setItem('socialchat_myprofile', JSON.stringify(mockData.user));
            
            if (mockData.user.email) {
                const emailKey = `socialchat_profile_${mockData.user.email.toLowerCase()}`;
                localStorage.setItem(emailKey, JSON.stringify(mockData.user));
            }

            await saveData();
            updateProfileWidgetDOM();
            modal.classList.add('hidden');
        });
    }
}

function processAndPreviewProfileImg(file, targetImgElement) {
    const reader = new FileReader();
    reader.onload = (e) => { targetImgElement.src = e.target.result; };
    reader.readAsDataURL(file);
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
                const username = u.email.split('@')[0];
                if(u.telefono === mockData.user.phone || u.email.toLowerCase() === mockData.user.email.toLowerCase()) return;

                const row = document.createElement('div');
                row.className = 'user-selection-row';
                row.innerHTML = `
                    <span class="selection-circle"></span>
                    <span class="selection-row-name">${username} (${u.telefono})</span>
                `;

                row.onclick = () => {
                    row.classList.toggle('selected');
                    if(row.classList.contains('selected')) {
                        selectedUsersForChat.push({ name: username, phone: u.telefono });
                    } else {
                        selectedUsersForChat = selectedUsersForChat.filter(item => item.phone !== u.telefono);
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
        
        const newChat = {
            id: String(Date.now()),
            name: groupName.substring(0, 30),
            avatar: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 50)}`,
            lastMessage: "Chat avviata con successo.",
            timestamp: "Ora",
            isGroup: isGroup,
            participantCount: selectedUsersForChat.length + 1,
            messages: [
                { author: "Sistema", text: "Chat avviata con successo.", timestamp: "Ora", files: [], dateTimestamp: Date.now() }
            ]
        };

        mockData.chats.unshift(newChat);
        await saveData();
        renderChatsList();
        openChatConversation(newChat);
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
            const isSelf = (utente.telefono === mockData.user.phone) || 
                           (utente.email.toLowerCase() === mockData.user.email.toLowerCase());
            
            if (isSelf) return;

            const cleanName = utente.email.split('@')[0];
            const readableName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).replace('.', ' ');
            const bioMockup = `Entusiasta di far parte della community di SocialChat ⚡`;
            const avatarUrl = utente.avatar || `https://i.pravatar.cc/150?img=${(idx + 10) % 70}`;

            if (filterText && !readableName.toLowerCase().includes(filterText) && !utente.telefono.includes(filterText)) {
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
                
                let existingChat = mockData.chats.find(c => c.name === readableName);
                if(!existingChat) {
                    existingChat = { 
                        id: String(Date.now()), 
                        name: readableName, 
                        avatar: avatarUrl, 
                        lastMessage: "Chat appena iniziata con questo contatto.", 
                        timestamp: "Ora", 
                        isGroup: false,
                        messages: [
                            { author: readableName, text: "Chat appena iniziata con questo contatto.", timestamp: "Ora", files: [], dateTimestamp: Date.now() }
                        ]
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
        const base64 = await fileToBase64(file);
        return { name: file.name, type: file.type, dataUrl: base64 };
    });

    const resolvedFiles = await Promise.all(filePromises);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMessage = {
        author: 'me',
        text: msgText,
        timestamp: currentTime,
        files: resolvedFiles,
        dateTimestamp: Date.now() 
    };

    if(activeChat) {
        if (!activeChat.messages) activeChat.messages = [];
        activeChat.messages.push(newMessage);
        activeChat.lastMessage = msgText ? msgText : `📎 File: ${resolvedFiles[0].name}`;
        activeChat.timestamp = currentTime;
        
        await saveData();
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
        const base64 = await fileToBase64(file);
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

async function saveData() {
    localStorage.setItem('socialchat_data', JSON.stringify(mockData));
    
    if (mockDataRecordId) {
        try {
            await fetch(`${MOCKAPI_BASE_URL}/socialchat_data/${mockDataRecordId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mockData: mockData })
            });
        } catch (err) {
            console.error("Errore nel salvataggio su MockAPI:", err);
        }
    }
}