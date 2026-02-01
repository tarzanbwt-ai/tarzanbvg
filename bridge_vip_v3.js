/**
 * 👑 WHATSAPP-TELEGRAM BRIDGE [VIP ULTIMATE FIXED EDITION]
 * --------------------------------------------------------
 * تم إصلاح مشكلة PairCode وتعارض الجلسات.
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    downloadContentFromMessage,
    getContentType,
    delay
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
    RETRY_DELAY: 5000,
    BROWSER: ["Ubuntu", "Chrome", "20.0.04"] // استخدام متصفح مدعوم بشكل أفضل
};

// --- 🛠 نظام إدارة الملفات ---
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
        // تشغيل الاتصال المبدئي بدون ربط
        await this.connectWhatsApp();
    }

    async connectWhatsApp(phone = null, ctx = null) {
        // 1. إذا كان هناك اتصال سابق ونحاول الربط، نقوم بإنهائه أولاً لتجنب التضارب
        if (this.sock && phone) {
            try { await this.sock.end(undefined); } catch {}
            this.sock = null;
            await delay(2000); // انتظار بسيط لإغلاق الموارد
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false, // لا نريد طباعة QR في التيرمنال لأننا نستخدم PairCode
            logger: pino({ level: "silent" }),
            browser: VIP_CONFIG.BROWSER,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: undefined // منع التايم آوت السريع
        });

        this.store.bind(this.sock.ev);

        // --- منطق PairCode المصحح ---
        if (phone && ctx) {
            // ننتظر حتى يصبح السوكيت جاهزاً (ليس متصلاً بالكامل، بل جاهز للاتصال)
            setTimeout(async () => {
                try {
                    // التحقق مما إذا كنا مسجلين الدخول بالفعل
                    if (this.sock.authState.creds.me) {
                        return ctx.reply("⚠️ أنت مسجل الدخول بالفعل! احذف الجلسة إذا أردت تغيير الرقم.");
                    }

                    // تنظيف الرقم وإزالة + والمسافات
                    const formattedPhone = phone.replace(/[^0-9]/g, '');
                    
                    await ctx.reply("⏳ جاري طلب الكود من سيرفرات الواتساب...");
                    
                    // طلب الكود
                    const code = await this.sock.requestPairingCode(formattedPhone);
                    
                    // تنسيق الكود ليظهر بشكل جميل (مثال: 1234-5678)
                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                    await ctx.replyWithHTML(
                        `💎 <b>كود الربط الملكي:</b>\n\n` +
                        `<code>${formattedCode}</code>\n\n` +
                        `⚠️ <b>تنبيه:</b> انسخ الكود وضعه في واتساب > الأجهزة المرتبطة > ربط برقم الهاتف.`
                    );
                } catch (e) {
                    console.error("Pairing Error:", e);
                    // تحليل الخطأ لإعطاء رد مفيد
                    if (String(e).includes('bad request')) {
                        await ctx.reply("❌ تنسيق الرقم غير صحيح. تأكد من كتابة الرقم مع الرمز الدولي (مثال: 966xxxx).");
                    } else if (String(e).includes('Rate Limit')) {
                        await ctx.reply("❌ حاولت عدة مرات بسرعة. انتظر قليلاً وحاول مرة أخرى.");
                    } else {
                        await ctx.reply(`❌ فشل طلب الكود: ${e.message || e}`);
                    }
                }
            }, 6000); // زدنا الوقت إلى 6 ثوانٍ لضمان استقرار الاتصال قبل الطلب
        }

        // معالجة الأحداث
        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`⚠️ اتصال مغلق. إعادة الاتصال: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    // إعادة الاتصال فقط إذا لم يكن السبب هو تسجيل الخروج
                    setTimeout(() => this.connectWhatsApp(), VIP_CONFIG.RETRY_DELAY);
                } else {
                    this.notifyAdmin("⚠️ <b>تم تسجيل الخروج!</b>\nيرجى إعادة الربط باستخدام /pair.");
                    // تنظيف ملف الجلسة في حال الخروج النهائي (اختياري)
                    // fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            } else if (connection === 'open') {
                console.log("✅ تم الاتصال بنجاح");
                this.notifyAdmin("🚀 <b>تم الاتصال بنجاح!</b>\nالنظام يعمل بكامل طاقته.");
            }
        });

        this.sock.ev.on('creds.update', saveCreds);
        this.sock.ev.on('messages.upsert', (m) => this.handleIncoming(m));
    }

    async handleIncoming(m) {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            const jid = msg.key.remoteJid;
            const isMe = msg.key.fromMe;
            const pushName = msg.pushName || "مجهول";
            const type = getContentType(msg.message);

            let textContent = this.extractText(msg.message, type);
            const header = isMe ? "📤 <b>أنت أرسلت:</b>" : "📥 <b>وارد جديد:</b>";
            const profile = `👤 <b>${pushName}</b>\n📱 <code>${jid.split('@')[0]}</code>`;
            const footer = `\n━━━━━━━━━━━━━━\n${textContent ? textContent : '📎 [مرفق وسائط]'}`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("💬 رد سريع", `reply:${jid}`), Markup.button.callback("👤 معلومات", `info:${jid}`)],
                [Markup.button.callback("🚫 حظر", `block:${jid}`), Markup.button.callback("🗑 حذف", `del`)]
            ]);

            try {
                if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(type)) {
                    const buffer = await this.getBuffer(msg.message, type);
                    // إضافة حماية من الملفات الفارغة
                    if (!buffer) return;

                    const caption = `${header}\n${profile}${footer}`;
                    
                    if (type === 'imageMessage') await this.bot2.telegram.sendPhoto(VIP_CONFIG.ADMIN_ID, { source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
                    else if (type === 'audioMessage') await this.bot2.telegram.sendVoice(VIP_CONFIG.ADMIN_ID, { source: buffer }, { caption: `${header}\n${profile}`, parse_mode: 'HTML', ...keyboard });
                    else await this.bot2.telegram.sendDocument(VIP_CONFIG.ADMIN_ID, { source: buffer, filename: `VIP_${Date.now()}` }, { caption, parse_mode: 'HTML', ...keyboard });
                } else {
                    await this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, `${header}\n${profile}${footer}`, { parse_mode: 'HTML', ...keyboard });
                }
            } catch (e) { console.error("Sync Error:", e); }
        }
    }

    extractText(msg, type) {
        if (type === 'conversation') return msg.conversation;
        if (type === 'extendedTextMessage') return msg.extendedTextMessage.text;
        if (msg[type]?.caption) return msg[type].caption;
        return "";
    }

    async getBuffer(msg, type) {
        try {
            const stream = await downloadContentFromMessage(msg[type], type.replace('Message', ''));
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return buffer;
        } catch (e) {
            console.error("Error downloading media:", e);
            return null;
        }
    }

    setupHandlers() {
        this.bot1.start((ctx) => ctx.replyWithHTML("👑 <b>نظام الربط العالمي</b>\nأرسل /pair مع الرقم (مثال: /pair 966xxxxxxx)"));
        
        this.bot1.command('pair', async (ctx) => {
            const input = ctx.message.text.split(' ');
            const num = input[1];
            
            if (!num) return ctx.reply("❌ خطأ! يرجى إرسال الرقم بعد الأمر.\nمثال: /pair 96650000000");
            
            // إعادة تهيئة الاتصال خصيصاً للربط
            ctx.reply("🔄 جاري تهيئة الاتصال، يرجى الانتظار...");
            await this.connectWhatsApp(num, ctx);
        });

        // --- أوامر التحكم (Bot 2) ---
        this.bot2.start((ctx) => {
            if (ctx.from.id.toString() !== VIP_CONFIG.ADMIN_ID.toString()) return;
            ctx.replyWithHTML("🛠 <b>لوحة التحكم VIP</b>", 
                Markup.keyboard([['📱 الحالة', '👥 المجموعات'], ['⚙️ الإعدادات']]).resize()
            );
        });
        
        // زر الحالة
        this.bot2.hears('📱 الحالة', async (ctx) => {
             if (ctx.from.id.toString() !== VIP_CONFIG.ADMIN_ID.toString()) return;
             const status = this.sock?.user ? `✅ متصل برقم: ${this.sock.user.id.split(':')[0]}` : "❌ غير متصل";
             ctx.reply(status);
        });

        this.bot2.action(/reply:(.*)/, async (ctx) => {
            ctx.session = { target: ctx.match[1] };
            await ctx.answerCbQuery();
            await ctx.replyWithHTML(`📝 <b>الرد السريع مفعل</b>\nأرسل الآن رسالتك لـ <code>${ctx.match[1]}</code>\nإرسال /cancel للإلغاء.`);
        });

        this.bot2.on('text', async (ctx) => {
            if (ctx.from.id.toString() !== VIP_CONFIG.ADMIN_ID.toString()) return;
            if (ctx.message.text === '/cancel') { ctx.session = null; return ctx.reply("❌ تم الإلغاء."); }
            
            if (ctx.session?.target) {
                try {
                    await this.sock.sendMessage(ctx.session.target, { text: ctx.message.text });
                    ctx.reply("✅ تم الإرسال.", { reply_to_message_id: ctx.message.message_id });
                } catch (e) { ctx.reply("❌ فشل الإرسال، قد يكون الواتساب غير متصل."); }
            }
        });

        this.bot2.action(/info:(.*)/, async (ctx) => {
            const jid = ctx.match[1];
            try {
                const pp = await this.sock.profilePictureUrl(jid, 'image').catch(() => "https://via.placeholder.com/150");
                await ctx.replyWithPhoto(pp, { caption: `ℹ️ <b>معلومات:</b>\n<code>${jid}</code>`, parse_mode: 'HTML' });
            } catch (e) { ctx.reply("❌ لا يمكن جلب المعلومات."); }
        });
    }

    notifyAdmin(text) {
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }

    launchBots() {
        this.bot1.launch({ dropPendingUpdates: true }).then(() => console.log("Bot 1 Live"));
        this.bot2.launch({ dropPendingUpdates: true }).then(() => console.log("Bot 2 Live"));
        
        // Enable graceful stop
        process.once('SIGINT', () => { this.bot1.stop('SIGINT'); this.bot2.stop('SIGINT'); });
        process.once('SIGTERM', () => { this.bot1.stop('SIGTERM'); this.bot2.stop('SIGTERM'); });
    }
}

new VIPEngine();
