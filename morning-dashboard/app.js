// ===== GOOGLE INTEGRATION =====
const CLIENT_ID = '241584879178-7pl6jtmgf6gq0t8svh5gj7h2j6epd1ie.apps.googleusercontent.com';
const SCOPES = 'profile email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly';
const DISCOVERY_DOCS = [
    'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
    'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
];

let tokenClient;
let gapiInited = false;
let gisInited = false;
let isLoggedIn = false;

let domLoaded = document.readyState !== 'loading';
if (!domLoaded) {
    document.addEventListener('DOMContentLoaded', () => { domLoaded = true; maybeEnableButton(); });
}

// ── Bootstrap ──
window.onGapiLoaded = function() {
    gapi.load('client', async () => {
        await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
        gapiInited = true;
        if (!checkAutoLogin()) {
            maybeEnableButton();
        }
    });
};

window.onGisLoaded = function() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: onTokenResponse
    });
    gisInited = true;
    maybeEnableButton();
};

function maybeEnableButton() {
    if (gapiInited && gisInited && domLoaded && !isLoggedIn) {
        const overlay = document.getElementById('login-overlay');
        if (overlay && overlay.style.display === 'none') {
            overlay.style.display = 'flex';
            setTimeout(() => overlay.classList.remove('login-overlay--hidden'), 10);
        }
        
        const btn = document.getElementById('btn-google-login');
        if (btn) {
            btn.disabled = false;
            btn.querySelector('.login__btn-text').textContent = 'Entrar com Google';
        }
    }
}

// ── Login ──
function handleLogin() {
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function onTokenResponse(resp) {
    if (resp.error) {
        console.error('Auth error:', resp);
        return;
    }

    const expiresAt = new Date().getTime() + ((resp.expires_in || 3600) * 1000);
    localStorage.setItem('gapi_token', JSON.stringify({ token: resp.access_token, expiresAt }));

    await completeLogin(resp.access_token);
}

async function completeLogin(token) {
    isLoggedIn = true;
    gapi.client.setToken({ access_token: token });

    const overlay = document.getElementById('login-overlay');
    overlay.classList.add('login-overlay--hidden');
    setTimeout(() => { if(overlay) overlay.style.display = 'none'; }, 500);
    
    const dashboard = document.getElementById('dashboard-main');
    dashboard.style.opacity = '1';
    dashboard.style.pointerEvents = 'auto';

    showUserProfile();

    await Promise.all([
        fetchUnreadEmails(),
        fetchTodayEvents()
    ]);
}

function checkAutoLogin() {
    const saved = localStorage.getItem('gapi_token');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.expiresAt > new Date().getTime()) {
                isLoggedIn = true;
                completeLogin(data.token);
                return true;
            } else {
                localStorage.removeItem('gapi_token');
            }
        } catch(e){}
    }
    return false;
}

// ── User Profile ──
async function showUserProfile() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const user = await res.json();

        const profileEl = document.getElementById('user-profile');
        if (profileEl && user && !user.error) {
            profileEl.innerHTML = `
                <img src="${user.picture}" alt="${user.name}" class="user__avatar" onerror="this.style.display='none'">
                <div class="user__info">
                    <span class="user__name">${user.given_name || user.name || 'Usuário'}</span>
                    <span class="user__email">${user.email || ''}</span>
                </div>
            `;
            profileEl.style.display = 'flex';
        } else if (profileEl) {
            profileEl.style.display = 'none';
        }
    } catch (e) {
        console.warn('Could not load profile:', e);
    }
}

// ── Gmail: Unread Emails ──
async function fetchUnreadEmails() {
    try {
        const res = await gapi.client.gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
            maxResults: 100
        });

        const total = res.result.resultSizeEstimate || 0;
        const messages = res.result.messages || [];

        // Count today's emails
        let todayCount = 0;
        const todayStr = new Date().toISOString().slice(0, 10);

        // Fetch a few headers to get today count
        const sample = messages.slice(0, 20);
        const details = await Promise.all(
            sample.map(async m => {
                try {
                    return await gapi.client.gmail.users.messages.get({
                        userId: 'me',
                        id: m.id,
                        format: 'metadata',
                        metadataHeaders: ['Date', 'Subject']
                    });
                } catch(e) {
                    return null;
                }
            })
        );

        details.forEach(d => {
            if (!d) return;
            const dateHeader = d.result.payload.headers.find(h => h.name === 'Date');
            if (dateHeader) {
                const msgDate = new Date(dateHeader.value).toISOString().slice(0, 10);
                if (msgDate === todayStr) todayCount++;
            }
        });

        // Update DOM
        const card = document.getElementById('card-emails');
        if (card) {
            card.querySelector('.card__number').textContent = total;
            card.querySelector('.card__sub').textContent = `${todayCount} de hoje`;
        }
    } catch (e) {
        console.error('Gmail error:', e);
        const card = document.getElementById('card-emails');
        if (card) {
            card.querySelector('.card__number').textContent = 'Erro';
            card.querySelector('.card__sub').textContent = 'API não autorizada';
        }
    }
}

// ── Calendar: Today's Events ──
async function fetchTodayEvents() {
    try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const res = await gapi.client.calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 20
        });

        const events = res.result.items || [];

        // Update meetings card
        const card = document.getElementById('card-meetings');
        if (card) {
            card.querySelector('.card__number').textContent = events.length;
            if (events.length > 0) {
                const first = events[0];
                const firstTime = first.start.dateTime
                    ? new Date(first.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    : 'Dia inteiro';
                card.querySelector('.card__sub').textContent = `Próxima às ${firstTime}`;
            } else {
                card.querySelector('.card__sub').textContent = 'Nenhuma reunião hoje 🎉';
            }
        }

        // Update agenda section
        updateAgenda(events);
        setupMeetingAlerts(events);
    } catch (e) {
        console.error('Calendar error:', e);
        const card = document.getElementById('card-meetings');
        if (card) {
            card.querySelector('.card__number').textContent = 'Erro';
            card.querySelector('.card__sub').textContent = 'Falha na API';
        }
        const agendaList = document.querySelector('.agenda__list');
        const agendaCount = document.querySelector('.agenda__count');
        if (agendaList) {
            agendaCount.textContent = 'Erro';
            agendaList.innerHTML = `<li class="agenda__item" style="justify-content:center; color:var(--text-muted); padding:2rem; text-align:center;">
                Falha ao carregar a agenda.<br>A API do Calendar está ativada no Google Cloud? Você marcou a permissão na tela de login?
            </li>`;
        }
    }
}

function updateAgenda(events) {
    const agendaList = document.querySelector('.agenda__list');
    const agendaCount = document.querySelector('.agenda__count');
    if (!agendaList) return;

    agendaCount.textContent = `${events.length} evento${events.length !== 1 ? 's' : ''}`;

    if (events.length === 0) {
        agendaList.innerHTML = `
            <li class="agenda__item" style="justify-content:center; color:var(--text-muted); padding:2rem;">
                Nenhum evento hoje — dia livre! 🎉
            </li>`;
        return;
    }

    const now = new Date();

    agendaList.innerHTML = events.map((ev, i) => {
        const isAllDay = !ev.start.dateTime;
        const start = isAllDay ? null : new Date(ev.start.dateTime);
        const end = isAllDay ? null : new Date(ev.end.dateTime);

        const timeStr = isAllDay
            ? 'Dia'
            : start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        let duration = '';
        if (!isAllDay && start && end) {
            const mins = Math.round((end - start) / 60000);
            duration = mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`;
        } else {
            duration = 'Dia inteiro';
        }

        // First future event is "next"
        const isNext = !isAllDay && start > now &&
            !events.slice(0, i).some(e => e.start.dateTime && new Date(e.start.dateTime) > now);

        const location = ev.location ? ev.location : (ev.hangoutLink ? 'Google Meet' : '');
        const meta = [location].filter(Boolean).join(' · ') || '';
        
        const meetLink = ev.hangoutLink || ev.htmlLink;
        const linkHtml = meetLink ? `<br><a href="${meetLink}" target="_blank" class="agenda__join-btn">🔗 Acessar</a>` : '';

        return `
            <li class="agenda__item ${isNext ? 'agenda__item--next' : ''}">
                <div class="agenda__time">${timeStr}</div>
                <div class="agenda__icon">📅</div>
                <div class="agenda__content">
                    <div class="agenda__event-title">${ev.summary || '(Sem título)'}</div>
                    ${meta ? `<div class="agenda__event-meta">${meta}</div>` : ''}
                    ${linkHtml}
                </div>
                <div class="agenda__duration">${duration}</div>
            </li>`;
    }).join('');
}

// ── Meeting Alerts ──
let alertTimeouts = [];

function setupMeetingAlerts(events) {
    alertTimeouts.forEach(clearTimeout);
    alertTimeouts = [];

    const now = new Date().getTime();

    if (window.Notification && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }

    events.forEach(ev => {
        if (!ev.start.dateTime) return; // Skip all-day events
        const startTime = new Date(ev.start.dateTime).getTime();
        const tenMinsBefore = startTime - (10 * 60 * 1000);
        const timeUntilAlert = tenMinsBefore - now;

        if (timeUntilAlert > 0) {
            const timeoutId = setTimeout(() => {
                showMeetingAlert(ev);
            }, timeUntilAlert);
            alertTimeouts.push(timeoutId);
        }
    });
}

function showMeetingAlert(ev) {
    const title = 'Reunião em 10 minutos!';
    const msg = ev.summary || 'Sem título';

    if (window.Notification && Notification.permission === 'granted') {
        new Notification(title, { body: msg, icon: '📅' });
    }

    const toast = document.createElement('div');
    toast.className = 'meeting-toast';
    toast.innerHTML = `
        <div class="meeting-toast__icon">🔔</div>
        <div class="meeting-toast__content">
            <div class="meeting-toast__title">${title}</div>
            <div class="meeting-toast__msg">${msg}</div>
        </div>
        <button class="meeting-toast__close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.body.appendChild(toast);
    
    // Auto remove after 30 seconds
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 30000);
}



// ── Chart (keep original) ──
function initChart() {
    const ctx = document.getElementById('email-chart').getContext('2d');
    const labels = ['Qui 08', 'Sex 09', 'Sáb 10', 'Dom 11', 'Seg 12', 'Ter 13', 'Qua 14'];
    const data = [12, 5, 8, 20, 3, 15, 9];

    const barColors = data.map((_, i) =>
        i === data.length - 1 ? 'rgba(217,136,161,0.9)' : 'rgba(250,210,225,0.6)'
    );
    const hoverColors = data.map((_, i) =>
        i === data.length - 1 ? 'rgba(217,136,161,1)' : 'rgba(250,210,225,0.9)'
    );
    const borderColors = data.map((_, i) =>
        i === data.length - 1 ? 'rgba(217,136,161,0.8)' : 'rgba(250,210,225,0.8)'
    );

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Emails recebidos',
                data,
                backgroundColor: barColors,
                hoverBackgroundColor: hoverColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 8,
                borderSkipped: false,
                maxBarThickness: 48
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#FFFFFF',
                    titleColor: '#D988A1',
                    bodyColor: '#5C5C5C',
                    borderColor: '#FDE2ED',
                    borderWidth: 2,
                    cornerRadius: 14,
                    padding: 12,
                    titleFont: { family: 'Quicksand', weight: '800', size: 14 },
                    bodyFont: { family: 'Nunito', weight: '600', size: 13 },
                    callbacks: {
                        label: ctx => ctx.parsed.y + ' emails'
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: '#A3A3A3', font: { family: 'Nunito', size: 12, weight: '700' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(226,149,184,0.1)', drawBorder: false },
                    border: { display: false },
                    ticks: { color: '#A3A3A3', font: { family: 'Nunito', size: 11, weight:'700' }, stepSize: 5, padding: 8 }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

// ── Dynamic Date ──
function updateDate() {
    const el = document.getElementById('header-date-text');
    if (!el) return;
    const d = new Date();
    const days = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
    const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    el.textContent = `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
}

// ── Weather (Open-Meteo) ──
async function fetchWeather() {
    try {
        // Guarapari, ES coordinates
        const lat = -20.6667;
        const lon = -40.4950;
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=America%2FSao_Paulo`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.current) return;
        
        const current = data.current;
        
        // Map WMO Weather codes to descriptions and emojis
        const weatherCodes = {
            0: { desc: 'Céu limpo', icon: '☀️' },
            1: { desc: 'Predominantemente limpo', icon: '🌤️' },
            2: { desc: 'Parcialmente nublado', icon: '⛅' },
            3: { desc: 'Nublado', icon: '☁️' },
            45: { desc: 'Nevoeiro', icon: '🌫️' },
            48: { desc: 'Nevoeiro com geada', icon: '🌫️' },
            51: { desc: 'Garoa leve', icon: '🌧️' },
            53: { desc: 'Garoa moderada', icon: '🌧️' },
            55: { desc: 'Garoa densa', icon: '🌧️' },
            56: { desc: 'Garoa congelante leve', icon: '🌧️' },
            57: { desc: 'Garoa congelante densa', icon: '🌧️' },
            61: { desc: 'Chuva leve', icon: '🌧️' },
            63: { desc: 'Chuva moderada', icon: '🌧️' },
            65: { desc: 'Chuva forte', icon: '🌧️' },
            66: { desc: 'Chuva congelante leve', icon: '🌧️' },
            67: { desc: 'Chuva congelante forte', icon: '🌧️' },
            71: { desc: 'Neve leve', icon: '❄️' },
            73: { desc: 'Neve moderada', icon: '❄️' },
            75: { desc: 'Neve forte', icon: '❄️' },
            77: { desc: 'Grãos de neve', icon: '❄️' },
            80: { desc: 'Pancadas de chuva leve', icon: '🌦️' },
            81: { desc: 'Pancadas de chuva moderada', icon: '🌦️' },
            82: { desc: 'Pancadas de chuva violenta', icon: '⛈️' },
            85: { desc: 'Pancadas de neve leve', icon: '❄️' },
            86: { desc: 'Pancadas de neve forte', icon: '❄️' },
            95: { desc: 'Trovoada', icon: '⛈️' },
            96: { desc: 'Trovoada com granizo leve', icon: '⛈️' },
            99: { desc: 'Trovoada com granizo forte', icon: '⛈️' }
        };
        
        const codeInfo = weatherCodes[current.weather_code] || { desc: 'Desconhecido', icon: '⛅' };
        
        document.getElementById('weather-temp').textContent = Math.round(current.temperature_2m);
        document.getElementById('weather-desc').textContent = codeInfo.desc;
        document.getElementById('weather-icon').textContent = codeInfo.icon;
        document.getElementById('weather-humidity').textContent = `${current.relative_humidity_2m}%`;
        document.getElementById('weather-wind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;
        document.getElementById('weather-feels').textContent = `${Math.round(current.apparent_temperature)}°C`;
        
    } catch (e) {
        console.error('Weather error:', e);
        document.getElementById('weather-desc').textContent = 'Erro ao carregar';
    }
}

// ── Fetch Planner Tasks ──
function fetchPlannerTasks() {
    try {
        const raw = localStorage.getItem('plannerV5');
        if (!raw) {
            document.getElementById('planner-tasks-count').textContent = '0';
            document.getElementById('planner-tasks-sub').textContent = 'Planner não iniciado';
            return;
        }
        const data = JSON.parse(raw);
        const today = new Date();
        const key = 'dy' + today.getFullYear() + today.getMonth() + today.getDate();
        
        let pendentes = 0;
        let total = 0;
        if (data.dyData && data.dyData[key] && data.dyData[key].tasks) {
            total = data.dyData[key].tasks.length;
            pendentes = data.dyData[key].tasks.filter(t => !t.done && t.text.trim() !== '').length;
        }
        
        document.getElementById('planner-tasks-count').textContent = pendentes;
        document.getElementById('planner-tasks-sub').textContent = total > 0 ? `${total - pendentes} concluídas hoje` : 'Nenhuma tarefa criada';
    } catch (e) {
        console.error('Error fetching planner tasks:', e);
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    updateDate();
    initChart();
    fetchWeather();
    fetchPlannerTasks();
    // Listen for localStorage changes across tabs
    window.addEventListener('storage', (e) => {
        if(e.key === 'plannerV5') fetchPlannerTasks();
    });
});
