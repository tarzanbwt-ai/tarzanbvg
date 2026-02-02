/**
 * 👑 WHATSAPP-TELEGRAM BRIDGE [VIP MULTI-SESSION FIXED]
 * --------------------------------------------------------
 * تم تعديل هوية المتصفح وتوقيت الطلب لضمان ظهور إشعار الربط فوراً
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    makeCacheableSignalKeyStore,
    getContentType,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const { Telegraf, Markup, session } = require("telegraf");
const pino = require("pino");
const fs = require("fs-extra");
const path = require("path");

const logger = pino({ level: "silent" });

// --- ⚙️ الإعدادات ---
const VIP_CONFIG = {
    PAIRING_TOKEN: "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI", 
    CONTROL_TOKEN: "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: "8510615418",
    SESSIONS_DIR: "./all_sessions"
};

fs.ensureDirSync(VIP_CONFIG.SESSIONS_DIR);

class VIPEngine {
    constructor() {
        this.activeSessions = new Map();
        this.bot1 = new Telegraf(VIP_CONFIG.PAIRING_TOKEN);
        this.bot2 = new Telegraf(VIP_CONFIG.CONTROL_TOKEN);
        
        this.bot2.use(session());
        this.init();
    }

    async init() {
        this.setupHandlers();
        // تحميل الجلسات السابقة عند التشغيل
        if (fs.existsSync(VIP_CONFIG.SESSIONS_DIR)) {
            const dirs = fs.readdirSync(VIP_CONFIG.SESSIONS_DIR);
            for (const dir of dirs) {
                if (dir.startsWith('user-')) {
                    const phone = dir.replace('user-', '');
                    this.startWhatsApp(phone);
                }
            }
        }
        
        this.bot1.launch();
        this.bot2.launch();
        console.log("🦁 VIP SYSTEM ONLINE - SESSIONS LOADED");
    }

    async startWhatsApp(phone, ctx = null) {
        const sessionDir = path.join(VIP_CONFIG.SESSIONS_DIR, `user-${phone}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            logger,
            // 🛡️ تعديل هام: استخدام macOS Chrome بدلاً من Ubuntu لضمان ظهور إشعار الربط
            browser: Browsers.macOS("Chrome"), 
            markOnlineOnConnect: true,
            syncFullHistory: false,
            printQRInTerminal: false,
            connectTimeoutMs: 60000
        });

        this.activeSessions.set(phone, sock);

        // --- منطق طلب الكود المصلح بدقة ---
        if (ctx && !sock.authState.creds.registered) {
            // ⏳ زيادة وقت الانتظار إلى 6 ثوانٍ لضمان استقرار قناة الاتصال في Render
            setTimeout(async () => {
                try {
                    const cleanPhone = phone.replace(/[^0-9]/g, '');
                    console.log(`[System] Requesting Pairing Code for: ${cleanPhone}`);
                    
                    const code = await sock.requestPairingCode(cleanPhone);
                    
                    if (code) {
                        await ctx.replyWithHTML(
                            `🦁 <b>كود الربط الملكي (اضغط للنسخ):</b>\n\n` +
                            `<code>${code}</code>\n\n` +
                            `📱 <b>افتح واتساب > الأجهزة المرتبطة</b>\n` +
                            `⚠️ سيظهر لك جهاز جديد باسم <b>macOS Chrome</b>`
                        );
                    }
                } catch (e) {
                    console.error("Pairing Error:", e);
                    await ctx.reply("❌ فشل طلب الكود. يرجى التأكد من الرقم والمحاولة مرة أخرى.");
                }
            }, 6000); 
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) this.startWhatsApp(phone);
                else {
                    this.activeSessions.delete(phone);
                    fs.removeSync(sessionDir);
                }
            } else if (connection === 'open') {
                this.notifyAdmin(`🚀 الجلسة <code>${phone}</code> متصلة الآن.`);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
                this.handleForward(phone, msg);
            }
        });
    }

    handleForward(phone, msg) {
        const jid = msg.key.remoteJid;
        const name = msg.pushName || "مجهول";
        const type = getContentType(msg.message);
        if (msg.key.fromMe) return;

        const text = type === 'conversation' ? msg.message.conversation : 
                     type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : "[وسائط/ملف]";

        const caption = `📥 <b>رسالة جديدة (${phone})</b>\n👤 ${name} | <code>${jid.split('@')[0]}</code>\n━━━━━━━\n${text}`;
        
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, caption, { parse_mode: 'HTML' }).catch(() => {});
    }

    setupHandlers() {
        this.bot1.start((ctx) => ctx.reply("أرسل /pair [الرقم الدولي] للبدء."));
        this.bot1.command('pair', (ctx) => {
            const num = ctx.message.text.split(' ')[1]?.replace(/\D/g, "");
            if (!num || num.length < 10) return ctx.reply("❌ يرجى إدخال الرقم الدولي بشكل صحيح.");
            this.startWhatsApp(num, ctx);
        });

        this.bot2.start((ctx) => {
            if (ctx.from.id.toString() === VIP_CONFIG.ADMIN_ID) {
                ctx.reply("🛠 لوحة التحكم نشطة.");
            }
        });
    }

    notifyAdmin(text) {
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }
}

new VIPEngine();
