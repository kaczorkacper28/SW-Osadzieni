const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

require("dotenv").config();

const fs = require("fs");
const path = require("path");

// ======================================================
// KONFIGURACJA
// ======================================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.log("❌ Brakuje TOKEN, CLIENT_ID lub GUILD_ID.");
    process.exit(1);
}

// ======================================================
// ROLE, KTÓRE MAJĄ DOSTĘP DO SYSTEMU
// ======================================================

const STAFF_ROLE_NAMES = [
    "Generał Inspektor SW ⚖️👑",
    "Generał SW ⚖️⭐",
    "Dowódca zmiany",
    "zca. Dowódca zmiany"
];

// ======================================================
// KANAŁY
// ======================================================

const CHANNEL_OSADZENI = "📍・osadzeni";
const CHANNEL_PRZEPUSTKI = "🎫・przepustki";
const CHANNEL_LOGI = "📜・logi-osadzeni";

// ======================================================
// CZAS RP
// ======================================================
//
// 1 miesiąc = 10 minut
// 1 rok = 60 minut
//
// Przykłady:
// 1 miesiąc = 10 min
// 2 miesiące = 20 min
// 6 miesięcy = 60 min
// 1 rok = 60 min
// 2 lata = 120 min
//
// ======================================================

const MINUTES_PER_MONTH = 10;
const MINUTES_PER_YEAR = 60;

// ======================================================
// BAZA DANYCH
// ======================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "osadzeni.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({
            nextId: 1,
            osadzeni: [],
            przepustki: []
        }, null, 2)
    );
}

function loadDatabase() {
    try {
        const data = JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );

        if (!data.osadzeni) data.osadzeni = [];
        if (!data.przepustki) data.przepustki = [];
        if (!data.nextId) data.nextId = 1;

        return data;

    } catch {
        return {
            nextId: 1,
            osadzeni: [],
            przepustki: []
        };
    }
}

function saveDatabase() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(db, null, 2)
    );
}

const db = loadDatabase();

// ======================================================
// BOT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ======================================================
// UPRAWNIENIA
// ======================================================

function hasStaffRole(member) {
    if (!member || !member.roles) return false;

    return STAFF_ROLE_NAMES.some(name =>
        member.roles.cache.some(
            role => role.name === name
        )
    );
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );
}

function hasPermission(interaction) {
    return (
        hasStaffRole(interaction.member) ||
        isAdmin(interaction)
    );
}

// ======================================================
// ID OSADZONEGO
// ======================================================

function createOsadzonyId() {

    const number = db.nextId++;

    saveDatabase();

    return `O-${String(number).padStart(3, "0")}`;
}

// ======================================================
// WALIDACJA GODZINY
// ======================================================

function parseTime(timeString) {

    if (!timeString) return null;

    const match =
        /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
            timeString.trim()
        );

    if (!match) return null;

    return {
        hours: Number(match[1]),
        minutes: Number(match[2])
    };
}

// ======================================================
// GODZINA → MINUTY
// ======================================================

function timeToMinutes(timeString) {

    const time = parseTime(timeString);

    if (!time) return null;

    return (
        time.hours * 60 +
        time.minutes
    );
}

// ======================================================
// MINUTY → GODZINA
// ======================================================

function minutesToTime(totalMinutes) {

    totalMinutes =
        ((totalMinutes % 1440) + 1440) % 1440;

    const hours =
        Math.floor(totalMinutes / 60);

    const minutes =
        totalMinutes % 60;

    return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0")
    );
}

// ======================================================
// OBLICZANIE DŁUGOŚCI KARY
// ======================================================
//
// Rozpoznaje m.in.:
//
// 1 rok
// 2 lata
// 1 miesiąc
// 5 miesięcy
// 1 rok 2 miesiące
// 30 minut
//
// ======================================================

function calculateSentenceMinutes(sentence) {

    if (!sentence) return 0;

    const text =
        sentence
            .toLowerCase()
            .replace(/,/g, ".")
            .trim();

    let total = 0;

    // LATA
    const yearsMatch =
        text.match(
            /(\d+(?:\.\d+)?)\s*(rok|lata|lat)/
        );

    if (yearsMatch) {

        const years =
            Number(yearsMatch[1]);

        total +=
            years * MINUTES_PER_YEAR;
    }

    // MIESIĄCE
    const monthsMatch =
        text.match(
            /(\d+(?:\.\d+)?)\s*(miesiąc|miesiące|miesięcy)/
        );

    if (monthsMatch) {

        const months =
            Number(monthsMatch[1]);

        total +=
            months * MINUTES_PER_MONTH;
    }

    // MINUTY
    const minutesMatch =
        text.match(
            /(\d+(?:\.\d+)?)\s*(min|mina|minut|minuta|minuty)/
        );

    if (minutesMatch) {

        const minutes =
            Number(minutesMatch[1]);

        total += minutes;
    }

    return Math.round(total);
}

// ======================================================
// OBLICZANIE CZASU POMIĘDZY GODZINAMI
// ======================================================
//
// Przykłady:
//
// 14:00 → 15:00 = 60 min
// 14:00 → 14:10 = 10 min
// 23:50 → 00:50 = 60 min
//
// ======================================================

function calculateDurationBetween(startTime, endTime) {

    const start =
        timeToMinutes(startTime);

    const end =
        timeToMinutes(endTime);

    if (start === null || end === null) {
        return null;
    }

    let difference = end - start;

    if (difference < 0) {
        difference += 1440;
    }

    return difference;
}

// ======================================================
// OBLICZANIE POZOSTAŁEGO CZASU
// ======================================================

function calculateMinutesLeft(startTime, endTime) {

    const start =
        timeToMinutes(startTime);

    const end =
        timeToMinutes(endTime);

    if (start === null || end === null) {
        return 0;
    }

    const nowDate = new Date();

    const now =
        nowDate.getHours() * 60 +
        nowDate.getMinutes();

    let endAbsolute = end;

    /*
     * Jeżeli kara przechodzi przez północ,
     * np. 23:50 → 00:50,
     * traktujemy koniec jako następny dzień.
     */

    if (end < start) {
        endAbsolute += 1440;
    }

    let current = now;

    /*
     * Jeżeli kara zaczęła się poprzedniego dnia
     * i przechodzi przez północ.
     */

    if (
        end < start &&
        now < start
    ) {
        current += 1440;
    }

    let difference =
        endAbsolute - current;

    if (difference < 0) {
        return 0;
    }

    return difference;
}

// ======================================================
// FORMAT CZASU
// ======================================================

function formatRemainingMinutes(minutes) {

    if (minutes <= 0) {
        return "✅ KARA ZAKOŃCZONA";
    }

    const hours =
        Math.floor(minutes / 60);

    const mins =
        minutes % 60;

    if (hours > 0) {

        return (
            `⏳ Pozostało **${hours} godz. ${mins} min.**`
        );
    }

    return (
        `⏳ Pozostało **${mins} min.**`
    );
}

// ======================================================
// OSADZONY
// ======================================================

function getOsadzony(id) {

    return db.osadzeni.find(
        osadzony =>
            osadzony.id.toLowerCase() ===
            id.toLowerCase()
    );
}

// ======================================================
// LOGI
// ======================================================

async function sendLog(guild, embed) {

    const channel =
        guild.channels.cache.find(
            ch =>
                ch.name === CHANNEL_LOGI &&
                ch.isTextBased()
        );

    if (channel) {

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    }
}

// ======================================================
// KOMENDY
// ======================================================

const commands = [

    // ==================================================
    // DODAJ OSADZONEGO
    // ==================================================

    new SlashCommandBuilder()
        .setName("osadzony-dodaj")
        .setDescription("Dodaje osadzonego do rejestru")

        .addStringOption(option =>
            option
                .setName("imie")
                .setDescription("Imię i nazwisko osadzonego")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("paragraf")
                .setDescription("Paragraf / paragrafy")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("wyrok")
                .setDescription("Np. 1 rok, 6 miesięcy, 30 minut")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("poczatek")
                .setDescription("Początek kary HH:MM")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("koniec")
                .setDescription("Koniec kary HH:MM")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("cela")
                .setDescription("Numer celi")
                .setRequired(true)
        ),

    // ==================================================
    // INFO
    // ==================================================

    new SlashCommandBuilder()
        .setName("osadzony-info")
        .setDescription("Pokazuje kartę osadzonego")

        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Np. O-001")
                .setRequired(true)
        ),

    // ==================================================
    // LISTA
    // ==================================================

    new SlashCommandBuilder()
        .setName("osadzeni")
        .setDescription("Pokazuje wszystkich osadzonych"),

    // ==================================================
    // USUŃ
    // ==================================================

    new SlashCommandBuilder()
        .setName("osadzony-usun")
        .setDescription("Usuwa osadzonego z rejestru")

        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Np. O-001")
                .setRequired(true)
        ),

    // ==================================================
    // EDYTUJ
    // ==================================================

    new SlashCommandBuilder()
        .setName("osadzony-edytuj")
        .setDescription("Edytuje dane osadzonego")

        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Np. O-001")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("cela")
                .setDescription("Nowa cela")
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName("paragraf")
                .setDescription("Nowy paragraf")
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName("wyrok")
                .setDescription("Nowy wyrok")
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName("poczatek")
                .setDescription("Nowy początek HH:MM")
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName("koniec")
                .setDescription("Nowy koniec HH:MM")
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName("uwagi")
                .setDescription("Uwagi")
                .setRequired(false)
        ),

    // ==================================================
    // PRZEPUSTKA
    // ==================================================

    new SlashCommandBuilder()
        .setName("przepustka")
        .setDescription("Składa wniosek o przepustkę")

        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("ID osadzonego, np. O-001")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("od")
                .setDescription("Od godziny HH:MM")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("do")
                .setDescription("Do godziny HH:MM")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("powod")
                .setDescription("Powód przepustki")
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName("miejsce")
                .setDescription("Miejsce pobytu")
                .setRequired(true)
        ),

    // ==================================================
    // PRZEPUSTKI
    // ==================================================

    new SlashCommandBuilder()
        .setName("przepustki")
        .setDescription("Pokazuje oczekujące przepustki")

].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {

    console.log(
        `✅ Zalogowano jako ${client.user.tag}`
    );

    const rest =
        new REST({
            version: "10"
        }).setToken(TOKEN);

    try {

        await rest.put(
            Routes.applicationGuildCommands(
                CLIENT_ID,
                GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "✅ Komendy zostały zarejestrowane."
        );

    } catch (error) {

        console.error(
            "❌ Błąd rejestracji komend:",
            error
        );
    }
});

// ======================================================
// INTERAKCJE
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        if (
            !interaction.isChatInputCommand() &&
            !interaction.isButton()
        ) {
            return;
        }

        // ==================================================
        // /osadzony-dodaj
        // ==================================================

        if (
            interaction.commandName ===
            "osadzony-dodaj"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz uprawnień do dodawania osadzonych.",
                    ephemeral: true
                });
            }

            const imie =
                interaction.options.getString("imie");

            const paragraf =
                interaction.options.getString("paragraf");

            const wyrok =
                interaction.options.getString("wyrok");

            const poczatek =
                interaction.options.getString("poczatek");

            const koniec =
                interaction.options.getString("koniec");

            const cela =
                interaction.options.getString("cela");

            // ----------------------------------------------
            // SPRAWDZANIE GODZIN
            // ----------------------------------------------

            if (!parseTime(poczatek)) {

                return interaction.reply({
                    content:
                        "❌ Nieprawidłowy początek kary. Użyj formatu `HH:MM`, np. `14:30`.",
                    ephemeral: true
                });
            }

            if (!parseTime(koniec)) {

                return interaction.reply({
                    content:
                        "❌ Nieprawidłowy koniec kary. Użyj formatu `HH:MM`, np. `15:30`.",
                    ephemeral: true
                });
            }

            const id =
                createOsadzonyId();

            const duration =
                calculateDurationBetween(
                    poczatek,
                    koniec
                );

            const sentenceMinutes =
                calculateSentenceMinutes(
                    wyrok
                );

            const osadzony = {

                id,

                imie,

                paragraf,

                wyrok,

                poczatek,

                koniec,

                cela,

                uwagi: "Brak",

                przepustka: false,

                czasKaryMinuty:
                    duration,

                czasZWyrokuMinuty:
                    sentenceMinutes,

                dodanyPrzez:
                    interaction.user.id,

                utworzono:
                    new Date().toISOString()
            };

            db.osadzeni.push(
                osadzony
            );

            saveDatabase();

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        "🔒 DODANO OSADZONEGO"
                    )

                    .setDescription(
                        `**${imie}** został dodany do rejestru.`
                    )

                    .addFields(

                        {
                            name: "🆔 ID",
                            value: id,
                            inline: true
                        },

                        {
                            name: "⚖️ Paragraf",
                            value: paragraf,
                            inline: true
                        },

                        {
                            name: "📋 Wyrok",
                            value: wyrok,
                            inline: true
                        },

                        {
                            name: "🔒 Cela",
                            value: cela,
                            inline: true
                        },

                        {
                            name: "🕐 Początek kary",
                            value: poczatek,
                            inline: true
                        },

                        {
                            name: "🕐 Koniec kary",
                            value: koniec,
                            inline: true
                        },

                        {
                            name: "⏱️ Długość",
                            value:
                                `${duration} minut`,
                            inline: true
                        }
                    )

                    .setFooter({
                        text:
                            "Służba Więzienna • Rejestr Osadzonych"
                    })

                    .setTimestamp();

            await interaction.reply({
                embeds: [embed]
            });

            await sendLog(
                interaction.guild,

                new EmbedBuilder()

                    .setTitle(
                        "📥 NOWY OSADZONY"
                    )

                    .setDescription(
                        `${interaction.user} dodał **${imie}** do rejestru.`
                    )

                    .addFields(
                        {
                            name: "🆔 ID",
                            value: id
                        },
                        {
                            name: "🕐 Kara",
                            value:
                                `${poczatek} → ${koniec}`
                        }
                    )

                    .setTimestamp()
            );

            return;
        }

        // ==================================================
        // /osadzony-info
        // ==================================================

        if (
            interaction.commandName ===
            "osadzony-info"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz dostępu do rejestru.",
                    ephemeral: true
                });
            }

            const id =
                interaction.options.getString("id");

            const osadzony =
                getOsadzony(id);

            if (!osadzony) {

                return interaction.reply({
                    content:
                        `❌ Nie znaleziono osadzonego **${id}**.`,
                    ephemeral: true
                });
            }

            const minutes =
                calculateMinutesLeft(
                    osadzony.poczatek,
                    osadzony.koniec
                );

            const status =
                formatRemainingMinutes(
                    minutes
                );

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        `🔒 KARTA OSADZONEGO — ${osadzony.id}`
                    )

                    .setDescription(
                        `## 👤 ${osadzony.imie}\n\n${status}`
                    )

                    .addFields(

                        {
                            name: "⚖️ Paragraf",
                            value:
                                osadzony.paragraf,
                            inline: true
                        },

                        {
                            name: "📋 Wyrok",
                            value:
                                osadzony.wyrok,
                            inline: true
                        },

                        {
                            name: "🔒 Cela",
                            value:
                                osadzony.cela,
                            inline: true
                        },

                        {
                            name: "🕐 Początek kary",
                            value:
                                osadzony.poczatek,
                            inline: true
                        },

                        {
                            name: "🕐 Koniec kary",
                            value:
                                osadzony.koniec,
                            inline: true
                        },

                        {
                            name: "⏳ Pozostało",
                            value:
                                `${minutes} minut`,
                            inline: true
                        },

                        {
                            name: "🎫 Przepustka",
                            value:
                                osadzony.przepustka
                                    ? "✅ Udzielona"
                                    : "❌ Brak",
                            inline: true
                        },

                        {
                            name: "📝 Uwagi",
                            value:
                                osadzony.uwagi ||
                                "Brak"
                        }
                    )

                    .setFooter({
                        text:
                            "Służba Więzienna • Rejestr Osadzonych"
                    })

                    .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

        // ==================================================
        // /osadzeni
        // ==================================================

        if (
            interaction.commandName ===
            "osadzeni"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz dostępu do rejestru.",
                    ephemeral: true
                });
            }

            if (
                db.osadzeni.length === 0
            ) {

                return interaction.reply({
                    content:
                        "📭 Aktualnie brak osadzonych.",
                    ephemeral: true
                });
            }

            const lista =
                db.osadzeni
                    .map(osadzony => {

                        const minutes =
                            calculateMinutesLeft(
                                osadzony.poczatek,
                                osadzony.koniec
                            );

                        return (
                            `**${osadzony.id}** • ${osadzony.imie}\n` +
                            `⚖️ ${osadzony.paragraf} • ` +
                            `🔒 Cela ${osadzony.cela} • ` +
                            `🕐 ${osadzony.poczatek} → ${osadzony.koniec}\n` +
                            `⏳ ${minutes} min.`
                        );

                    })
                    .join("\n\n");

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        "📍 REJESTR OSADZONYCH"
                    )

                    .setDescription(
                        lista
                    )

                    .setFooter({
                        text:
                            `Liczba osadzonych: ${db.osadzeni.length}`
                    })

                    .setTimestamp();

            return interaction.reply({
                embeds: [embed]
            });
        }

        // ==================================================
        // /osadzony-usun
        // ==================================================

        if (
            interaction.commandName ===
            "osadzony-usun"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz uprawnień.",
                    ephemeral: true
                });
            }

            const id =
                interaction.options.getString("id");

            const index =
                db.osadzeni.findIndex(
                    osadzony =>
                        osadzony.id.toLowerCase() ===
                        id.toLowerCase()
                );

            if (index === -1) {

                return interaction.reply({
                    content:
                        "❌ Nie znaleziono osadzonego.",
                    ephemeral: true
                });
            }

            const removed =
                db.osadzeni.splice(
                    index,
                    1
                )[0];

            saveDatabase();

            await interaction.reply({
                content:
                    `✅ Usunięto **${removed.imie} (${removed.id})** z rejestru.`
            });

            await sendLog(
                interaction.guild,

                new EmbedBuilder()

                    .setTitle(
                        "🗑️ USUNIĘTO OSADZONEGO"
                    )

                    .setDescription(
                        `${interaction.user} usunął **${removed.imie}** (${removed.id}).`
                    )

                    .setTimestamp()
            );

            return;
        }

        // ==================================================
        // /osadzony-edytuj
        // ==================================================

        if (
            interaction.commandName ===
            "osadzony-edytuj"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz uprawnień.",
                    ephemeral: true
                });
            }

            const id =
                interaction.options.getString("id");

            const osadzony =
                getOsadzony(id);

            if (!osadzony) {

                return interaction.reply({
                    content:
                        "❌ Nie znaleziono osadzonego.",
                    ephemeral: true
                });
            }

            const cela =
                interaction.options.getString("cela");

            const paragraf =
                interaction.options.getString("paragraf");

            const wyrok =
                interaction.options.getString("wyrok");

            const poczatek =
                interaction.options.getString("poczatek");

            const koniec =
                interaction.options.getString("koniec");

            const uwagi =
                interaction.options.getString("uwagi");

            if (cela)
                osadzony.cela = cela;

            if (paragraf)
                osadzony.paragraf = paragraf;

            if (wyrok) {

                osadzony.wyrok =
                    wyrok;

                osadzony.czasZWyrokuMinuty =
                    calculateSentenceMinutes(
                        wyrok
                    );
            }

            if (uwagi)
                osadzony.uwagi = uwagi;

            if (poczatek) {

                if (!parseTime(poczatek)) {

                    return interaction.reply({
                        content:
                            "❌ Początek musi być w formacie `HH:MM`, np. `14:30`.",
                        ephemeral: true
                    });
                }

                osadzony.poczatek =
                    poczatek;
            }

            if (koniec) {

                if (!parseTime(koniec)) {

                    return interaction.reply({
                        content:
                            "❌ Koniec musi być w formacie `HH:MM`, np. `15:30`.",
                        ephemeral: true
                    });
                }

                osadzony.koniec =
                    koniec;
            }

            if (
                osadzony.poczatek &&
                osadzony.koniec
            ) {

                osadzony.czasKaryMinuty =
                    calculateDurationBetween(
                        osadzony.poczatek,
                        osadzony.koniec
                    );
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Zaktualizowano dane osadzonego **${osadzony.imie} (${osadzony.id})**.`
            });
        }

        // ==================================================
        // /przepustka
        // ==================================================

        if (
            interaction.commandName ===
            "przepustka"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz uprawnień.",
                    ephemeral: true
                });
            }

            const id =
                interaction.options.getString("id");

            const od =
                interaction.options.getString("od");

            const doDate =
                interaction.options.getString("do");

            const powod =
                interaction.options.getString("powod");

            const miejsce =
                interaction.options.getString("miejsce");

            const osadzony =
                getOsadzony(id);

            if (!osadzony) {

                return interaction.reply({
                    content:
                        `❌ Nie znaleziono osadzonego **${id}**.`,
                    ephemeral: true
                });
            }

            if (!parseTime(od)) {

                return interaction.reply({
                    content:
                        "❌ Godzina rozpoczęcia przepustki musi być w formacie `HH:MM`.",
                    ephemeral: true
                });
            }

            if (!parseTime(doDate)) {

                return interaction.reply({
                    content:
                        "❌ Godzina zakończenia przepustki musi być w formacie `HH:MM`.",
                    ephemeral: true
                });
            }

            const przepustkaId =
                `P-${String(
                    db.przepustki.length + 1
                ).padStart(3, "0")}`;

            const przepustka = {

                id:
                    przepustkaId,

                osadzonyId:
                    osadzony.id,

                osadzony:
                    osadzony.imie,

                od,

                do:
                    doDate,

                powod,

                miejsce,

                status:
                    "oczekuje",

                zlozyl:
                    interaction.user.id,

                utworzono:
                    new Date().toISOString()
            };

            db.przepustki.push(
                przepustka
            );

            saveDatabase();

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        "🎫 WNIOSEK O PRZEPUSTKĘ"
                    )

                    .setDescription(
                        `### 👤 ${osadzony.imie}\n` +
                        `**ID:** ${osadzony.id}`
                    )

                    .addFields(

                        {
                            name:
                                "🎫 Numer wniosku",
                            value:
                                przepustkaId,
                            inline: true
                        },

                        {
                            name:
                                "🕐 Od",
                            value:
                                od,
                            inline: true
                        },

                        {
                            name:
                                "🕐 Do",
                            value:
                                doDate,
                            inline: true
                        },

                        {
                            name:
                                "📍 Miejsce",
                            value:
                                miejsce,
                            inline: true
                        },

                        {
                            name:
                                "📝 Powód",
                            value:
                                powod
                        },

                        {
                            name:
                                "🟡 Status",
                            value:
                                "Oczekuje na decyzję"
                        }
                    )

                    .setTimestamp();

            const buttons =
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()

                            .setCustomId(
                                `przepustka_zgoda_${przepustkaId}`
                            )

                            .setLabel(
                                "Zatwierdź"
                            )

                            .setEmoji("✅")

                            .setStyle(
                                ButtonStyle.Success
                            ),

                        new ButtonBuilder()

                            .setCustomId(
                                `przepustka_odmowa_${przepustkaId}`
                            )

                            .setLabel(
                                "Odrzuć"
                            )

                            .setEmoji("❌")

                            .setStyle(
                                ButtonStyle.Danger
                            )
                    );

            const channel =
                interaction.guild.channels.cache.find(
                    ch =>
                        ch.name ===
                        CHANNEL_PRZEPUSTKI &&
                        ch.isTextBased()
                );

            if (channel) {

                await channel.send({

                    embeds: [embed],

                    components: [buttons]

                });
            }

            await interaction.reply({

                content:
                    `✅ Wniosek **${przepustkaId}** został złożony.`,

                ephemeral: true
            });

            await sendLog(

                interaction.guild,

                new EmbedBuilder()

                    .setTitle(
                        "🎫 NOWY WNIOSEK O PRZEPUSTKĘ"
                    )

                    .setDescription(
                        `${interaction.user} złożył wniosek dla **${osadzony.imie} (${osadzony.id})**.`
                    )

                    .addFields({

                        name:
                            "ID wniosku",

                        value:
                            przepustkaId

                    })

                    .setTimestamp()
            );

            return;
        }

        // ==================================================
        // /przepustki
        // ==================================================

        if (
            interaction.commandName ===
            "przepustki"
        ) {

            if (!hasPermission(interaction)) {

                return interaction.reply({
                    content:
                        "❌ Nie masz uprawnień.",
                    ephemeral: true
                });
            }

            const oczekujace =
                db.przepustki.filter(
                    p =>
                        p.status ===
                        "oczekuje"
                );

            if (
                oczekujace.length === 0
            ) {

                return interaction.reply({
                    content:
                        "📭 Brak oczekujących wniosków o przepustkę.",
                    ephemeral: true
                });
            }

            const lista =
                oczekujace
                    .map(p =>
                        `**${p.id}** • ${p.osadzony} (${p.osadzonyId})\n` +
                        `🕐 ${p.od} → ${p.do}\n` +
                        `📍 ${p.miejsce}\n` +
                        `📝 ${p.powod}`
                    )
                    .join("\n\n");

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        "🎫 OCZEKUJĄCE PRZEPUSTKI"
                    )

                    .setDescription(
                        lista
                    )

                    .setTimestamp();

            return interaction.reply({

                embeds: [embed],

                ephemeral: true

            });
        }

        // ==================================================
        // PRZYCISKI PRZEPUSTEK
        // ==================================================

        if (interaction.isButton()) {

            if (
                !interaction.customId.startsWith(
                    "przepustka_"
                )
            ) {
                return;
            }

            if (!hasPermission(interaction)) {

                return interaction.reply({

                    content:
                        "❌ Tylko uprawnione osoby mogą rozpatrywać przepustki.",

                    ephemeral: true

                });
            }

            const parts =
                interaction.customId.split("_");

            const action =
                parts[1];

            const id =
                parts[2];

            const przepustka =
                db.przepustki.find(
                    p =>
                        p.id === id
                );

            if (!przepustka) {

                return interaction.reply({

                    content:
                        "❌ Nie znaleziono tego wniosku.",

                    ephemeral: true

                });
            }

            if (
                przepustka.status !==
                "oczekuje"
            ) {

                return interaction.reply({

                    content:
                        "❌ Ten wniosek został już rozpatrzony.",

                    ephemeral: true

                });
            }

            const osadzony =
                getOsadzony(
                    przepustka.osadzonyId
                );

            // ==============================================
            // ZGODA
            // ==============================================

            if (
                action ===
                "zgoda"
            ) {

                przepustka.status =
                    "zatwierdzona";

                przepustka.rozpatrzyl =
                    interaction.user.id;

                if (osadzony) {

                    osadzony.przepustka =
                        true;
                }

                saveDatabase();

                const embed =
                    new EmbedBuilder()

                        .setTitle(
                            "✅ PRZEPUSTKA ZATWIERDZONA"
                        )

                        .setDescription(
                            `Wniosek **${przepustka.id}** został zatwierdzony.`
                        )

                        .addFields(

                            {
                                name:
                                    "👤 Osadzony",

                                value:
                                    `${przepustka.osadzony} (${przepustka.osadzonyId})`
                            },

                            {
                                name:
                                    "🕐 Termin",

                                value:
                                    `${przepustka.od} → ${przepustka.do}`
                            },

                            {
                                name:
                                    "👮 Zatwierdził",

                                value:
                                    `${interaction.user}`
                            }
                        )

                        .setTimestamp();

                await interaction.update({

                    embeds: [embed],

                    components: []

                });

                await sendLog(
                    interaction.guild,
                    embed
                );

                return;
            }

            // ==============================================
            // ODMOWA
            // ==============================================

            if (
                action ===
                "odmowa"
            ) {

                przepustka.status =
                    "odrzucona";

                przepustka.rozpatrzyl =
                    interaction.user.id;

                saveDatabase();

                const embed =
                    new EmbedBuilder()

                        .setTitle(
                            "❌ PRZEPUSTKA ODRZUCONA"
                        )

                        .setDescription(
                            `Wniosek **${przepustka.id}** został odrzucony.`
                        )

                        .addFields(

                            {
                                name:
                                    "👤 Osadzony",

                                value:
                                    `${przepustka.osadzony} (${przepustka.osadzonyId})`
                            },

                            {
                                name:
                                    "👮 Odrzucił",

                                value:
                                    `${interaction.user}`
                            }
                        )

                        .setTimestamp();

                await interaction.update({

                    embeds: [embed],

                    components: []

                });

                await sendLog(
                    interaction.guild,
                    embed
                );

                return;
            }
        }
    }
);

// ======================================================
// LOGOWANIE
// ======================================================

client.login(TOKEN);
