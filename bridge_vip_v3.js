/**
 * 👑 WHATSAPP-TELEGRAM BRIDGE [FIXED PAIRCODE EDITION]
 * --------------------------------------------------------
 * تم إصلاح ظهور إشعار الربط ومشكلة "تأكد من رقم الهاتف"
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    getContentType,
    delay,
    Browsers
} = require("@whiskeysockets/baileys");
const { Telegraf, Markup, session } = require("telegraf");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

// --- ⚙️ الإعدادات المتقدمة ---
const VIP_CONFIG = {
    PAIRING_TOKEN: process.env.PAIRING_TOKEN || "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI", 
    CONTROL_TOKEN: process.env.CONTROL_TOKEN || "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: process.env.ADMIN_ID || "8510615418",
    SESSION_NAME: "vip_session_data",
    RETRY_DELAY: 5000
};

const sessionPath = path.resolve(__dirname, VIP_CONFIG.SESSION_NAME);
if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

class VIPEngine {
    constructor() {
        this.sock = null;
        this.store = makeInMemoryStore({ logger: pino({ level: "silent" }) });
        this.bot1 = new Telegraf(VIP_CONFIG.PAIRING_TOKEN);
        this.bot2 = new Telegraf(VIP_CONFIG.CONTROL_TOKEN);
        
        this.bot2.use(session());
        this.init();
    }

    async init() {
        this.setupHandlers();
        this.launchBots();
        await this.connectWhatsApp();
    }

    async connectWhatsApp(phone = null, ctx = null) {
        // تنظيف الجلسة القديمة إذا طلب مستخدم رقم جديد لمنع تعارض الـ Creds
        if (phone && ctx) {
            try {
                // إغلاق أي اتصال نشط
                if (this.sock) {
                    this.sock.ev.removeAllListeners();
                    await this.sock.logout().catch(() => {});
                    this.sock.end(undefined);
                }
            } catch (e) {}
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // 🛠 التعديل الجوهري: استخدام تعريف متصفح Mac OS Chrome لضمان ظهور إشعار الربط
            browser: Browsers.macOS('Desktop'), 
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        this.store.bind(this.sock.ev);

        // --- منطق PairCode المطور ---
        if (phone && !this.sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    // تنظيف الرقم من أي رموز زائدة
                    let formattedPhone = phone.replace(/[^0-9]/g, '');
                    
                    if (!formattedPhone.startsWith('966') && formattedPhone.length === 9) {
                        // مثال للسعودية إذا نسي المستخدم الكود الدولي
                        formattedPhone = '966' + formattedPhone;
                    }

                    await ctx.reply(`⏳ جاري طلب كود الربط للرقم: ${formattedPhone}...`);
                    
                    // طلب الكود من السيرفر
                    const code = await this.sock.requestPairingCode(formattedPhone);
                    
                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                    await ctx.replyWithHTML(
                        `💎 <b>كود الربط الخاص بك:</b>\n\n` +
                        `<code>${formattedCode}</code>\n\n` +
                        `✅ <b>الخطوات:</b>\n` +
                        `1. افتح واتساب على هاتفك.\n` +
                        `2. الإعدادات > الأجهزة المرتبطة.\n` +
                        `3. ربط جهاز > ربط برقم الهاتف بدلاً من ذلك.\n` +
                        `4. أدخل الكود أعلاه.`
                    );
                } catch (e) {
                    console.error("Pairing Error:", e);
                    await ctx.reply(`❌ فشل: ${e.message.includes('401') ? "الرقم غير مسجل في واتساب أو محظور" : e.message}`);
                }
            }, 5000); 
        }

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    this.connectWhatsApp();
                } else {
                    this.notifyAdmin("⚠️ تم تسجيل الخروج. يرجى استخدام /pair للربط مجدداً.");
                }
            } else if (connection === 'open') {
                this.notifyAdmin("✅ متصل الآن بنجاح!");
            }
        });

        this.sock.ev.on('creds.update', saveCreds);
        this.sock.ev.on('messages.upsert', (m) => this.handleIncoming(m));
    }

    async handleIncoming(m) {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            // منطق معالجة الرسائل كما هو في كودك...
        }
    }

    setupHandlers() {
        this.bot1.start((ctx) => ctx.reply("أرسل /pair متبوعاً برقمك مع مفتاح الدولة.\nمثال: /pair 9665XXXXXXXX"));
        
        this.bot1.command('pair', async (ctx) => {
            const num = ctx.message.text.split(' ')[1];
            if (!num) return ctx.reply("يرجى إدخال الرقم!");
            await this.connectWhatsApp(num, ctx);
        });

        this.bot2.start((ctx) => {
            if (ctx.from.id.toString() !== VIP_CONFIG.ADMIN_ID) return;
            ctx.reply("لوحة التحكم جاهزة.");
        });
    }

    notifyAdmin(text) {
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }

    launchBots() {
        this.bot1.launch();
        this.bot2.launch();
    }
}

new VIPEngine();
