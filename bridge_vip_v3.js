/**
 * 👑 WHATSAPP-TELEGRAM ULTIMATE BRIDGE (2025 EDITION)
 * --------------------------------------------------
 * تم التطوير بدقة عالية لحل مشاكل تعدد الجلسات وربط الأرقام.
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    getContentType,
    Browsers,
    delay
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

// ضمان وجود مجلد الجلسات
fs.ensureDirSync(CONFIG.SESSIONS_BASE_PATH);

class WhatsAppBridge {
    constructor() {
        this.activeConnections = new Map();
        this.pairingBot = new Telegraf(CONFIG.PAIRING_BOT_TOKEN);
        this.managerBot = new Telegraf(CONFIG.MANAGER_BOT_TOKEN);
        
        this.managerBot.use(session());
        this.init();
    }

    async init() {
        console.log("🚀 جاري تشغيل النظام الاحترافي...");
        this.setupBotHandlers();
        await this.restoreSessions();
        
        this.pairingBot.launch();
        this.managerBot.launch();
    }

    /**
     * استعادة الجلسات السابقة عند تشغيل السيرفر
     */
    async restoreSessions() {
        const folders = await fs.readdir(CONFIG.SESSIONS_BASE_PATH);
        for (const folder of folders) {
            if (folder.startsWith("user_")) {
                const phone = folder.replace("user_", "");
                console.log(`♻️ استعادة اتصال: ${phone}`);
                this.createWhatsAppInstance(phone);
            }
        }
    }

    /**
     * المحرك الرئيسي لإنشاء مثيل واتساب معزول
     */
    async createWhatsAppInstance(phone, telegramCtx = null) {
        const sessionDir = path.join(CONFIG.SESSIONS_BASE_PATH, `user_${phone}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: CONFIG.LOG_LEVEL }),
            // 🛡 استخدام Browsers.macOS هو الحل الأضمن لظهور إشعار الربط (Pairing Notification)
            browser: Browsers.macOS('Desktop'),
            printQRInTerminal: false,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            // تقليل التايم آوت لزيادة الاستقرار
            connectTimeoutMs: 60000
        });

        this.activeConnections.set(phone, sock);

        // --- منطق PairCode المحسن بدقة ---
        if (telegramCtx && !sock.authState.creds.registered) {
            await delay(4000); // وقت مستقطع لضمان جاهزية السوكيت
            try {
                const code = await sock.requestPairingCode(phone);
                const prettyCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                await telegramCtx.replyWithHTML(
                    `💎 <b>كود الربط الخاص بك جاهز</b>\n\n` +
                    `الرقم: <code>${phone}</code>\n` +
                    `الكود: <code>${prettyCode}</code>\n\n` +
                    `📝 <b>طريقة التفعيل:</b>\n` +
                    `1. افتح واتساب > الأجهزة المرتبطة.\n` +
                    `2. اختر "ربط جهاز" ثم "الربط برقم الهاتف".\n` +
                    `3. أدخل الكود في هاتفك فوراً.`
                );
            } catch (err) {
                console.error("Pairing Error:", err);
                await telegramCtx.reply("❌ حدث خطأ أثناء طلب الكود. يرجى المحاولة لاحقاً.");
            }
        }

        // --- إدارة الأحداث ---
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    console.log(`🔄 إعادة اتصال تلقائي للرقم ${phone}...`);
                    this.createWhatsAppInstance(phone);
                } else {
                    console.log(`🚫 تم تسجيل الخروج النهائي للرقم ${phone}`);
                    this.activeConnections.delete(phone);
                    await fs.remove(sessionDir);
                    this.notifyAdmin(`⚠️ الجلسة <code>${phone}</code> سجلت خروجها وتم حذف بياناتها.`);
                }
            } else if (connection === 'open') {
                this.notifyAdmin(`✅ <b>تم ربط الرقم بنجاح!</b>\nالجلسة: <code>${phone}</code> نشطة الآن.`);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
                this.processIncomingMessage(phone, msg);
            }
        });
    }

    /**
     * معالجة وتحويل الرسائل الواردة إلى تليجرام
     */
    async processIncomingMessage(instancePhone, msg) {
        const jid = msg.key.remoteJid;
        const name = msg.pushName || "مجهول";
        const type = getContentType(msg.message);
        const fromMe = msg.key.fromMe;

        // تجاهل رسائل البوت نفسه لتجنب الحلقات المفرغة
        if (fromMe) return;

        const caption = `📱 <b>واتساب (${instancePhone})</b>\n👤 <b>من:</b> ${name}\n🆔 <code>${jid.split('@')[0]}</code>\n━━━━━━━\n`;
        const text = this.getText(msg.message, type);

        try {
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("💬 رد سريع", `reply:${instancePhone}:${jid}`)]
            ]);

            await this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, caption + text, { 
                parse_mode: 'HTML',
                ...keyboard 
            });
        } catch (e) {
            console.error("Forwarding Error:", e);
        }
    }

    getText(msg, type) {
        if (type === 'conversation') return msg.conversation;
        if (type === 'extendedTextMessage') return msg.extendedTextMessage.text;
        if (msg[type]?.caption) return msg[type].caption;
        return "📎 [وسائط/ملف]";
    }

    /**
     * إعداد أوامر البوتات
     */
    setupBotHandlers() {
        // --- بوت الربط ---
        this.pairingBot.start((ctx) => {
            ctx.replyWithHTML("👑 <b>مرحباً بك في نظام الربط VIP</b>\nأرسل /pair متبوعاً بالرقم مع الكود الدولي.\n\nمثال: <code>/pair 966501234567</code>");
        });

        this.pairingBot.command('pair', async (ctx) => {
            const phone = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');
            if (!phone || phone.length < 10) return ctx.reply("❌ يرجى كتابة الرقم بشكل صحيح.");
            
            if (this.activeConnections.has(phone)) return ctx.reply("⚠️ هذا الرقم مرتبط بالفعل!");
            
            await ctx.reply("⏳ جاري طلب الكود من سيرفرات واتساب...");
            this.createWhatsAppInstance(phone, ctx);
        });

        // --- بوت المدير ---
        this.managerBot.start((ctx) => {
            if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
            ctx.reply("🛠 لوحة التحكم نشطة. ستصلك الرسائل هنا.");
        });

        this.managerBot.command('status', (ctx) => {
            if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
            let msg = "📱 <b>الجلسات النشطة:</b>\n\n";
            this.activeConnections.forEach((_, key) => msg += `✅ ${key}\n`);
            ctx.replyWithHTML(this.activeConnections.size > 0 ? msg : "لا توجد جلسات نشطة.");
        });

        // الرد السريع
        this.managerBot.action(/reply:(.*):(.*)/, async (ctx) => {
            const [_, phone, targetJid] = ctx.match;
            ctx.session = { activeReply: { phone, targetJid } };
            await ctx.answerCbQuery();
            await ctx.replyWithHTML(`📝 أرسل رسالتك الآن للرد على <code>${targetJid.split('@')[0]}</code> عبر الرقم <code>${phone}</code>\n/cancel لإلغاء الرد.`);
        });

        this.managerBot.on('text', async (ctx) => {
            if (ctx.from.id.toString() !== CONFIG.ADMIN_ID) return;
            if (ctx.message.text === '/cancel') { ctx.session = null; return ctx.reply("❌ تم الإلغاء."); }

            if (ctx.session?.activeReply) {
                const { phone, targetJid } = ctx.session.activeReply;
                const sock = this.activeConnections.get(phone);
                
                if (sock) {
                    await sock.sendMessage(targetJid, { text: ctx.message.text });
                    ctx.reply("✅ تم إرسال الرد.");
                    ctx.session = null;
                } else {
                    ctx.reply("❌ فشل: الجلسة غير متصلة حالياً.");
                }
            }
        });
    }

    notifyAdmin(text) {
        this.managerBot.telegram.sendMessage(CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }
}

// البدء
new WhatsAppBridge();
