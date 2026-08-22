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
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
// FUNKCJE
// ======================================================

function hasStaffRole(member) {
    if (!member || !member.roles) return false;

    return STAFF_ROLE_NAMES.some(name =>
        member.roles.cache.some(role => role.name === name)
    );
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );
}

function hasPermission(interaction) {
    return hasStaffRole(interaction.member) || isAdmin(interaction);
}

function createOsadzonyId() {
    const number = db.nextId++;
    saveDatabase();

    return `O-${String(number).padStart(3, "0")}`;
}

function parseDate(dateString) {
    const parts = dateString.split(".");

    if (parts.length !== 3) return null;

    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = Number(parts[2]);

    if (
        !Number.isInteger(day) ||
        !Number.isInteger(month) ||
        !Number.isInteger(year)
    ) {
        return null;
    }

    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function formatDate(dateString) {
    const date = new Date(dateString);

    return date.toLocaleDateString("pl-PL");
}

function calculateDaysLeft(endDate) {
    const end = new Date(endDate);
    const now = new Date();

    end.setHours(23, 59, 59, 999);
    now.setHours(0, 0, 0, 0);

    const difference = end - now;

    if (difference <= 0) {
        return 0;
    }

    return Math.ceil(
        difference / (1000 * 60 * 60 * 24)
    );
}

function getOsadzony(id) {
    return db.osadzeni.find(
        osadzony =>
            osadzony.id.toLowerCase() === id.toLowerCase()
    );
}

async function sendLog(guild, embed) {
    const channel = guild.channels.cache.find(
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
                .setDescription("Długość wyroku")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("poczatek")
                .setDescription("Początek kary DD.MM.RRRR")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("koniec")
                .setDescription("Koniec kary DD.MM.RRRR")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("cela")
                .setDescription("Numer celi")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("osadzony-info")
        .setDescription("Pokazuje kartę osadzonego")
        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Np. O-001")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("osadzeni")
        .setDescription("Pokazuje wszystkich osadzonych"),

    new SlashCommandBuilder()
        .setName("osadzony-usun")
        .setDescription("Usuwa osadzonego z rejestru")
        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Np. O-001")
                .setRequired(true)
        ),

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
                .setName("koniec")
                .setDescription("Nowa data końca DD.MM.RRRR")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("uwagi")
                .setDescription("Uwagi")
                .setRequired(false)
        ),

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
                .setDescription("Od DD.MM.RRRR")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("do")
                .setDescription("Do DD.MM.RRRR")
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

    new SlashCommandBuilder()
        .setName("przepustki")
        .setDescription("Pokazuje oczekujące przepustki")

].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {

    console.log(`✅ Zalogowano jako ${client.user.tag}`);

    const rest = new REST({
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

        console.log("✅ Komendy zostały zarejestrowane.");

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

client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand() &&
        !interaction.isButton()) {
        return;
    }

    // ==================================================
    // /osadzony-dodaj
    // ==================================================

    if (interaction.commandName === "osadzony-dodaj") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz uprawnień do dodawania osadzonych.",
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

        const startDate = parseDate(poczatek);
        const endDate = parseDate(koniec);

        if (!startDate || !endDate) {
            return interaction.reply({
                content:
                    "❌ Nieprawidłowa data. Użyj formatu `DD.MM.RRRR`.",
                ephemeral: true
            });
        }

        if (endDate < startDate) {
            return interaction.reply({
                content:
                    "❌ Data końca kary nie może być wcześniejsza niż początek.",
                ephemeral: true
            });
        }

        const id = createOsadzonyId();

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
            dodanyPrzez: interaction.user.id,
            utworzono: new Date().toISOString()
        };

        db.osadzeni.push(osadzony);
        saveDatabase();

        const embed = new EmbedBuilder()
            .setTitle("🔒 DODANO OSADZONEGO")
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
                    name: "📅 Początek",
                    value: poczatek,
                    inline: true
                },
                {
                    name: "📅 Koniec",
                    value: koniec,
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.reply({
            embeds: [embed]
        });

        await sendLog(
            interaction.guild,
            new EmbedBuilder()
                .setTitle("📥 NOWY OSADZONY")
                .setDescription(
                    `${interaction.user} dodał **${imie}** do rejestru.`
                )
                .addFields({
                    name: "🆔 ID",
                    value: id
                })
                .setTimestamp()
        );

        return;
    }

    // ==================================================
    // /osadzony-info
    // ==================================================

    if (interaction.commandName === "osadzony-info") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz dostępu do rejestru.",
                ephemeral: true
            });
        }

        const id =
            interaction.options.getString("id");

        const osadzony = getOsadzony(id);

        if (!osadzony) {
            return interaction.reply({
                content:
                    `❌ Nie znaleziono osadzonego **${id}**.`,
                ephemeral: true
            });
        }

        const dni = calculateDaysLeft(
            osadzony.koniec
        );

        const status =
            dni <= 0
                ? "✅ KARA ZAKOŃCZONA"
                : `🔒 W TRAKCIE — pozostało **${dni} dni**`;

        const embed = new EmbedBuilder()
            .setTitle(`🔒 KARTA OSADZONEGO — ${osadzony.id}`)
            .setDescription(
                `## 👤 ${osadzony.imie}\n\n${status}`
            )
            .addFields(
                {
                    name: "⚖️ Paragraf",
                    value: osadzony.paragraf,
                    inline: true
                },
                {
                    name: "📋 Wyrok",
                    value: osadzony.wyrok,
                    inline: true
                },
                {
                    name: "🔒 Cela",
                    value: osadzony.cela,
                    inline: true
                },
                {
                    name: "📅 Początek kary",
                    value: osadzony.poczatek,
                    inline: true
                },
                {
                    name: "📅 Koniec kary",
                    value: osadzony.koniec,
                    inline: true
                },
                {
                    name: "🎫 Przepustka",
                    value: osadzony.przepustka
                        ? "✅ Udzielona"
                        : "❌ Brak",
                    inline: true
                },
                {
                    name: "📝 Uwagi",
                    value: osadzony.uwagi || "Brak"
                }
            )
            .setFooter({
                text: "Służba Więzienna • Rejestr Osadzonych"
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

    if (interaction.commandName === "osadzeni") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz dostępu do rejestru.",
                ephemeral: true
            });
        }

        if (db.osadzeni.length === 0) {
            return interaction.reply({
                content: "📭 Aktualnie brak osadzonych.",
                ephemeral: true
            });
        }

        const lista = db.osadzeni.map(osadzony => {

            const dni =
                calculateDaysLeft(osadzony.koniec);

            return (
                `**${osadzony.id}** • ${osadzony.imie}\n` +
                `⚖️ ${osadzony.paragraf} • ` +
                `🔒 Cela ${osadzony.cela} • ` +
                `⏳ ${dni} dni`
            );

        }).join("\n\n");

        const embed = new EmbedBuilder()
            .setTitle("📍 REJESTR OSADZONYCH")
            .setDescription(lista)
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

    if (interaction.commandName === "osadzony-usun") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz uprawnień.",
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
                content: "❌ Nie znaleziono osadzonego.",
                ephemeral: true
            });
        }

        const removed =
            db.osadzeni.splice(index, 1)[0];

        saveDatabase();

        await interaction.reply({
            content:
                `✅ Usunięto **${removed.imie} (${removed.id})** z rejestru.`
        });

        await sendLog(
            interaction.guild,
            new EmbedBuilder()
                .setTitle("🗑️ USUNIĘTO OSADZONEGO")
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

    if (interaction.commandName === "osadzony-edytuj") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz uprawnień.",
                ephemeral: true
            });
        }

        const id =
            interaction.options.getString("id");

        const osadzony = getOsadzony(id);

        if (!osadzony) {
            return interaction.reply({
                content: "❌ Nie znaleziono osadzonego.",
                ephemeral: true
            });
        }

        const cela =
            interaction.options.getString("cela");

        const paragraf =
            interaction.options.getString("paragraf");

        const wyrok =
            interaction.options.getString("wyrok");

        const koniec =
            interaction.options.getString("koniec");

        const uwagi =
            interaction.options.getString("uwagi");

        if (cela) osadzony.cela = cela;
        if (paragraf) osadzony.paragraf = paragraf;
        if (wyrok) osadzony.wyrok = wyrok;
        if (uwagi) osadzony.uwagi = uwagi;

        if (koniec) {

            const date = parseDate(koniec);

            if (!date) {
                return interaction.reply({
                    content:
                        "❌ Nieprawidłowa data. Użyj `DD.MM.RRRR`.",
                    ephemeral: true
                });
            }

            osadzony.koniec = koniec;
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

    if (interaction.commandName === "przepustka") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz uprawnień.",
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

        const osadzony = getOsadzony(id);

        if (!osadzony) {
            return interaction.reply({
                content:
                    `❌ Nie znaleziono osadzonego **${id}**.`,
                ephemeral: true
            });
        }

        const start = parseDate(od);
        const end = parseDate(doDate);

        if (!start || !end) {
            return interaction.reply({
                content:
                    "❌ Nieprawidłowa data. Użyj `DD.MM.RRRR`.",
                ephemeral: true
            });
        }

        if (end < start) {
            return interaction.reply({
                content:
                    "❌ Data powrotu nie może być wcześniejsza.",
                ephemeral: true
            });
        }

        const przepustkaId =
            `P-${String(db.przepustki.length + 1).padStart(3, "0")}`;

        const przepustka = {
            id: przepustkaId,
            osadzonyId: osadzony.id,
            osadzony: osadzony.imie,
            od,
            do: doDate,
            powod,
            miejsce,
            status: "oczekuje",
            zlozyl: interaction.user.id,
            utworzono: new Date().toISOString()
        };

        db.przepustki.push(przepustka);
        saveDatabase();

        const embed = new EmbedBuilder()
            .setTitle("🎫 WNIOSEK O PRZEPUSTKĘ")
            .setDescription(
                `### 👤 ${osadzony.imie}\n` +
                `**ID:** ${osadzony.id}`
            )
            .addFields(
                {
                    name: "🎫 Numer wniosku",
                    value: przepustkaId,
                    inline: true
                },
                {
                    name: "📅 Od",
                    value: od,
                    inline: true
                },
                {
                    name: "📅 Do",
                    value: doDate,
                    inline: true
                },
                {
                    name: "📍 Miejsce",
                    value: miejsce,
                    inline: true
                },
                {
                    name: "📝 Powód",
                    value: powod
                },
                {
                    name: "🟡 Status",
                    value: "Oczekuje na decyzję"
                }
            )
            .setTimestamp();

        const buttons =
            new ActionRowBuilder().addComponents(

                new ButtonBuilder()
                    .setCustomId(`przepustka_zgoda_${przepustkaId}`)
                    .setLabel("Zatwierdź")
                    .setEmoji("✅")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`przepustka_odmowa_${przepustkaId}`)
                    .setLabel("Odrzuć")
                    .setEmoji("❌")
                    .setStyle(ButtonStyle.Danger)
            );

        const channel =
            interaction.guild.channels.cache.find(
                ch =>
                    ch.name === CHANNEL_PRZEPUSTKI &&
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
                .setTitle("🎫 NOWY WNIOSEK O PRZEPUSTKĘ")
                .setDescription(
                    `${interaction.user} złożył wniosek dla **${osadzony.imie} (${osadzony.id})**.`
                )
                .addFields({
                    name: "ID wniosku",
                    value: przepustkaId
                })
                .setTimestamp()
        );

        return;
    }

    // ==================================================
    // /przepustki
    // ==================================================

    if (interaction.commandName === "przepustki") {

        if (!hasPermission(interaction)) {
            return interaction.reply({
                content: "❌ Nie masz uprawnień.",
                ephemeral: true
            });
        }

        const oczekujace =
            db.przepustki.filter(
                p => p.status === "oczekuje"
            );

        if (oczekujace.length === 0) {
            return interaction.reply({
                content:
                    "📭 Brak oczekujących wniosków o przepustkę.",
                ephemeral: true
            });
        }

        const lista = oczekujace.map(p =>
            `**${p.id}** • ${p.osadzony} (${p.osadzonyId})\n` +
            `📅 ${p.od} → ${p.do}\n` +
            `📍 ${p.miejsce}\n` +
            `📝 ${p.powod}`
        ).join("\n\n");

        const embed = new EmbedBuilder()
            .setTitle("🎫 OCZEKUJĄCE PRZEPUSTKI")
            .setDescription(lista)
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
            !interaction.customId.startsWith("przepustka_")
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

        const action = parts[1];
        const id = parts[2];

        const przepustka =
            db.przepustki.find(
                p => p.id === id
            );

        if (!przepustka) {
            return interaction.reply({
                content:
                    "❌ Nie znaleziono tego wniosku.",
                ephemeral: true
            });
        }

        if (przepustka.status !== "oczekuje") {
            return interaction.reply({
                content:
                    "❌ Ten wniosek został już rozpatrzony.",
                ephemeral: true
            });
        }

        const osadzony =
            getOsadzony(przepustka.osadzonyId);

        // ==============================================
        // ZGODA
        // ==============================================

        if (action === "zgoda") {

            przepustka.status = "zatwierdzona";
            przepustka.rozpatrzyl =
                interaction.user.id;

            if (osadzony) {
                osadzony.przepustka = true;
            }

            saveDatabase();

            const embed =
                new EmbedBuilder()
                    .setTitle("✅ PRZEPUSTKA ZATWIERDZONA")
                    .setDescription(
                        `Wniosek **${przepustka.id}** został zatwierdzony.`
                    )
                    .addFields(
                        {
                            name: "👤 Osadzony",
                            value:
                                `${przepustka.osadzony} (${przepustka.osadzonyId})`
                        },
                        {
                            name: "📅 Termin",
                            value:
                                `${przepustka.od} → ${przepustka.do}`
                        },
                        {
                            name: "👮 Zatwierdził",
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

        if (action === "odmowa") {

            przepustka.status = "odrzucona";
            przepustka.rozpatrzyl =
                interaction.user.id;

            saveDatabase();

            const embed =
                new EmbedBuilder()
                    .setTitle("❌ PRZEPUSTKA ODRZUCONA")
                    .setDescription(
                        `Wniosek **${przepustka.id}** został odrzucony.`
                    )
                    .addFields(
                        {
                            name: "👤 Osadzony",
                            value:
                                `${przepustka.osadzony} (${przepustka.osadzonyId})`
                        },
                        {
                            name: "👮 Odrzucił",
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

});

// ======================================================
// LOGOWANIE
// ======================================================

client.login(TOKEN);
