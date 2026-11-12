const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.log("❌ Brakuje TOKEN, CLIENT_ID lub GUILD_ID.");
    process.exit(1);
}

const STAFF_ROLE_NAMES = [
    "Generał Inspektor SW ⚖️👑",
    "Generał SW ⚖️⭐",
    "Dowódca zmiany",
    "zca. Dowódca zmiany",
    "Kapral",
    "Starszy kapral",
    "Plutonowy",
    "Sierżant",
    "Starszy sierżant",
    "Sierżant sztabowy",
    "Starszy sierżant sztabowy",
    "Młodszy chorąży",
    "Chorąży",
    "Starszy chorąży",
    "Chorąży sztabowy",
    "Starszy chorąży sztabowy",
    "Podporucznik",
    "Porucznik",
    "Kapitan",
    "Major",
    "Podpułkownik",
    "Pułkownik",
    "Generał",
    "Generał Inspektor",
    "Inspektor Generalny",
    "Inspektor Generał"
];

// TYLKO ta ranga może pauzować/wznawiać/zmieniać czas kary.
const TIMER_FULL_ROLE_NAMES = [
    "Generał Inspektor SW ⚖️👑",
    "Generał SW ⚖️⭐"
];
const TIMER_EMPLOYEE_ROLE_NAME = "Pracownik SW";

const CHANNEL_OSADZENI = "📍・osadzeni";
const CHANNEL_PRZEPUSTKI = "🎫・przepustki";
const CHANNEL_LOGI = "📜・logi-osadzeni";

const MINUTES_PER_MONTH = 10;
const MINUTES_PER_YEAR = 60;
const TIMER_REFRESH_MS = 15000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "osadzeni.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ nextId: 1, osadzeni: [], przepustki: [] }, null, 2));
}

function loadDatabase() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        if (!data.osadzeni) data.osadzeni = [];
        if (!data.przepustki) data.przepustki = [];
        if (!data.nextId) data.nextId = 1;
        return data;
    } catch {
        return { nextId: 1, osadzeni: [], przepustki: [] };
    }
}

const db = loadDatabase();

function saveDatabase() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Porównuj pełne nazwy stopni, ignorując ozdobniki i końcowe „SW”.
// Nie używaj pozycji roli: wyżej mogą znajdować się role innych służb.
function normalizeStaffRoleName(name) {
    return String(name)
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s+sw$/, "")
        .trim();
}

function hasStaffRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role =>
        STAFF_ROLE_NAMES.some(name =>
            normalizeStaffRoleName(role.name) === normalizeStaffRoleName(name)
        )
    );
}

function hasTimerFullRole(member) {
    if (!member?.roles) return false;
    return TIMER_FULL_ROLE_NAMES.some(name => member.roles.cache.some(role => role.name === name));
}

function hasTimerEmployeeRole(member) {
    if (!member?.roles) return false;
    return member.roles.cache.some(role => role.name === TIMER_EMPLOYEE_ROLE_NAME);
}

function hasTimerPermission(interaction, action) {
    if (hasTimerFullRole(interaction.member)) return true;
    return ["pause", "resume"].includes(action) && hasTimerEmployeeRole(interaction.member);
}

function timerPermissionMessage(action) {
    if (["pause", "resume"].includes(action)) {
        return "❌ Pauzę i kontynuowanie kary może wykonywać **Pracownik SW** oraz **Generał Inspektor SW ⚖️👑** i **Generał SW ⚖️⭐**.";
    }
    return "❌ Dodawanie i odejmowanie czasu może wykonywać wyłącznie **Generał Inspektor SW ⚖️👑** oraz **Generał SW ⚖️⭐**.";
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function hasPermission(interaction) {
    return hasStaffRole(interaction.member) || isAdmin(interaction);
}

function createOsadzonyId() {
    const number = db.nextId++;
    saveDatabase();
    return `O-${String(number).padStart(3, "0")}`;
}

function parseTime(value) {
    if (!value) return null;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function timeToMinutes(value) {
    const time = parseTime(value);
    return time ? time.hours * 60 + time.minutes : null;
}

function minutesToTime(totalMinutes) {
    totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function calculateSentenceMinutes(sentence) {
    if (!sentence) return 0;
    const text = sentence.toLowerCase().replace(/,/g, ".").trim();
    let total = 0;
    const years = text.match(/(\d+(?:\.\d+)?)\s*(rok|lata|lat)/);
    const months = text.match(/(\d+(?:\.\d+)?)\s*(miesiąc|miesiące|miesięcy)/);
    const minutes = text.match(/(\d+(?:\.\d+)?)\s*(min|mina|minut|minuta|minuty)/);
    if (years) total += Number(years[1]) * MINUTES_PER_YEAR;
    if (months) total += Number(months[1]) * MINUTES_PER_MONTH;
    if (minutes) total += Number(minutes[1]);
    return Math.round(total);
}

function calculateDurationBetween(startTime, endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    if (start === null || end === null) return null;
    let difference = end - start;
    if (difference < 0) difference += 1440;
    return difference;
}

function ensureTimer(osadzony) {
    if (typeof osadzony.remainingSeconds !== "number") {
        const duration = Number.isFinite(osadzony.czasKaryMinuty)
            ? osadzony.czasKaryMinuty
            : calculateDurationBetween(osadzony.poczatek, osadzony.koniec) || 0;
        osadzony.remainingSeconds = Math.max(0, Math.round(duration * 60));
        osadzony.paused = false;
        osadzony.timerStartedAt = new Date().toISOString();
        return true;
    }
    if (osadzony.paused || !osadzony.timerStartedAt || osadzony.remainingSeconds <= 0) return false;
    const elapsed = Math.floor((Date.now() - new Date(osadzony.timerStartedAt).getTime()) / 1000);
    if (elapsed <= 0) return false;
    osadzony.remainingSeconds = Math.max(0, osadzony.remainingSeconds - elapsed);
    osadzony.timerStartedAt = new Date().toISOString();
    if (osadzony.remainingSeconds === 0) osadzony.paused = true;
    return true;
}

function getRemainingSeconds(osadzony, persist = false) {
    const changed = ensureTimer(osadzony);
    if (changed && persist) saveDatabase();
    return Math.max(0, Math.floor(osadzony.remainingSeconds || 0));
}

function formatRemaining(seconds) {
    if (seconds <= 0) return "✅ KARA ZAKOŃCZONA";
    const totalMinutes = Math.ceil(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `⏳ **${hours} godz. ${minutes} min.**`;
    return `⏳ **${minutes} min.**`;
}

function getEndTime(osadzony, seconds) {
    if (seconds <= 0) return "Zakończona";
    if (osadzony.paused) return "⏸️ WSTRZYMANA";
    const end = Math.floor((Date.now() + seconds * 1000) / 60000);
    return minutesToTime(end);
}

function getOsadzony(id) {
    return db.osadzeni.find(o => o.id.toLowerCase() === id.toLowerCase());
}

function buildTimerButtons(osadzony) {
    const seconds = getRemainingSeconds(osadzony);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`kara_pause_${osadzony.id}`)
            .setLabel(osadzony.paused ? "Wstrzymana" : "Pauza")
            .setEmoji(osadzony.paused ? "⏸️" : "⏸️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(osadzony.paused || seconds <= 0),
        new ButtonBuilder()
            .setCustomId(`kara_resume_${osadzony.id}`)
            .setLabel("Kontynuuj")
            .setEmoji("▶️")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!osadzony.paused || seconds <= 0),
        new ButtonBuilder()
            .setCustomId(`kara_add_${osadzony.id}`)
            .setLabel("Dodaj czas")
            .setEmoji("➕")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`kara_remove_${osadzony.id}`)
            .setLabel("Odejmij czas")
            .setEmoji("➖")
            .setStyle(ButtonStyle.Danger)
    );
}

function buildOsadzonyEmbed(osadzony) {
    const seconds = getRemainingSeconds(osadzony, true);
    const remainingMinutes = Math.ceil(seconds / 60);
    const durationText = osadzony.paused
        ? `⏸️ WSTRZYMANA • ${remainingMinutes} min.`
        : `${remainingMinutes} minut`;

    return new EmbedBuilder()
        .setTitle(`🔒 KARTA OSADZONEGO — ${osadzony.id}`)
        .setDescription(`## 👤 ${osadzony.imie}\n\n${formatRemaining(seconds)}`)
        .addFields(
            { name: "🆔 ID", value: osadzony.id, inline: true },
            { name: "⚖️ Paragraf", value: osadzony.paragraf, inline: true },
            { name: "📋 Wyrok", value: osadzony.wyrok, inline: true },
            { name: "🔒 Cela", value: osadzony.cela, inline: true },
            { name: "🕐 Początek kary", value: osadzony.poczatek, inline: true },
            { name: "🕐 Koniec kary", value: getEndTime(osadzony, seconds), inline: true },
            { name: "⏱️ Długość / pozostało", value: durationText, inline: true },
            { name: "🎫 Przepustka", value: osadzony.przepustka ? "✅ Udzielona" : "❌ Brak", inline: true },
            { name: "📝 Uwagi", value: osadzony.uwagi || "Brak" }
        )
        .setFooter({ text: "Służba Więzienna • Rejestr Osadzonych • Sterowanie czasem: Generał Inspektor SW ⚖️👑" })
        .setTimestamp();
}

async function sendLog(guild, embed) {
    const channel = guild?.channels.cache.find(ch => ch.name === CHANNEL_LOGI && ch.isTextBased());
    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

async function refreshOsadzonyMessage(osadzony) {
    if (!osadzony.messageId || !osadzony.channelId) return;
    try {
        const channel = await client.channels.fetch(osadzony.channelId);
        if (!channel?.isTextBased()) return;
        const message = await channel.messages.fetch(osadzony.messageId);
        await message.edit({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)] });
    } catch (_) {}
}

// Fikcyjny taryfikator RP; minuty w podpowiedziach to sugerowany wyrok.
const PARAGRAFY_RP = [
    {
        "numer": 1,
        "opis": "Próba kradzieży",
        "minuty": 10
    },
    {
        "numer": 2,
        "opis": "Kradzież mienia",
        "minuty": 15
    },
    {
        "numer": 3,
        "opis": "Kradzież pojazdu",
        "minuty": 20
    },
    {
        "numer": 4,
        "opis": "Włamanie do budynku lub pojazdu",
        "minuty": 20
    },
    {
        "numer": 5,
        "opis": "Rozbój",
        "minuty": 30
    },
    {
        "numer": 6,
        "opis": "Napad z użyciem broni",
        "minuty": 45
    },
    {
        "numer": 7,
        "opis": "Oszustwo majątkowe",
        "minuty": 15
    },
    {
        "numer": 8,
        "opis": "Wymuszenie pieniędzy lub haraczu",
        "minuty": 25
    },
    {
        "numer": 9,
        "opis": "Umyślne zniszczenie mienia",
        "minuty": 10
    },
    {
        "numer": 10,
        "opis": "Groźby karalne",
        "minuty": 10
    },
    {
        "numer": 11,
        "opis": "Pobicie",
        "minuty": 20
    },
    {
        "numer": 12,
        "opis": "Spowodowanie ciężkich obrażeń",
        "minuty": 35
    },
    {
        "numer": 13,
        "opis": "Usiłowanie zabójstwa",
        "minuty": 50
    },
    {
        "numer": 14,
        "opis": "Zabójstwo",
        "minuty": 60
    },
    {
        "numer": 15,
        "opis": "Uprowadzenie lub bezprawne przetrzymywanie osoby",
        "minuty": 40
    },
    {
        "numer": 16,
        "opis": "Wzięcie zakładnika",
        "minuty": 45
    },
    {
        "numer": 17,
        "opis": "Nielegalne posiadanie broni",
        "minuty": 20
    },
    {
        "numer": 18,
        "opis": "Nielegalny handel bronią",
        "minuty": 40
    },
    {
        "numer": 19,
        "opis": "Bezprawne użycie broni, bez spowodowania obrażeń",
        "minuty": 25
    },
    {
        "numer": 20,
        "opis": "Nielegalne posiadanie materiałów wybuchowych",
        "minuty": 35
    },
    {
        "numer": 21,
        "opis": "Spowodowanie wybuchu lub podpalenia zagrażającego ludziom",
        "minuty": 50
    },
    {
        "numer": 22,
        "opis": "Posiadanie substancji zabronionych",
        "minuty": 10
    },
    {
        "numer": 23,
        "opis": "Handel substancjami zabronionymi",
        "minuty": 30
    },
    {
        "numer": 24,
        "opis": "Produkcja substancji zabronionych",
        "minuty": 40
    },
    {
        "numer": 25,
        "opis": "Ucieczka przed patrolem po poleceniu zatrzymania",
        "minuty": 15
    },
    {
        "numer": 26,
        "opis": "Czynna napaść na funkcjonariusza",
        "minuty": 30
    },
    {
        "numer": 27,
        "opis": "Utrudnianie interwencji z użyciem przemocy",
        "minuty": 20
    },
    {
        "numer": 28,
        "opis": "Próba przekupienia funkcjonariusza",
        "minuty": 20
    },
    {
        "numer": 29,
        "opis": "Przyjęcie łapówki przez funkcjonariusza",
        "minuty": 30
    },
    {
        "numer": 30,
        "opis": "Podszywanie się pod funkcjonariusza",
        "minuty": 20
    },
    {
        "numer": 31,
        "opis": "Fałszowanie dokumentów lub posługiwanie się nimi",
        "minuty": 20
    },
    {
        "numer": 32,
        "opis": "Niszczenie albo ukrywanie dowodów",
        "minuty": 15
    },
    {
        "numer": 33,
        "opis": "Celowe składanie fałszywych zeznań",
        "minuty": 15
    },
    {
        "numer": 34,
        "opis": "Udział w zorganizowanej grupie przestępczej",
        "minuty": 35
    },
    {
        "numer": 35,
        "opis": "Kierowanie zorganizowaną grupą przestępczą",
        "minuty": 50
    },
    {
        "numer": 36,
        "opis": "Ucieczka z konwoju lub zakładu karnego",
        "minuty": 30
    },
    {
        "numer": 37,
        "opis": "Próba ucieczki z konwoju lub zakładu karnego",
        "minuty": 15
    },
    {
        "numer": 38,
        "opis": "Pomoc w ucieczce osadzonego",
        "minuty": 25
    },
    {
        "numer": 39,
        "opis": "Przemyt broni lub substancji zabronionych do więzienia",
        "minuty": 25
    },
    {
        "numer": 40,
        "opis": "Zorganizowanie buntu z użyciem przemocy",
        "minuty": 35
    },
    {
        "numer": 41,
        "opis": "Udział w buncie z użyciem przemocy",
        "minuty": 20
    },
    {
        "numer": 42,
        "opis": "Wtargnięcie na zabezpieczony teren zakładu karnego",
        "minuty": 15
    },
    {
        "numer": 43,
        "opis": "Umyślne uszkodzenie zabezpieczeń więzienia",
        "minuty": 20
    },
    {
        "numer": 44,
        "opis": "Niepowrót z przepustki bez usprawiedliwienia",
        "minuty": 15
    },
    {
        "numer": 45,
        "opis": "Celowe spowodowanie wypadku zagrażającego ludziom",
        "minuty": 30
    },
    {
        "numer": 46,
        "opis": "Paserstwo — świadome kupowanie lub sprzedaż skradzionych rzeczy",
        "minuty": 15
    },
    {
        "numer": 47,
        "opis": "Przywłaszczenie powierzonego mienia",
        "minuty": 15
    },
    {
        "numer": 48,
        "opis": "Wyłudzenie okupu",
        "minuty": 30
    },
    {
        "numer": 49,
        "opis": "Szantaż",
        "minuty": 20
    },
    {
        "numer": 50,
        "opis": "Uporczywe nękanie",
        "minuty": 15
    },
    {
        "numer": 51,
        "opis": "Zmuszanie osoby do określonego zachowania przemocą lub groźbą",
        "minuty": 20
    },
    {
        "numer": 52,
        "opis": "Nielegalny handel materiałami wybuchowymi",
        "minuty": 40
    },
    {
        "numer": 53,
        "opis": "Celowe wywołanie fałszywego alarmu o zagrożeniu",
        "minuty": 20
    },
    {
        "numer": 54,
        "opis": "Świadome fałszywe oskarżenie innej osoby o przestępstwo",
        "minuty": 20
    },
    {
        "numer": 55,
        "opis": "Zastraszanie świadka",
        "minuty": 25
    },
    {
        "numer": 56,
        "opis": "Zmuszanie świadka do zmiany zeznań",
        "minuty": 25
    },
    {
        "numer": 57,
        "opis": "Bezprawne ujawnienie danych chronionego świadka",
        "minuty": 25
    },
    {
        "numer": 58,
        "opis": "Złamanie sądowego zakazu zbliżania się",
        "minuty": 15
    },
    {
        "numer": 59,
        "opis": "Niszczenie lub zdejmowanie zabezpieczenia dowodowego",
        "minuty": 15
    },
    {
        "numer": 60,
        "opis": "Uwolnienie osoby zatrzymanej z użyciem przemocy",
        "minuty": 35
    },
    {
        "numer": 61,
        "opis": "Kradzież wyposażenia służbowego",
        "minuty": 25
    },
    {
        "numer": 62,
        "opis": "Bezprawne przekazanie broni służbowej osobie nieuprawnionej",
        "minuty": 35
    },
    {
        "numer": 63,
        "opis": "Nadużycie uprawnień służbowych powodujące szkodę",
        "minuty": 30
    },
    {
        "numer": 64,
        "opis": "Fałszowanie dokumentacji służbowej",
        "minuty": 25
    },
    {
        "numer": 65,
        "opis": "Celowe ujawnienie informacji o konwoju w celu umożliwienia ataku",
        "minuty": 30
    },
    {
        "numer": 66,
        "opis": "Przejęcie pojazdu przez zmuszenie kierowcy do jego oddania",
        "minuty": 30
    },
    {
        "numer": 67,
        "opis": "Prowadzenie pojazdu pod wpływem alkoholu lub narkotyków",
        "minuty": 15
    },
    {
        "numer": 68,
        "opis": "Ucieczka z miejsca wypadku z osobami rannymi",
        "minuty": 20
    },
    {
        "numer": 69,
        "opis": "Celowe blokowanie przejazdu służb ratunkowych podczas akcji",
        "minuty": 15
    },
    {
        "numer": 70,
        "opis": "Sabotaż infrastruktury powodujący zagrożenie dla ludzi",
        "minuty": 40
    },
    {
        "numer": 71,
        "opis": "Usiłowanie rozboju",
        "minuty": 20
    },
    {
        "numer": 72,
        "opis": "Kradzież tożsamości",
        "minuty": 20
    },
    {
        "numer": 73,
        "opis": "Wyłudzenie kredytu lub pożyczki",
        "minuty": 25
    },
    {
        "numer": 74,
        "opis": "Wyłudzenie odszkodowania",
        "minuty": 25
    },
    {
        "numer": 75,
        "opis": "Fałszowanie pieniędzy",
        "minuty": 35
    },
    {
        "numer": 76,
        "opis": "Świadome wprowadzanie fałszywych pieniędzy do obrotu",
        "minuty": 25
    },
    {
        "numer": 77,
        "opis": "Pranie pieniędzy pochodzących z przestępstwa",
        "minuty": 35
    },
    {
        "numer": 78,
        "opis": "Przywłaszczenie środków publicznych",
        "minuty": 30
    },
    {
        "numer": 79,
        "opis": "Organizowanie nielegalnego hazardu",
        "minuty": 20
    },
    {
        "numer": 80,
        "opis": "Ustawianie przetargów w celu osiągnięcia korzyści",
        "minuty": 25
    },
    {
        "numer": 81,
        "opis": "Bezprawne wejście do mieszkania i odmowa jego opuszczenia",
        "minuty": 10
    },
    {
        "numer": 82,
        "opis": "Bezprawne pozbawienie człowieka wolności przez funkcjonariusza",
        "minuty": 35
    },
    {
        "numer": 83,
        "opis": "Znęcanie się nad osobą zależną",
        "minuty": 35
    },
    {
        "numer": 84,
        "opis": "Umyślne narażenie człowieka na bezpośrednie niebezpieczeństwo utraty życia",
        "minuty": 25
    },
    {
        "numer": 85,
        "opis": "Nieudzielenie pomocy osobie w zagrożeniu życia, mimo możliwości bezpiecznego działania",
        "minuty": 15
    },
    {
        "numer": 86,
        "opis": "Nieumyślne spowodowanie śmierci",
        "minuty": 35
    },
    {
        "numer": 87,
        "opis": "Nieumyślne spowodowanie ciężkich obrażeń",
        "minuty": 20
    },
    {
        "numer": 88,
        "opis": "Handel ludźmi",
        "minuty": 60
    },
    {
        "numer": 89,
        "opis": "Zmuszanie człowieka do pracy",
        "minuty": 40
    },
    {
        "numer": 90,
        "opis": "Znęcanie się nad zwierzętami",
        "minuty": 20
    },
    {
        "numer": 91,
        "opis": "Bezprawne uzyskanie dostępu do systemu informatycznego",
        "minuty": 20
    },
    {
        "numer": 92,
        "opis": "Kradzież danych z systemu informatycznego",
        "minuty": 25
    },
    {
        "numer": 93,
        "opis": "Celowe zablokowanie działania systemu informatycznego",
        "minuty": 25
    },
    {
        "numer": 94,
        "opis": "Usuwanie lub zmienianie cudzych danych bez uprawnienia",
        "minuty": 20
    },
    {
        "numer": 95,
        "opis": "Instalowanie oprogramowania szpiegującego bez zgody",
        "minuty": 20
    },
    {
        "numer": 96,
        "opis": "Przechwytywanie prywatnej korespondencji",
        "minuty": 15
    },
    {
        "numer": 97,
        "opis": "Bezprawne ujawnienie dokumentacji medycznej",
        "minuty": 20
    },
    {
        "numer": 98,
        "opis": "Bezprawne ujawnienie informacji niejawnych",
        "minuty": 30
    },
    {
        "numer": 99,
        "opis": "Ukrywanie sprawcy w celu udaremnienia jego zatrzymania",
        "minuty": 20
    },
    {
        "numer": 100,
        "opis": "Świadome fabrykowanie dowodów przeciwko innej osobie",
        "minuty": 30
    },
    {
        "numer": 101,
        "opis": "Nakłanianie innej osoby do popełnienia przestępstwa",
        "minuty": 20
    },
    {
        "numer": 102,
        "opis": "Świadome finansowanie działalności przestępczej",
        "minuty": 35
    },
    {
        "numer": 103,
        "opis": "Używanie przemocy w celu wymuszenia decyzji urzędowej",
        "minuty": 30
    },
    {
        "numer": 104,
        "opis": "Niestosowanie się do sądowego zakazu prowadzenia pojazdów",
        "minuty": 20
    },
    {
        "numer": 105,
        "opis": "Prowadzenie pojazdu pomimo cofnięcia uprawnień",
        "minuty": 15
    },
    {
        "numer": 106,
        "opis": "Organizowanie nielegalnego wyścigu stwarzającego zagrożenie",
        "minuty": 20
    },
    {
        "numer": 107,
        "opis": "Udział w nielegalnym wyścigu stwarzającym zagrożenie",
        "minuty": 15
    },
    {
        "numer": 108,
        "opis": "Nieumyślne spowodowanie wypadku z ciężko rannymi",
        "minuty": 25
    },
    {
        "numer": 109,
        "opis": "Nieumyślne spowodowanie śmiertelnego wypadku",
        "minuty": 40
    },
    {
        "numer": 110,
        "opis": "Manipulowanie sygnalizacją drogową i stworzenie zagrożenia",
        "minuty": 30
    },
    {
        "numer": 111,
        "opis": "Ustawienie niebezpiecznej przeszkody na drodze",
        "minuty": 25
    },
    {
        "numer": 112,
        "opis": "Rzucanie przedmiotami w jadące pojazdy i stworzenie zagrożenia",
        "minuty": 20
    },
    {
        "numer": 113,
        "opis": "Celowe skażenie wody pitnej",
        "minuty": 50
    },
    {
        "numer": 114,
        "opis": "Porzucenie niebezpiecznych odpadów i zagrożenie ludziom",
        "minuty": 30
    },
    {
        "numer": 115,
        "opis": "Celowe uszkodzenie sprzętu ratunkowego",
        "minuty": 25
    },
    {
        "numer": 116,
        "opis": "Bezprawne posiadanie amunicji",
        "minuty": 15
    },
    {
        "numer": 117,
        "opis": "Nielegalne wytwarzanie broni",
        "minuty": 40
    },
    {
        "numer": 118,
        "opis": "Usunięcie oznaczeń identyfikacyjnych broni",
        "minuty": 20
    },
    {
        "numer": 119,
        "opis": "Przerabianie numeru VIN pojazdu",
        "minuty": 20
    },
    {
        "numer": 120,
        "opis": "Używanie tablic rejestracyjnych przypisanych do innego pojazdu",
        "minuty": 15
    },
    {
        "numer": 121,
        "opis": "Przygotowanie napadu przez gromadzenie broni i ustalenie planu",
        "minuty": 20
    },
    {
        "numer": 122,
        "opis": "Zlecenie zabójstwa",
        "minuty": 60
    },
    {
        "numer": 123,
        "opis": "Zlecenie pobicia",
        "minuty": 25
    },
    {
        "numer": 124,
        "opis": "Stosowanie tortur",
        "minuty": 50
    },
    {
        "numer": 125,
        "opis": "Umyślne podanie trucizny z zamiarem wyrządzenia krzywdy",
        "minuty": 40
    },
    {
        "numer": 126,
        "opis": "Podanie środka odurzającego bez wiedzy i zgody osoby",
        "minuty": 30
    },
    {
        "numer": 127,
        "opis": "Porzucenie osoby pozostającej pod opieką w warunkach zagrożenia",
        "minuty": 25
    },
    {
        "numer": 128,
        "opis": "Zorganizowanie zasadzki na konwój",
        "minuty": 40
    },
    {
        "numer": 129,
        "opis": "Przejęcie kontroli nad statkiem powietrznym siłą lub groźbą",
        "minuty": 60
    },
    {
        "numer": 130,
        "opis": "Przejęcie kontroli nad pociągiem siłą lub groźbą",
        "minuty": 50
    },
    {
        "numer": 131,
        "opis": "Umyślne spowodowanie katastrofy komunikacyjnej",
        "minuty": 60
    },
    {
        "numer": 132,
        "opis": "Oślepianie pilota i stworzenie zagrożenia dla lotu",
        "minuty": 30
    },
    {
        "numer": 133,
        "opis": "Bezprawne wtargnięcie na czynny pas startowy i stworzenie zagrożenia",
        "minuty": 25
    },
    {
        "numer": 134,
        "opis": "Umyślne uszkodzenie torów kolejowych",
        "minuty": 40
    },
    {
        "numer": 135,
        "opis": "Bezprawne odłączenie aparatury podtrzymującej życie",
        "minuty": 50
    },
    {
        "numer": 136,
        "opis": "Kradzież leków kontrolowanych z placówki medycznej",
        "minuty": 25
    },
    {
        "numer": 137,
        "opis": "Nielegalny handel lekami kontrolowanymi",
        "minuty": 30
    },
    {
        "numer": 138,
        "opis": "Fałszowanie recept",
        "minuty": 20
    },
    {
        "numer": 139,
        "opis": "Wykonywanie zabiegów medycznych bez uprawnień i narażenie pacjenta",
        "minuty": 30
    },
    {
        "numer": 140,
        "opis": "Świadome podanie pacjentowi szkodliwej substancji zamiast leku",
        "minuty": 40
    },
    {
        "numer": 141,
        "opis": "Wymuszanie pieniędzy lub rzeczy od współosadzonego",
        "minuty": 20
    },
    {
        "numer": 142,
        "opis": "Zmuszanie współosadzonego do popełnienia przestępstwa",
        "minuty": 25
    },
    {
        "numer": 143,
        "opis": "Kradzież kluczy lub kart dostępu do zakładu karnego",
        "minuty": 20
    },
    {
        "numer": 144,
        "opis": "Wykonanie lub posiadanie narzędzia przeznaczonego do ucieczki",
        "minuty": 15
    },
    {
        "numer": 145,
        "opis": "Celowe uszkodzenie elektronicznego urządzenia dozoru",
        "minuty": 15
    },
    {
        "numer": 146,
        "opis": "Bezprawne umożliwienie osadzonemu opuszczenia zakładu przez funkcjonariusza",
        "minuty": 35
    },
    {
        "numer": 147,
        "opis": "Zmuszanie osadzonego przemocą do złożenia oświadczenia",
        "minuty": 30
    },
    {
        "numer": 148,
        "opis": "Bezprawne przetrzymywanie osadzonego po zakończeniu kary",
        "minuty": 30
    },
    {
        "numer": 149,
        "opis": "Przekupienie świadka w zamian za fałszywe zeznania",
        "minuty": 25
    },
    {
        "numer": 150,
        "opis": "Przyjęcie korzyści przez świadka w zamian za fałszywe zeznania",
        "minuty": 20
    },
    {
        "numer": 151,
        "opis": "Fałszowanie opinii przez biegłego",
        "minuty": 25
    },
    {
        "numer": 152,
        "opis": "Bezprawne usunięcie akt sprawy z sądu lub urzędu",
        "minuty": 25
    },
    {
        "numer": 153,
        "opis": "Sprzedaż cudzej nieruchomości przy użyciu fałszywego pełnomocnictwa",
        "minuty": 30
    },
    {
        "numer": 154,
        "opis": "Wielokrotna sprzedaż tego samego pojazdu różnym osobom w celu oszustwa",
        "minuty": 25
    },
    {
        "numer": 155,
        "opis": "Organizowanie fikcyjnej zbiórki pieniędzy",
        "minuty": 20
    },
    {
        "numer": 156,
        "opis": "Wymuszanie opłat za pozorną ochronę firmy",
        "minuty": 25
    },
    {
        "numer": 157,
        "opis": "Ukrywanie majątku objętego zajęciem sądowym",
        "minuty": 20
    },
    {
        "numer": 158,
        "opis": "Celowe niszczenie zabytku",
        "minuty": 25
    },
    {
        "numer": 159,
        "opis": "Okradanie zwłok lub miejsca pochówku",
        "minuty": 20
    },
    {
        "numer": 160,
        "opis": "Bezprawne ukrycie zwłok w celu zatajenia śmierci",
        "minuty": 30
    },
    {
        "numer": 161,
        "opis": "Włamanie do skarbca bankowego",
        "minuty": 25
    },
    {
        "numer": 162,
        "opis": "Kradzież ładunku z transportu towarowego",
        "minuty": 20
    },
    {
        "numer": 163,
        "opis": "Kradzież paliwa z magazynu hurtowego",
        "minuty": 20
    },
    {
        "numer": 164,
        "opis": "Kradzież materiałów niebezpiecznych z zakładu",
        "minuty": 25
    },
    {
        "numer": 165,
        "opis": "Kradzież sprzętu z placu budowy",
        "minuty": 20
    },
    {
        "numer": 166,
        "opis": "Kradzież radiowozu z jednostki",
        "minuty": 25
    },
    {
        "numer": 167,
        "opis": "Kradzież ambulansu podczas akcji",
        "minuty": 25
    },
    {
        "numer": 168,
        "opis": "Kradzież wozu strażackiego podczas akcji",
        "minuty": 25
    },
    {
        "numer": 169,
        "opis": "Kradzież łodzi z przystani",
        "minuty": 20
    },
    {
        "numer": 170,
        "opis": "Kradzież śmigłowca z hangaru",
        "minuty": 30
    },
    {
        "numer": 171,
        "opis": "Kradzież przesyłek z sortowni",
        "minuty": 20
    },
    {
        "numer": 172,
        "opis": "Kradzież urządzeń z infrastruktury kolejowej",
        "minuty": 20
    },
    {
        "numer": 173,
        "opis": "Kradzież energii przez nielegalne przyłącze",
        "minuty": 15
    },
    {
        "numer": 174,
        "opis": "Kradzież wody przez obejście licznika",
        "minuty": 15
    },
    {
        "numer": 175,
        "opis": "Kradzież gazu przez nielegalne przyłącze",
        "minuty": 20
    },
    {
        "numer": 176,
        "opis": "Włamanie do magazynu dowodów",
        "minuty": 25
    },
    {
        "numer": 177,
        "opis": "Kradzież dokumentów z kancelarii tajnej",
        "minuty": 25
    },
    {
        "numer": 178,
        "opis": "Kradzież wyposażenia wojskowego z magazynu",
        "minuty": 20
    },
    {
        "numer": 179,
        "opis": "Kradzież eksponatu z muzeum",
        "minuty": 20
    },
    {
        "numer": 180,
        "opis": "Kradzież depozytów osadzonych przez personel",
        "minuty": 25
    },
    {
        "numer": 181,
        "opis": "Wyłudzenie zapłaty za nieistniejący pojazd",
        "minuty": 20
    },
    {
        "numer": 182,
        "opis": "Wyłudzenie zaliczki za nieistniejące mieszkanie",
        "minuty": 20
    },
    {
        "numer": 183,
        "opis": "Wyłudzenie opłaty za fikcyjną usługę transportową",
        "minuty": 20
    },
    {
        "numer": 184,
        "opis": "Wyłudzenie zapłaty za niewykonaną naprawę",
        "minuty": 20
    },
    {
        "numer": 185,
        "opis": "Wyłudzenie dotacji na podstawie fikcyjnej działalności",
        "minuty": 25
    },
    {
        "numer": 186,
        "opis": "Wyłudzenie świadczenia przy użyciu cudzej tożsamości",
        "minuty": 20
    },
    {
        "numer": 187,
        "opis": "Wyłudzenie przelewu przez podszywanie się pod bank",
        "minuty": 25
    },
    {
        "numer": 188,
        "opis": "Wyłudzenie pieniędzy przez podszywanie się pod krewnego",
        "minuty": 25
    },
    {
        "numer": 189,
        "opis": "Wyłudzenie pieniędzy pod pozorem działań Policji",
        "minuty": 25
    },
    {
        "numer": 190,
        "opis": "Wyłudzenie kaucji za nieistniejący najem",
        "minuty": 20
    },
    {
        "numer": 191,
        "opis": "Sprzedaż świadomie sfałszowanego aktu własności",
        "minuty": 25
    },
    {
        "numer": 192,
        "opis": "Oszustwo przy sprzedaży pojazdu objętego zajęciem",
        "minuty": 25
    },
    {
        "numer": 193,
        "opis": "Zatajenie poważnej usterki pojazdu w celu oszustwa",
        "minuty": 20
    },
    {
        "numer": 194,
        "opis": "Fałszowanie przebiegu pojazdu w celu oszustwa",
        "minuty": 20
    },
    {
        "numer": 195,
        "opis": "Wyłudzenie zwrotu podatku przy użyciu fikcyjnych faktur",
        "minuty": 25
    },
    {
        "numer": 196,
        "opis": "Organizowanie piramidy finansowej",
        "minuty": 25
    },
    {
        "numer": 197,
        "opis": "Przejęcie cudzej wypłaty przy użyciu fałszywego upoważnienia",
        "minuty": 20
    },
    {
        "numer": 198,
        "opis": "Wyłudzenie towaru przy użyciu fałszywego potwierdzenia przelewu",
        "minuty": 20
    },
    {
        "numer": 199,
        "opis": "Wyłudzenie pieniędzy za fikcyjną inwestycję",
        "minuty": 25
    },
    {
        "numer": 200,
        "opis": "Celowe spowodowanie kolizji w celu wyłudzenia odszkodowania",
        "minuty": 25
    },
    {
        "numer": 201,
        "opis": "Podrobienie dokumentu tożsamości",
        "minuty": 20
    },
    {
        "numer": 202,
        "opis": "Podrobienie prawa jazdy",
        "minuty": 20
    },
    {
        "numer": 203,
        "opis": "Podrobienie dowodu rejestracyjnego",
        "minuty": 20
    },
    {
        "numer": 204,
        "opis": "Podrobienie pozwolenia na broń",
        "minuty": 25
    },
    {
        "numer": 205,
        "opis": "Podrobienie legitymacji służbowej",
        "minuty": 25
    },
    {
        "numer": 206,
        "opis": "Podrobienie nakazu zatrzymania",
        "minuty": 25
    },
    {
        "numer": 207,
        "opis": "Podrobienie nakazu przeszukania",
        "minuty": 25
    },
    {
        "numer": 208,
        "opis": "Podrobienie orzeczenia sądu",
        "minuty": 25
    },
    {
        "numer": 209,
        "opis": "Podrobienie dokumentu zwolnienia z więzienia",
        "minuty": 25
    },
    {
        "numer": 210,
        "opis": "Podrobienie przepustki więziennej",
        "minuty": 20
    },
    {
        "numer": 211,
        "opis": "Podrobienie zaświadczenia lekarskiego",
        "minuty": 20
    },
    {
        "numer": 212,
        "opis": "Podrobienie świadectwa kwalifikacji medycznych",
        "minuty": 25
    },
    {
        "numer": 213,
        "opis": "Podrobienie zaświadczenia o badaniu technicznym",
        "minuty": 20
    },
    {
        "numer": 214,
        "opis": "Podrobienie polisy ubezpieczeniowej",
        "minuty": 20
    },
    {
        "numer": 215,
        "opis": "Podrobienie pełnomocnictwa do konta bankowego",
        "minuty": 20
    },
    {
        "numer": 216,
        "opis": "Podrobienie umowy zatrudnienia w celu wyłudzenia",
        "minuty": 20
    },
    {
        "numer": 217,
        "opis": "Podrobienie zezwolenia na przewóz niebezpiecznych materiałów",
        "minuty": 20
    },
    {
        "numer": 218,
        "opis": "Podrobienie protokołu kontroli budowlanej",
        "minuty": 20
    },
    {
        "numer": 219,
        "opis": "Podrobienie protokołu zabezpieczenia dowodów",
        "minuty": 25
    },
    {
        "numer": 220,
        "opis": "Podrobienie podpisu sędziego w dokumentacji sprawy",
        "minuty": 25
    },
    {
        "numer": 221,
        "opis": "Przejęcie konta bankowego bez uprawnienia",
        "minuty": 25
    },
    {
        "numer": 222,
        "opis": "Przejęcie konta urzędnika w systemie służbowym",
        "minuty": 20
    },
    {
        "numer": 223,
        "opis": "Wyłudzanie haseł przez fałszywą stronę logowania",
        "minuty": 25
    },
    {
        "numer": 224,
        "opis": "Szyfrowanie cudzych danych w celu wymuszenia okupu",
        "minuty": 30
    },
    {
        "numer": 225,
        "opis": "Sprzedaż wykradzionej bazy danych mieszkańców",
        "minuty": 25
    },
    {
        "numer": 226,
        "opis": "Sprzedaż wykradzionych danych kart płatniczych",
        "minuty": 25
    },
    {
        "numer": 227,
        "opis": "Bezprawna zmiana salda w systemie bankowym",
        "minuty": 20
    },
    {
        "numer": 228,
        "opis": "Bezprawna zmiana wpisów w rejestrze wyroków",
        "minuty": 25
    },
    {
        "numer": 229,
        "opis": "Bezprawna zmiana wpisów w rejestrze pojazdów",
        "minuty": 25
    },
    {
        "numer": 230,
        "opis": "Bezprawna zmiana danych w ewidencji osadzonych",
        "minuty": 25
    },
    {
        "numer": 231,
        "opis": "Sabotaż systemu numeru alarmowego",
        "minuty": 30
    },
    {
        "numer": 232,
        "opis": "Sabotaż systemu dyspozytorni ratunkowej",
        "minuty": 30
    },
    {
        "numer": 233,
        "opis": "Bezprawne przejęcie obrazu monitoringu więzienia",
        "minuty": 25
    },
    {
        "numer": 234,
        "opis": "Instalacja ukrytego podsłuchu w pomieszczeniu służbowym",
        "minuty": 20
    },
    {
        "numer": 235,
        "opis": "Bezprawne kopiowanie karty dostępu do obiektu chronionego",
        "minuty": 20
    },
    {
        "numer": 236,
        "opis": "Przejęcie sterowania bramą więzienną przez system komputerowy",
        "minuty": 25
    },
    {
        "numer": 237,
        "opis": "Zakłócanie łączności radiowej podczas akcji ratunkowej",
        "minuty": 30
    },
    {
        "numer": 238,
        "opis": "Nadawanie fałszywych rozkazów na kanale służbowym",
        "minuty": 25
    },
    {
        "numer": 239,
        "opis": "Usuwanie kopii zapasowych w celu ukrycia przestępstwa",
        "minuty": 25
    },
    {
        "numer": 240,
        "opis": "Bezprawna sprzedaż danych lokalizacyjnych funkcjonariusza",
        "minuty": 20
    },
    {
        "numer": 241,
        "opis": "Przemyt broni przez granicę",
        "minuty": 30
    },
    {
        "numer": 242,
        "opis": "Przemyt amunicji przez granicę",
        "minuty": 30
    },
    {
        "numer": 243,
        "opis": "Przemyt materiałów wybuchowych przez granicę",
        "minuty": 35
    },
    {
        "numer": 244,
        "opis": "Przemyt substancji zabronionych przez granicę",
        "minuty": 25
    },
    {
        "numer": 245,
        "opis": "Organizowanie magazynu nielegalnej broni",
        "minuty": 25
    },
    {
        "numer": 246,
        "opis": "Przerabianie broni na automatyczną bez zezwolenia",
        "minuty": 30
    },
    {
        "numer": 247,
        "opis": "Wytwarzanie amunicji bez wymaganego zezwolenia",
        "minuty": 25
    },
    {
        "numer": 248,
        "opis": "Przekazanie broni osobie planującej napad",
        "minuty": 30
    },
    {
        "numer": 249,
        "opis": "Użycie broni do wymuszenia opuszczenia lokalu",
        "minuty": 30
    },
    {
        "numer": 250,
        "opis": "Oddanie strzałów w kierunku zamieszkanego budynku",
        "minuty": 35
    },
    {
        "numer": 251,
        "opis": "Oddanie strzałów w kierunku jadącego pojazdu",
        "minuty": 35
    },
    {
        "numer": 252,
        "opis": "Ostrzelanie infrastruktury energetycznej",
        "minuty": 30
    },
    {
        "numer": 253,
        "opis": "Podłożenie ładunku wybuchowego w budynku publicznym",
        "minuty": 35
    },
    {
        "numer": 254,
        "opis": "Podłożenie ładunku wybuchowego pod pojazdem",
        "minuty": 35
    },
    {
        "numer": 255,
        "opis": "Zdetonowanie ładunku przy drodze publicznej",
        "minuty": 40
    },
    {
        "numer": 256,
        "opis": "Przemyt zapalników do zakładu karnego",
        "minuty": 30
    },
    {
        "numer": 257,
        "opis": "Celowe przekazanie broni osobie nietrzeźwej",
        "minuty": 25
    },
    {
        "numer": 258,
        "opis": "Sprzedaż broni z zatartymi oznaczeniami",
        "minuty": 30
    },
    {
        "numer": 259,
        "opis": "Bezprawne wyniesienie amunicji ze zbrojowni",
        "minuty": 25
    },
    {
        "numer": 260,
        "opis": "Bezprawne wyniesienie materiałów wybuchowych z magazynu",
        "minuty": 35
    },
    {
        "numer": 261,
        "opis": "Uprawa roślin przeznaczonych do produkcji substancji zabronionych",
        "minuty": 25
    },
    {
        "numer": 262,
        "opis": "Prowadzenie laboratorium substancji zabronionych",
        "minuty": 30
    },
    {
        "numer": 263,
        "opis": "Magazynowanie substancji zabronionych w celu dystrybucji",
        "minuty": 25
    },
    {
        "numer": 264,
        "opis": "Przewóz substancji zabronionych na zlecenie handlarza",
        "minuty": 20
    },
    {
        "numer": 265,
        "opis": "Finansowanie produkcji substancji zabronionych",
        "minuty": 25
    },
    {
        "numer": 266,
        "opis": "Werbowanie kurierów do przemytu substancji zabronionych",
        "minuty": 25
    },
    {
        "numer": 267,
        "opis": "Sprzedaż substancji zabronionych na terenie szkoły",
        "minuty": 30
    },
    {
        "numer": 268,
        "opis": "Sprzedaż substancji zabronionych na terenie szpitala",
        "minuty": 25
    },
    {
        "numer": 269,
        "opis": "Wprowadzenie substancji zabronionych do obrotu w więzieniu",
        "minuty": 30
    },
    {
        "numer": 270,
        "opis": "Zmuszanie innej osoby do transportu substancji zabronionych",
        "minuty": 30
    },
    {
        "numer": 271,
        "opis": "Ukrycie substancji zabronionych w cudzym bagażu",
        "minuty": 25
    },
    {
        "numer": 272,
        "opis": "Podanie substancji odurzającej kierowcy bez jego wiedzy",
        "minuty": 25
    },
    {
        "numer": 273,
        "opis": "Świadoma sprzedaż skażonych substancji odurzających",
        "minuty": 30
    },
    {
        "numer": 274,
        "opis": "Kradzież prekursorów z zakładu chemicznego",
        "minuty": 20
    },
    {
        "numer": 275,
        "opis": "Bezprawne dostarczenie prekursorów do nielegalnego laboratorium",
        "minuty": 25
    },
    {
        "numer": 276,
        "opis": "Fałszowanie ewidencji leków kontrolowanych",
        "minuty": 20
    },
    {
        "numer": 277,
        "opis": "Wydawanie leków kontrolowanych na fikcyjne recepty",
        "minuty": 25
    },
    {
        "numer": 278,
        "opis": "Produkcja podrobionych leków zagrażających zdrowiu",
        "minuty": 30
    },
    {
        "numer": 279,
        "opis": "Sprzedaż podrobionych leków ze świadomością zagrożenia",
        "minuty": 25
    },
    {
        "numer": 280,
        "opis": "Celowe odurzanie pracownika ochrony w celu włamania",
        "minuty": 25
    },
    {
        "numer": 281,
        "opis": "Umyślne uszkodzenie mostu używanego w ruchu",
        "minuty": 30
    },
    {
        "numer": 282,
        "opis": "Umyślne uszkodzenie tunelu drogowego",
        "minuty": 30
    },
    {
        "numer": 283,
        "opis": "Usunięcie znaków ostrzegających o zamkniętej drodze",
        "minuty": 25
    },
    {
        "numer": 284,
        "opis": "Przestawienie zapór kierujące ruch na niebezpieczny odcinek",
        "minuty": 25
    },
    {
        "numer": 285,
        "opis": "Celowe rozlanie oleju na jezdni",
        "minuty": 25
    },
    {
        "numer": 286,
        "opis": "Uszkodzenie hamulców cudzego pojazdu",
        "minuty": 30
    },
    {
        "numer": 287,
        "opis": "Uszkodzenie układu kierowniczego cudzego pojazdu",
        "minuty": 30
    },
    {
        "numer": 288,
        "opis": "Celowe odłączenie oświetlenia tunelu podczas ruchu",
        "minuty": 25
    },
    {
        "numer": 289,
        "opis": "Sabotaż sygnalizacji na przejeździe kolejowym",
        "minuty": 25
    },
    {
        "numer": 290,
        "opis": "Ustawienie przeszkody na torach kolejowych",
        "minuty": 30
    },
    {
        "numer": 291,
        "opis": "Wykolejenie wagonu bez osób poszkodowanych",
        "minuty": 30
    },
    {
        "numer": 292,
        "opis": "Bezprawne przełożenie zwrotnicy pod nadjeżdżającym pociągiem",
        "minuty": 25
    },
    {
        "numer": 293,
        "opis": "Uszkodzenie systemu sterowania ruchem kolejowym",
        "minuty": 30
    },
    {
        "numer": 294,
        "opis": "Uszkodzenie urządzeń nawigacyjnych lotniska",
        "minuty": 30
    },
    {
        "numer": 295,
        "opis": "Zakłócanie łączności kontroli ruchu lotniczego",
        "minuty": 30
    },
    {
        "numer": 296,
        "opis": "Skierowanie drona w tor lotu śmigłowca ratunkowego",
        "minuty": 25
    },
    {
        "numer": 297,
        "opis": "Celowe uszkodzenie śmigłowca przed startem",
        "minuty": 30
    },
    {
        "numer": 298,
        "opis": "Usunięcie oznakowania niebezpiecznej przeszkody na wodzie",
        "minuty": 25
    },
    {
        "numer": 299,
        "opis": "Celowe zatopienie cudzej jednostki pływającej",
        "minuty": 30
    },
    {
        "numer": 300,
        "opis": "Zablokowanie drogi ewakuacyjnej podczas realnego zagrożenia",
        "minuty": 25
    },
    {
        "numer": 301,
        "opis": "Podpalenie lasu",
        "minuty": 30
    },
    {
        "numer": 302,
        "opis": "Podpalenie magazynu paliw",
        "minuty": 30
    },
    {
        "numer": 303,
        "opis": "Podpalenie pustego budynku w celu zniszczenia mienia",
        "minuty": 25
    },
    {
        "numer": 304,
        "opis": "Podpalenie pojazdu na parkingu podziemnym",
        "minuty": 30
    },
    {
        "numer": 305,
        "opis": "Celowe rozszczelnienie instalacji gazowej",
        "minuty": 30
    },
    {
        "numer": 306,
        "opis": "Celowe uszkodzenie hydrantów podczas pożaru",
        "minuty": 25
    },
    {
        "numer": 307,
        "opis": "Odłączenie instalacji przeciwpożarowej w celu sabotażu",
        "minuty": 25
    },
    {
        "numer": 308,
        "opis": "Celowe zablokowanie wyjść awaryjnych przed podpaleniem",
        "minuty": 30
    },
    {
        "numer": 309,
        "opis": "Wylanie toksycznych substancji do rzeki",
        "minuty": 25
    },
    {
        "numer": 310,
        "opis": "Zakopanie toksycznych odpadów na terenie mieszkalnym",
        "minuty": 25
    },
    {
        "numer": 311,
        "opis": "Spalenie odpadów toksycznych z narażeniem ludzi",
        "minuty": 25
    },
    {
        "numer": 312,
        "opis": "Celowe skażenie żywności przeznaczonej do sprzedaży",
        "minuty": 30
    },
    {
        "numer": 313,
        "opis": "Celowe skażenie zapasów żywności w więzieniu",
        "minuty": 30
    },
    {
        "numer": 314,
        "opis": "Bezprawne składowanie materiałów radioaktywnych",
        "minuty": 25
    },
    {
        "numer": 315,
        "opis": "Porzucenie materiałów radioaktywnych w miejscu publicznym",
        "minuty": 30
    },
    {
        "numer": 316,
        "opis": "Uszkodzenie kanalizacji powodujące skażenie terenu",
        "minuty": 25
    },
    {
        "numer": 317,
        "opis": "Uszkodzenie oczyszczalni ścieków w celu sabotażu",
        "minuty": 25
    },
    {
        "numer": 318,
        "opis": "Celowe uszkodzenie wału przeciwpowodziowego",
        "minuty": 25
    },
    {
        "numer": 319,
        "opis": "Otwarcie śluzy w celu zalania zabudowań",
        "minuty": 30
    },
    {
        "numer": 320,
        "opis": "Umyślne zniszczenie systemu ostrzegania o zagrożeniu",
        "minuty": 25
    },
    {
        "numer": 321,
        "opis": "Przyjęcie łapówki za bezprawne zwolnienie osadzonego",
        "minuty": 30
    },
    {
        "numer": 322,
        "opis": "Przyjęcie łapówki za pominięcie kontroli pojazdu",
        "minuty": 25
    },
    {
        "numer": 323,
        "opis": "Przyjęcie łapówki za wydanie fałszywego zaświadczenia",
        "minuty": 25
    },
    {
        "numer": 324,
        "opis": "Przyjęcie łapówki za ujawnienie akt sprawy",
        "minuty": 25
    },
    {
        "numer": 325,
        "opis": "Przyjęcie łapówki za zniszczenie dowodu",
        "minuty": 30
    },
    {
        "numer": 326,
        "opis": "Wręczenie łapówki za wydanie pozwolenia",
        "minuty": 25
    },
    {
        "numer": 327,
        "opis": "Wymuszanie łapówki przez funkcjonariusza",
        "minuty": 30
    },
    {
        "numer": 328,
        "opis": "Sprzedaż informacji o planowanej interwencji",
        "minuty": 25
    },
    {
        "numer": 329,
        "opis": "Sprzedaż informacji o miejscu pobytu osoby chronionej",
        "minuty": 25
    },
    {
        "numer": 330,
        "opis": "Celowe skierowanie patrolu w fałszywe miejsce dla pomocy sprawcy",
        "minuty": 30
    },
    {
        "numer": 331,
        "opis": "Fałszowanie raportu z interwencji w celu ukrycia przemocy",
        "minuty": 25
    },
    {
        "numer": 332,
        "opis": "Fałszowanie protokołu przesłuchania",
        "minuty": 25
    },
    {
        "numer": 333,
        "opis": "Celowe usunięcie nagrania z kamery służbowej jako dowodu",
        "minuty": 25
    },
    {
        "numer": 334,
        "opis": "Podmienienie próbki przeznaczonej do badania dowodowego",
        "minuty": 25
    },
    {
        "numer": 335,
        "opis": "Podrzucenie broni w celu fałszywego oskarżenia",
        "minuty": 30
    },
    {
        "numer": 336,
        "opis": "Podrzucenie substancji zabronionej w celu fałszywego oskarżenia",
        "minuty": 30
    },
    {
        "numer": 337,
        "opis": "Wywarcie przemocą nacisku na biegłego",
        "minuty": 25
    },
    {
        "numer": 338,
        "opis": "Grożenie sędziemu w celu zmiany orzeczenia",
        "minuty": 30
    },
    {
        "numer": 339,
        "opis": "Grożenie obrońcy w celu wycofania się ze sprawy",
        "minuty": 25
    },
    {
        "numer": 340,
        "opis": "Przekupienie tłumacza w celu zafałszowania zeznań",
        "minuty": 25
    },
    {
        "numer": 341,
        "opis": "Przemyt telefonu do więzienia w celu organizacji przestępstwa",
        "minuty": 20
    },
    {
        "numer": 342,
        "opis": "Przemyt narzędzi do cięcia krat",
        "minuty": 25
    },
    {
        "numer": 343,
        "opis": "Dostarczenie osadzonemu fałszywych dokumentów do ucieczki",
        "minuty": 25
    },
    {
        "numer": 344,
        "opis": "Podmienienie osadzonego podczas konwoju",
        "minuty": 25
    },
    {
        "numer": 345,
        "opis": "Przejęcie munduru funkcjonariusza w celu ucieczki",
        "minuty": 25
    },
    {
        "numer": 346,
        "opis": "Bezprawne otwarcie celi w celu uwolnienia osadzonego",
        "minuty": 25
    },
    {
        "numer": 347,
        "opis": "Celowe wyłączenie monitoringu w celu umożliwienia ucieczki",
        "minuty": 25
    },
    {
        "numer": 348,
        "opis": "Celowe wyłączenie alarmu obwodowego więzienia",
        "minuty": 25
    },
    {
        "numer": 349,
        "opis": "Wykonanie tunelu służącego ucieczce z więzienia",
        "minuty": 25
    },
    {
        "numer": 350,
        "opis": "Wzięcie funkcjonariusza SW jako zakładnika",
        "minuty": 30
    },
    {
        "numer": 351,
        "opis": "Wzięcie współosadzonego jako zakładnika",
        "minuty": 30
    },
    {
        "numer": 352,
        "opis": "Zmuszenie funkcjonariusza groźbą do otwarcia bramy",
        "minuty": 25
    },
    {
        "numer": 353,
        "opis": "Organizowanie ataku na personel więzienny",
        "minuty": 25
    },
    {
        "numer": 354,
        "opis": "Ukrywanie broni w celi",
        "minuty": 20
    },
    {
        "numer": 355,
        "opis": "Wytworzenie broni na terenie zakładu karnego",
        "minuty": 25
    },
    {
        "numer": 356,
        "opis": "Celowe wywołanie pożaru celi z zagrożeniem dla ludzi",
        "minuty": 25
    },
    {
        "numer": 357,
        "opis": "Zatrucie napoju współosadzonego",
        "minuty": 25
    },
    {
        "numer": 358,
        "opis": "Wymuszenie przekazania depozytu współosadzonego",
        "minuty": 25
    },
    {
        "numer": 359,
        "opis": "Zniszczenie dokumentacji wyroku w celu bezprawnego zwolnienia",
        "minuty": 25
    },
    {
        "numer": 360,
        "opis": "Udzielenie schronienia zbiegłemu osadzonemu ze świadomością ucieczki",
        "minuty": 25
    },
    {
        "numer": 361,
        "opis": "Bezprawne usunięcie organu podczas zabiegu",
        "minuty": 25
    },
    {
        "numer": 362,
        "opis": "Handel organami ludzkimi",
        "minuty": 30
    },
    {
        "numer": 363,
        "opis": "Zmuszanie pacjenta groźbą do podpisania zgody na zabieg",
        "minuty": 25
    },
    {
        "numer": 364,
        "opis": "Fałszowanie wyników badań w celu wyrządzenia szkody",
        "minuty": 25
    },
    {
        "numer": 365,
        "opis": "Celowa zamiana próbek medycznych w celu oszustwa",
        "minuty": 25
    },
    {
        "numer": 366,
        "opis": "Umyślne uszkodzenie butli tlenowej używanej przy pacjencie",
        "minuty": 30
    },
    {
        "numer": 367,
        "opis": "Kradzież defibrylatora z miejsca prowadzenia resuscytacji",
        "minuty": 25
    },
    {
        "numer": 368,
        "opis": "Napaść na ratownika podczas udzielania pomocy",
        "minuty": 25
    },
    {
        "numer": 369,
        "opis": "Zatrzymanie ambulansu przemocą podczas przewozu pacjenta",
        "minuty": 25
    },
    {
        "numer": 370,
        "opis": "Bezprawne ujawnienie lokalizacji pacjenta osobie planującej atak",
        "minuty": 25
    },
    {
        "numer": 371,
        "opis": "Celowe zakażenie innej osoby niebezpiecznym patogenem",
        "minuty": 30
    },
    {
        "numer": 372,
        "opis": "Kradzież próbek niebezpiecznych patogenów z laboratorium",
        "minuty": 25
    },
    {
        "numer": 373,
        "opis": "Uwolnienie niebezpiecznych patogenów z laboratorium",
        "minuty": 30
    },
    {
        "numer": 374,
        "opis": "Sprzedaż skażonego sprzętu medycznego jako sterylnego",
        "minuty": 25
    },
    {
        "numer": 375,
        "opis": "Świadome dopuszczenie niesprawnej aparatury do zabiegu",
        "minuty": 25
    },
    {
        "numer": 376,
        "opis": "Bezprawne uwięzienie pacjenta w placówce",
        "minuty": 25
    },
    {
        "numer": 377,
        "opis": "Wymuszenie pieniędzy groźbą ujawnienia diagnozy",
        "minuty": 25
    },
    {
        "numer": 378,
        "opis": "Przemoc wobec pacjenta pozostającego pod opieką",
        "minuty": 25
    },
    {
        "numer": 379,
        "opis": "Celowe podanie niewłaściwej grupy krwi",
        "minuty": 25
    },
    {
        "numer": 380,
        "opis": "Ukrycie błędu medycznego przez zniszczenie dokumentacji",
        "minuty": 25
    },
    {
        "numer": 381,
        "opis": "Organizowanie porwania dla okupu",
        "minuty": 30
    },
    {
        "numer": 382,
        "opis": "Przetrzymywanie zakładnika w celu wymuszenia decyzji władz",
        "minuty": 30
    },
    {
        "numer": 383,
        "opis": "Dostarczenie pojazdu ze świadomością jego użycia do porwania",
        "minuty": 25
    },
    {
        "numer": 384,
        "opis": "Udostępnienie lokalu ze świadomością przetrzymywania zakładnika",
        "minuty": 25
    },
    {
        "numer": 385,
        "opis": "Zmuszanie osoby do przekazania kodu bankowego przemocą",
        "minuty": 25
    },
    {
        "numer": 386,
        "opis": "Zmuszanie osoby do podpisania umowy groźbą użycia broni",
        "minuty": 25
    },
    {
        "numer": 387,
        "opis": "Wymuszenie przeniesienia własności firmy",
        "minuty": 25
    },
    {
        "numer": 388,
        "opis": "Zajęcie siedziby firmy przemocą",
        "minuty": 25
    },
    {
        "numer": 389,
        "opis": "Zastraszanie pracowników w celu przejęcia przedsiębiorstwa",
        "minuty": 25
    },
    {
        "numer": 390,
        "opis": "Zorganizowanie napadu na kantor",
        "minuty": 25
    },
    {
        "numer": 391,
        "opis": "Zorganizowanie napadu na transport gotówki",
        "minuty": 30
    },
    {
        "numer": 392,
        "opis": "Napad na konwój z osobą chronioną",
        "minuty": 30
    },
    {
        "numer": 393,
        "opis": "Napaść na ochroniarza w celu przejęcia jego broni",
        "minuty": 25
    },
    {
        "numer": 394,
        "opis": "Celowe rozbrojenie funkcjonariusza podczas interwencji",
        "minuty": 25
    },
    {
        "numer": 395,
        "opis": "Użycie pojazdu do staranowania blokady z zagrożeniem ludzi",
        "minuty": 25
    },
    {
        "numer": 396,
        "opis": "Kierowanie pojazdu w tłum z zamiarem wyrządzenia krzywdy",
        "minuty": 30
    },
    {
        "numer": 397,
        "opis": "Zrzucenie ciężkiego przedmiotu z wiaduktu na drogę",
        "minuty": 25
    },
    {
        "numer": 398,
        "opis": "Zastawienie pułapki powodującej zagrożenie dla ludzi",
        "minuty": 25
    },
    {
        "numer": 399,
        "opis": "Zorganizowanie zbrojnego ataku na siedzibę służby",
        "minuty": 30
    },
    {
        "numer": 400,
        "opis": "Finansowanie zbrojnego ataku na obiekt publiczny",
        "minuty": 30
    }
];

function normalizeParagrafQuery(value) {
    return String(value).toLocaleLowerCase("pl").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").trim();
}

function getParagrafSuggestions(value) {
    const query = normalizeParagrafQuery(value);
    const number = /^(?:§\s*)?(\d+)$/.exec(query);
    return PARAGRAFY_RP.filter(p => number
        ? p.numer === Number(number[1])
        : normalizeParagrafQuery("§" + p.numer + " " + p.opis).includes(query)
    ).slice(0, 25).map(p => ({
        name: ("§" + p.numer + " — " + p.opis + " | " + p.minuty + " min (RP)").slice(0, 100),
        value: "§" + p.numer + " — " + p.opis
    }));
}

const commands = [
    new SlashCommandBuilder()
        .setName("osadzony-dodaj")
        .setDescription("Dodaje osadzonego do rejestru")
        .addStringOption(o => o.setName("imie").setDescription("Imię i nazwisko osadzonego").setRequired(true))
        .addStringOption(o => o.setName("paragraf").setDescription("Taryfikator RP: wyszukaj numer lub czyn; kilka paragrafów wpisz ręcznie").setAutocomplete(true).setRequired(true))
        .addStringOption(o => o.setName("wyrok").setDescription("Np. 1 rok, 6 miesięcy, 30 minut").setRequired(true))
        .addStringOption(o => o.setName("poczatek").setDescription("Początek kary HH:MM").setRequired(true))
        .addStringOption(o => o.setName("koniec").setDescription("Koniec kary HH:MM").setRequired(true))
        .addStringOption(o => o.setName("cela").setDescription("Numer celi").setRequired(true)),
    new SlashCommandBuilder()
        .setName("osadzony-info")
        .setDescription("Pokazuje kartę osadzonego")
        .addStringOption(o => o.setName("id").setDescription("Np. O-001").setRequired(true)),
    new SlashCommandBuilder().setName("osadzeni").setDescription("Pokazuje wszystkich osadzonych"),
    new SlashCommandBuilder()
        .setName("osadzony-usun")
        .setDescription("Usuwa osadzonego z rejestru")
        .addStringOption(o => o.setName("id").setDescription("Np. O-001").setRequired(true)),
    new SlashCommandBuilder()
        .setName("osadzony-edytuj")
        .setDescription("Edytuje dane osadzonego")
        .addStringOption(o => o.setName("id").setDescription("Np. O-001").setRequired(true))
        .addStringOption(o => o.setName("cela").setDescription("Nowa cela").setRequired(false))
        .addStringOption(o => o.setName("paragraf").setDescription("Taryfikator RP: wyszukaj numer lub czyn; kilka paragrafów wpisz ręcznie").setAutocomplete(true).setRequired(false))
        .addStringOption(o => o.setName("wyrok").setDescription("Nowy wyrok").setRequired(false))
        .addStringOption(o => o.setName("poczatek").setDescription("Nowy początek HH:MM").setRequired(false))
        .addStringOption(o => o.setName("koniec").setDescription("Nowy koniec HH:MM").setRequired(false))
        .addStringOption(o => o.setName("uwagi").setDescription("Uwagi").setRequired(false)),
    new SlashCommandBuilder()
        .setName("przepustka")
        .setDescription("Składa wniosek o przepustkę")
        .addStringOption(o => o.setName("id").setDescription("ID osadzonego, np. O-001").setRequired(true))
        .addStringOption(o => o.setName("od").setDescription("Od godziny HH:MM").setRequired(true))
        .addStringOption(o => o.setName("do").setDescription("Do godziny HH:MM").setRequired(true))
        .addStringOption(o => o.setName("powod").setDescription("Powód przepustki").setRequired(true))
        .addStringOption(o => o.setName("miejsce").setDescription("Miejsce pobytu").setRequired(true)),
    new SlashCommandBuilder().setName("przepustki").setDescription("Pokazuje oczekujące przepustki")
].map(c => c.toJSON());

client.once("clientReady", async () => {
    console.log(`✅ Zalogowano jako ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log("✅ Komendy zostały zarejestrowane.");
    } catch (error) {
        console.error("❌ Błąd rejestracji komend:", error);
    }

    // Automatyczne odświeżanie kart osadzonych co 15 sekund.
    setInterval(async () => {
        let changed = false;
        for (const osadzony of db.osadzeni) {
            if (ensureTimer(osadzony)) changed = true;
            await refreshOsadzonyMessage(osadzony);
        }
        if (changed) saveDatabase();
    }, TIMER_REFRESH_MS);
});

client.on("interactionCreate", async interaction => {
    // Taryfikator jest publiczny; uprawnienia sprawdzamy przy wykonaniu komendy.
    if (interaction.isAutocomplete?.()) {
        if (!["osadzony-dodaj", "osadzony-edytuj"].includes(interaction.commandName)) return;
        try {
            const focused = interaction.options.getFocused(true);
            await interaction.respond(focused.name === "paragraf"
                ? getParagrafSuggestions(focused.value) : []);
        } catch (error) {
            console.error("Błąd podpowiedzi paragrafów:", error);
        }
        return;
    }
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    // ==================================================
    // DODAJ OSADZONEGO
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzony-dodaj") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień do dodawania osadzonych.", flags: MessageFlags.Ephemeral });

        const imie = interaction.options.getString("imie");
        const paragraf = interaction.options.getString("paragraf");
        const wyrok = interaction.options.getString("wyrok");
        const poczatek = interaction.options.getString("poczatek");
        const koniec = interaction.options.getString("koniec");
        const cela = interaction.options.getString("cela");

        if (!parseTime(poczatek)) return interaction.reply({ content: "❌ Nieprawidłowy początek kary. Użyj `HH:MM`.", flags: MessageFlags.Ephemeral });
        if (!parseTime(koniec)) return interaction.reply({ content: "❌ Nieprawidłowy koniec kary. Użyj `HH:MM`.", flags: MessageFlags.Ephemeral });

        const duration = calculateDurationBetween(poczatek, koniec);
        if (duration === null || duration <= 0) return interaction.reply({ content: "❌ Koniec kary musi być późniejszy od początku albo kara musi przechodzić przez północ.", flags: MessageFlags.Ephemeral });

        const id = createOsadzonyId();
        const osadzony = {
            id, imie, paragraf, wyrok, poczatek, koniec, cela,
            uwagi: "Brak", przepustka: false,
            czasKaryMinuty: duration,
            czasZWyrokuMinuty: calculateSentenceMinutes(wyrok),
            remainingSeconds: duration * 60,
            paused: false,
            timerStartedAt: new Date().toISOString(),
            dodanyPrzez: interaction.user.id,
            utworzono: new Date().toISOString()
        };

        db.osadzeni.push(osadzony);
        saveDatabase();

        await interaction.reply({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)] });
        const message = await interaction.fetchReply();
        osadzony.messageId = message.id;
        osadzony.channelId = message.channelId;
        saveDatabase();

        await sendLog(interaction.guild, new EmbedBuilder()
            .setTitle("📥 NOWY OSADZONY")
            .setDescription(`${interaction.user} dodał **${imie}** do rejestru.`)
            .addFields({ name: "🆔 ID", value: id }, { name: "🕐 Kara", value: `${poczatek} → ${koniec}` })
            .setTimestamp());
        return;
    }

    // ==================================================
    // INFO
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzony-info") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz dostępu do rejestru.", flags: MessageFlags.Ephemeral });
        const osadzony = getOsadzony(interaction.options.getString("id"));
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)], flags: MessageFlags.Ephemeral });
    }

    // ==================================================
    // LISTA
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzeni") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz dostępu do rejestru.", flags: MessageFlags.Ephemeral });
        if (!db.osadzeni.length) return interaction.reply({ content: "📭 Aktualnie brak osadzonych.", flags: MessageFlags.Ephemeral });
        let lista = db.osadzeni.map(o => {
            const seconds = getRemainingSeconds(o, true);
            return `**${o.id}** • ${o.imie}\n⚖️ ${o.paragraf} • 🔒 Cela ${o.cela}\n${o.paused ? "⏸️" : "⏳"} ${Math.ceil(seconds / 60)} min.`;
        }).join("\n\n");
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("📍 REJESTR OSADZONYCH").setDescription(lista).setFooter({ text: `Liczba osadzonych: ${db.osadzeni.length}` }).setTimestamp()] });
    }

    // ==================================================
    // USUŃ
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzony-usun") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", flags: MessageFlags.Ephemeral });
        const index = db.osadzeni.findIndex(o => o.id.toLowerCase() === interaction.options.getString("id").toLowerCase());
        if (index === -1) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", flags: MessageFlags.Ephemeral });
        const removed = db.osadzeni.splice(index, 1)[0];
        saveDatabase();
        await interaction.reply({ content: `✅ Usunięto **${removed.imie} (${removed.id})** z rejestru.` });
        await sendLog(interaction.guild, new EmbedBuilder().setTitle("🗑️ USUNIĘTO OSADZONEGO").setDescription(`${interaction.user} usunął **${removed.imie}** (${removed.id}).`).setTimestamp());
        return;
    }

    // ==================================================
    // EDYTUJ
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzony-edytuj") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", flags: MessageFlags.Ephemeral });
        const osadzony = getOsadzony(interaction.options.getString("id"));
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", flags: MessageFlags.Ephemeral });
        const cela = interaction.options.getString("cela");
        const paragraf = interaction.options.getString("paragraf");
        const wyrok = interaction.options.getString("wyrok");
        const poczatek = interaction.options.getString("poczatek");
        const koniec = interaction.options.getString("koniec");
        const uwagi = interaction.options.getString("uwagi");
        if (cela) osadzony.cela = cela;
        if (paragraf) osadzony.paragraf = paragraf;
        if (wyrok) { osadzony.wyrok = wyrok; osadzony.czasZWyrokuMinuty = calculateSentenceMinutes(wyrok); }
        if (uwagi) osadzony.uwagi = uwagi;
        if (poczatek) { if (!parseTime(poczatek)) return interaction.reply({ content: "❌ Początek musi być `HH:MM`.", flags: MessageFlags.Ephemeral }); osadzony.poczatek = poczatek; }
        if (koniec) { if (!parseTime(koniec)) return interaction.reply({ content: "❌ Koniec musi być `HH:MM`.", flags: MessageFlags.Ephemeral }); osadzony.koniec = koniec; }
        if (poczatek || koniec) {
            const duration = calculateDurationBetween(osadzony.poczatek, osadzony.koniec);
            if (duration === null || duration <= 0) return interaction.reply({ content: "❌ Nieprawidłowy zakres czasu.", flags: MessageFlags.Ephemeral });
            getRemainingSeconds(osadzony, true);
        }
        saveDatabase();
        await interaction.reply({ content: `✅ Zaktualizowano dane osadzonego **${osadzony.imie} (${osadzony.id})**.` });
        await refreshOsadzonyMessage(osadzony);
        return;
    }

    // ==================================================
    // PRZEPUSTKA
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "przepustka") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString("id");
        const od = interaction.options.getString("od");
        const doDate = interaction.options.getString("do");
        const powod = interaction.options.getString("powod");
        const miejsce = interaction.options.getString("miejsce");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: `❌ Nie znaleziono osadzonego **${id}**.`, flags: MessageFlags.Ephemeral });
        if (!parseTime(od) || !parseTime(doDate)) return interaction.reply({ content: "❌ Godziny przepustki muszą być w formacie `HH:MM`.", flags: MessageFlags.Ephemeral });
        const przepustkaId = `P-${String(db.przepustki.length + 1).padStart(3, "0")}`;
        const przepustka = { id: przepustkaId, osadzonyId: osadzony.id, osadzony: osadzony.imie, od, do: doDate, powod, miejsce, status: "oczekuje", zlozyl: interaction.user.id, utworzono: new Date().toISOString() };
        db.przepustki.push(przepustka); saveDatabase();
        const embed = new EmbedBuilder().setTitle("🎫 WNIOSEK O PRZEPUSTKĘ")
            .setDescription(`### 👤 ${osadzony.imie}\n**ID:** ${osadzony.id}`)
            .addFields(
                { name: "🎫 Numer wniosku", value: przepustkaId, inline: true },
                { name: "🕐 Od", value: od, inline: true },
                { name: "🕐 Do", value: doDate, inline: true },
                { name: "📍 Miejsce", value: miejsce, inline: true },
                { name: "📝 Powód", value: powod },
                { name: "🟡 Status", value: "Oczekuje na decyzję" }
            ).setTimestamp();
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`przepustka_zgoda_${przepustkaId}`).setLabel("Zatwierdź").setEmoji("✅").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`przepustka_odmowa_${przepustkaId}`).setLabel("Odrzuć").setEmoji("❌").setStyle(ButtonStyle.Danger)
        );
        const channel = interaction.guild.channels.cache.find(ch => ch.name === CHANNEL_PRZEPUSTKI && ch.isTextBased());
        if (channel) await channel.send({ embeds: [embed], components: [buttons] });
        await interaction.reply({ content: `✅ Wniosek **${przepustkaId}** został złożony.`, flags: MessageFlags.Ephemeral });
        await sendLog(interaction.guild, new EmbedBuilder().setTitle("🎫 NOWY WNIOSEK O PRZEPUSTKĘ").setDescription(`${interaction.user} złożył wniosek dla **${osadzony.imie} (${osadzony.id})**.`).addFields({ name: "ID wniosku", value: przepustkaId }).setTimestamp());
        return;
    }

    // ==================================================
    // PRZEPUSTKI
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "przepustki") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", flags: MessageFlags.Ephemeral });
        const oczekujace = db.przepustki.filter(p => p.status === "oczekuje");
        if (!oczekujace.length) return interaction.reply({ content: "📭 Brak oczekujących wniosków o przepustkę.", flags: MessageFlags.Ephemeral });
        const lista = oczekujace.map(p => `**${p.id}** • ${p.osadzony} (${p.osadzonyId})\n🕐 ${p.od} → ${p.do}\n📍 ${p.miejsce}\n📝 ${p.powod}`).join("\n\n");
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🎫 OCZEKUJĄCE PRZEPUSTKI").setDescription(lista).setTimestamp()], flags: MessageFlags.Ephemeral });
    }

    // ==================================================
    // STEROWANIE KARĄ: PAUZA / KONTYNUUJ / ZMIANA CZASU
    // ==================================================
    if (interaction.isButton() && interaction.customId.startsWith("kara_")) {
        if (!hasTimerPermission(interaction)) {
            return interaction.reply({ content: `❌ Tę funkcję może obsługiwać wyłącznie rola **${TIMER_ROLE_NAME}**.`, flags: MessageFlags.Ephemeral });
        }
        const [, action, id] = interaction.customId.split("_");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", flags: MessageFlags.Ephemeral });
        const seconds = getRemainingSeconds(osadzony, true);

        if (action === "pause") {
            if (osadzony.paused || seconds <= 0) return interaction.reply({ content: "❌ Kara jest już wstrzymana albo zakończona.", flags: MessageFlags.Ephemeral });
            osadzony.paused = true;
            osadzony.timerStartedAt = null;
            saveDatabase();
            await interaction.update({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)] });
            await sendLog(interaction.guild, new EmbedBuilder().setTitle("⏸️ WSTRZYMANO KARĘ").setDescription(`${interaction.user} wstrzymał karę **${osadzony.imie} (${osadzony.id})**.`).setTimestamp());
            return;
        }

        if (action === "resume") {
            if (!osadzony.paused || seconds <= 0) return interaction.reply({ content: "❌ Kara jest już aktywna albo zakończona.", flags: MessageFlags.Ephemeral });
            osadzony.paused = false;
            osadzony.timerStartedAt = new Date().toISOString();
            saveDatabase();
            await interaction.update({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)] });
            await sendLog(interaction.guild, new EmbedBuilder().setTitle("▶️ WZNOWIONO KARĘ").setDescription(`${interaction.user} wznowił karę **${osadzony.imie} (${osadzony.id})**.`).setTimestamp());
            return;
        }

        if (action === "add" || action === "remove") {
            const modal = new ModalBuilder()
                .setCustomId(`kara_modal_${action}_${osadzony.id}`)
                .setTitle(action === "add" ? "➕ Dodaj czas kary" : "➖ Odejmij czas kary");
            const input = new TextInputBuilder()
                .setCustomId("minutes")
                .setLabel("Liczba minut")
                .setPlaceholder("np. 30")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(5);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }
    }

    // ==================================================
    // MODAL ZMIANY CZASU
    // ==================================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("kara_modal_")) {
        if (!hasTimerPermission(interaction)) return interaction.reply({ content: `❌ Tę funkcję może obsługiwać wyłącznie rola **${TIMER_ROLE_NAME}**.`, flags: MessageFlags.Ephemeral });
        const [, , action, id] = interaction.customId.split("_");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", flags: MessageFlags.Ephemeral });
        const amount = Number.parseInt(interaction.fields.getTextInputValue("minutes"), 10);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return interaction.reply({ content: "❌ Podaj liczbę minut od 1 do 100000.", flags: MessageFlags.Ephemeral });

        let seconds = getRemainingSeconds(osadzony, true);
        const delta = amount * 60;
        seconds = action === "add" ? seconds + delta : Math.max(0, seconds - delta);
        osadzony.remainingSeconds = seconds;
        if (seconds <= 0) {
            osadzony.paused = true;
            osadzony.timerStartedAt = null;
        } else if (!osadzony.paused) {
            osadzony.timerStartedAt = new Date().toISOString();
        }
        osadzony.czasKaryMinuty = Math.ceil(seconds / 60);
        saveDatabase();

        const actionText = action === "add" ? `dodano **${amount} min.**` : `odjęto **${amount} min.**`;
        await interaction.reply({ content: `✅ ${actionText} dla **${osadzony.imie} (${osadzony.id})**.`, flags: MessageFlags.Ephemeral });
        await refreshOsadzonyMessage(osadzony);
        await sendLog(interaction.guild, new EmbedBuilder().setTitle(action === "add" ? "➕ ZMIENIONO CZAS KARY" : "➖ ZMIENIONO CZAS KARY").setDescription(`${interaction.user} ${actionText} dla **${osadzony.imie} (${osadzony.id})**.`).setTimestamp());
        return;
    }

    // ==================================================
    // PRZYCISKI PRZEPUSTEK
    // ==================================================
    if (interaction.isButton() && interaction.customId.startsWith("przepustka_")) {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Tylko uprawnione osoby mogą rozpatrywać przepustki.", flags: MessageFlags.Ephemeral });
        const [, action, id] = interaction.customId.split("_");
        const przepustka = db.przepustki.find(p => p.id === id);
        if (!przepustka) return interaction.reply({ content: "❌ Nie znaleziono tego wniosku.", flags: MessageFlags.Ephemeral });
        if (przepustka.status !== "oczekuje") return interaction.reply({ content: "❌ Ten wniosek został już rozpatrzony.", flags: MessageFlags.Ephemeral });
        const osadzony = getOsadzony(przepustka.osadzonyId);

        if (action === "zgoda") {
            przepustka.status = "zatwierdzona";
            przepustka.rozpatrzyl = interaction.user.id;
            if (osadzony) osadzony.przepustka = true;
            saveDatabase();
            const embed = new EmbedBuilder().setTitle("✅ PRZEPUSTKA ZATWIERDZONA").setDescription(`Wniosek **${przepustka.id}** został zatwierdzony.`).addFields(
                { name: "👤 Osadzony", value: `${przepustka.osadzony} (${przepustka.osadzonyId})` },
                { name: "🕐 Termin", value: `${przepustka.od} → ${przepustka.do}` },
                { name: "👮 Zatwierdził", value: `${interaction.user}` }
            ).setTimestamp();
            await interaction.update({ embeds: [embed], components: [] });
            await sendLog(interaction.guild, embed);
            return;
        }

        if (action === "odmowa") {
            przepustka.status = "odrzucona";
            przepustka.rozpatrzyl = interaction.user.id;
            saveDatabase();
            const embed = new EmbedBuilder().setTitle("❌ PRZEPUSTKA ODRZUCONA").setDescription(`Wniosek **${przepustka.id}** został odrzucony.`).addFields(
                { name: "👤 Osadzony", value: `${przepustka.osadzony} (${przepustka.osadzonyId})` },
                { name: "👮 Odrzucił", value: `${interaction.user}` }
            ).setTimestamp();
            await interaction.update({ embeds: [embed], components: [] });
            await sendLog(interaction.guild, embed);
            return;
        }
    }
});

client.login(TOKEN);

