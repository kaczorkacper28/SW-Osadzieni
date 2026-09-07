const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
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
    "zca. Dowódca zmiany"
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

function hasStaffRole(member) {
    if (!member?.roles) return false;
    return STAFF_ROLE_NAMES.some(name => member.roles.cache.some(role => role.name === name));
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

const commands = [
    new SlashCommandBuilder()
        .setName("osadzony-dodaj")
        .setDescription("Dodaje osadzonego do rejestru")
        .addStringOption(o => o.setName("imie").setDescription("Imię i nazwisko osadzonego").setRequired(true))
        .addStringOption(o => o.setName("paragraf").setDescription("Paragraf / paragrafy").setRequired(true))
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
        .addStringOption(o => o.setName("paragraf").setDescription("Nowy paragraf").setRequired(false))
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

client.once("ready", async () => {
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
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    // ==================================================
    // DODAJ OSADZONEGO
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzony-dodaj") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień do dodawania osadzonych.", ephemeral: true });

        const imie = interaction.options.getString("imie");
        const paragraf = interaction.options.getString("paragraf");
        const wyrok = interaction.options.getString("wyrok");
        const poczatek = interaction.options.getString("poczatek");
        const koniec = interaction.options.getString("koniec");
        const cela = interaction.options.getString("cela");

        if (!parseTime(poczatek)) return interaction.reply({ content: "❌ Nieprawidłowy początek kary. Użyj `HH:MM`.", ephemeral: true });
        if (!parseTime(koniec)) return interaction.reply({ content: "❌ Nieprawidłowy koniec kary. Użyj `HH:MM`.", ephemeral: true });

        const duration = calculateDurationBetween(poczatek, koniec);
        if (duration === null || duration <= 0) return interaction.reply({ content: "❌ Koniec kary musi być późniejszy od początku albo kara musi przechodzić przez północ.", ephemeral: true });

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
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz dostępu do rejestru.", ephemeral: true });
        const osadzony = getOsadzony(interaction.options.getString("id"));
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", ephemeral: true });
        return interaction.reply({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)], ephemeral: true });
    }

    // ==================================================
    // LISTA
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "osadzeni") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz dostępu do rejestru.", ephemeral: true });
        if (!db.osadzeni.length) return interaction.reply({ content: "📭 Aktualnie brak osadzonych.", ephemeral: true });
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
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", ephemeral: true });
        const index = db.osadzeni.findIndex(o => o.id.toLowerCase() === interaction.options.getString("id").toLowerCase());
        if (index === -1) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", ephemeral: true });
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
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", ephemeral: true });
        const osadzony = getOsadzony(interaction.options.getString("id"));
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", ephemeral: true });
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
        if (poczatek) { if (!parseTime(poczatek)) return interaction.reply({ content: "❌ Początek musi być `HH:MM`.", ephemeral: true }); osadzony.poczatek = poczatek; }
        if (koniec) { if (!parseTime(koniec)) return interaction.reply({ content: "❌ Koniec musi być `HH:MM`.", ephemeral: true }); osadzony.koniec = koniec; }
        if (poczatek || koniec) {
            const duration = calculateDurationBetween(osadzony.poczatek, osadzony.koniec);
            if (duration === null || duration <= 0) return interaction.reply({ content: "❌ Nieprawidłowy zakres czasu.", ephemeral: true });
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
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", ephemeral: true });
        const id = interaction.options.getString("id");
        const od = interaction.options.getString("od");
        const doDate = interaction.options.getString("do");
        const powod = interaction.options.getString("powod");
        const miejsce = interaction.options.getString("miejsce");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: `❌ Nie znaleziono osadzonego **${id}**.`, ephemeral: true });
        if (!parseTime(od) || !parseTime(doDate)) return interaction.reply({ content: "❌ Godziny przepustki muszą być w formacie `HH:MM`.", ephemeral: true });
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
        await interaction.reply({ content: `✅ Wniosek **${przepustkaId}** został złożony.`, ephemeral: true });
        await sendLog(interaction.guild, new EmbedBuilder().setTitle("🎫 NOWY WNIOSEK O PRZEPUSTKĘ").setDescription(`${interaction.user} złożył wniosek dla **${osadzony.imie} (${osadzony.id})**.`).addFields({ name: "ID wniosku", value: przepustkaId }).setTimestamp());
        return;
    }

    // ==================================================
    // PRZEPUSTKI
    // ==================================================
    if (interaction.isChatInputCommand() && interaction.commandName === "przepustki") {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Nie masz uprawnień.", ephemeral: true });
        const oczekujace = db.przepustki.filter(p => p.status === "oczekuje");
        if (!oczekujace.length) return interaction.reply({ content: "📭 Brak oczekujących wniosków o przepustkę.", ephemeral: true });
        const lista = oczekujace.map(p => `**${p.id}** • ${p.osadzony} (${p.osadzonyId})\n🕐 ${p.od} → ${p.do}\n📍 ${p.miejsce}\n📝 ${p.powod}`).join("\n\n");
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🎫 OCZEKUJĄCE PRZEPUSTKI").setDescription(lista).setTimestamp()], ephemeral: true });
    }

    // ==================================================
    // STEROWANIE KARĄ: PAUZA / KONTYNUUJ / ZMIANA CZASU
    // ==================================================
    if (interaction.isButton() && interaction.customId.startsWith("kara_")) {
        if (!hasTimerPermission(interaction)) {
            return interaction.reply({ content: `❌ Tę funkcję może obsługiwać wyłącznie rola **${TIMER_ROLE_NAME}**.`, ephemeral: true });
        }
        const [, action, id] = interaction.customId.split("_");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", ephemeral: true });
        const seconds = getRemainingSeconds(osadzony, true);

        if (action === "pause") {
            if (osadzony.paused || seconds <= 0) return interaction.reply({ content: "❌ Kara jest już wstrzymana albo zakończona.", ephemeral: true });
            osadzony.paused = true;
            osadzony.timerStartedAt = null;
            saveDatabase();
            await interaction.update({ embeds: [buildOsadzonyEmbed(osadzony)], components: [buildTimerButtons(osadzony)] });
            await sendLog(interaction.guild, new EmbedBuilder().setTitle("⏸️ WSTRZYMANO KARĘ").setDescription(`${interaction.user} wstrzymał karę **${osadzony.imie} (${osadzony.id})**.`).setTimestamp());
            return;
        }

        if (action === "resume") {
            if (!osadzony.paused || seconds <= 0) return interaction.reply({ content: "❌ Kara jest już aktywna albo zakończona.", ephemeral: true });
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
        if (!hasTimerPermission(interaction)) return interaction.reply({ content: `❌ Tę funkcję może obsługiwać wyłącznie rola **${TIMER_ROLE_NAME}**.`, ephemeral: true });
        const [, , action, id] = interaction.customId.split("_");
        const osadzony = getOsadzony(id);
        if (!osadzony) return interaction.reply({ content: "❌ Nie znaleziono osadzonego.", ephemeral: true });
        const amount = Number.parseInt(interaction.fields.getTextInputValue("minutes"), 10);
        if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return interaction.reply({ content: "❌ Podaj liczbę minut od 1 do 100000.", ephemeral: true });

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
        await interaction.reply({ content: `✅ ${actionText} dla **${osadzony.imie} (${osadzony.id})**.`, ephemeral: true });
        await refreshOsadzonyMessage(osadzony);
        await sendLog(interaction.guild, new EmbedBuilder().setTitle(action === "add" ? "➕ ZMIENIONO CZAS KARY" : "➖ ZMIENIONO CZAS KARY").setDescription(`${interaction.user} ${actionText} dla **${osadzony.imie} (${osadzony.id})**.`).setTimestamp());
        return;
    }

    // ==================================================
    // PRZYCISKI PRZEPUSTEK
    // ==================================================
    if (interaction.isButton() && interaction.customId.startsWith("przepustka_")) {
        if (!hasPermission(interaction)) return interaction.reply({ content: "❌ Tylko uprawnione osoby mogą rozpatrywać przepustki.", ephemeral: true });
        const [, action, id] = interaction.customId.split("_");
        const przepustka = db.przepustki.find(p => p.id === id);
        if (!przepustka) return interaction.reply({ content: "❌ Nie znaleziono tego wniosku.", ephemeral: true });
        if (przepustka.status !== "oczekuje") return interaction.reply({ content: "❌ Ten wniosek został już rozpatrzony.", ephemeral: true });
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
