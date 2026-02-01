/**
 * 👑 WHATSAPP-TELEGRAM BRIDGE [VIP ULTIMATE EDITION]
 * --------------------------------------------------
 * الإصدار الأقوى: منظم، مرتب، فعال، ومتوافق مع جميع الاستضافات.
 * * الميزات المحدثة:
 * 1. دعم استضافات (Render, VPS, Heroku) بذكاء.
 * 2. نظام إدارة ميديا متقدم (Buffers-only) لتجنب امتلاء قرص الاستضافة.
 * 3. لوحة تحكم VIP مدمجة بأزرار تفاعلية.
 * 4. نظام إعادة اتصال ذاتي (Auto-Self-Heal).
 */

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore,
    downloadContentFromMessage,
    getContentType
} = require("@whiskeysockets/baileys");
const { Telegraf, Markup, session } = require("telegraf");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

// --- ⚙️ الإعدادات المتقدمة (تعديل لمرة واحدة) ---
const VIP_CONFIG = {
    PAIRING_TOKEN: process.env.PAIRING_TOKEN || "توكن_بوت_الربط", 
    CONTROL_TOKEN: process.env.CONTROL_TOKEN || "توكن_بوت_التحكم",
    ADMIN_ID: process.env.ADMIN_ID || "آيدي_حسابك",
    SESSION_NAME: "vip_session_data",
    RETRY_DELAY: 5000,
    BROWSER: ["VIP-Bridge-V3", "MacOS", "3.0.0"]
};

// --- 🛠 نظام إدارة الملفات (التوافق مع الاستضافات) ---
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
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: VIP_CONFIG.BROWSER,
            syncFullHistory: false, // لتقليل استهلاك موارد الاستضافة
            markOnlineOnConnect: true
        });

        this.store.bind(this.sock.ev);

        // طلب كود الربط (Pairing Code)
        if (phone && ctx) {
            setTimeout(async () => {
                try {
                    const code = await this.sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
                    await ctx.replyWithHTML(`💎 <b>كود الربط الملكي:</b>\n\n<code>${code}</code>\n\nأدخله في هاتفك الآن لإتمام الربط.`);
                } catch (e) {
                    await ctx.reply("❌ فشل طلب الكود. تأكد من الرقم وصيغته الدولية.");
                }
            }, 3000);
        }

        // معالجة الأحداث (Connection)
        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log("⚠️ انقطع الاتصال، جاري إعادة المحاولة...");
                    setTimeout(() => this.connectWhatsApp(), VIP_CONFIG.RETRY_DELAY);
                }
            } else if (connection === 'open') {
                this.notifyAdmin("🚀 <b>النظام يعمل بكفاءة قصوى!</b>\nتم الاتصال وتفعيل وضع المزامنة VIP.");
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

            // استخراج المحتوى
            let textContent = this.extractText(msg.message, type);
            const header = isMe ? "📤 <b>أنت أرسلت:</b>" : "📥 <b>وارد جديد:</b>";
            const profile = `👤 <b>${pushName}</b>\n📱 <code>${jid.split('@')[0]}</code>`;
            const footer = `\n━━━━━━━━━━━━━━\n${textContent}`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("💬 رد سريع", `reply:${jid}`), Markup.button.callback("👤 معلومات", `info:${jid}`)],
                [Markup.button.callback("🚫 حظر", `block:${jid}`), Markup.button.callback("🗑 حذف", `del`)]
            ]);

            try {
                if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(type)) {
                    const buffer = await this.getBuffer(msg.message, type);
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
        const stream = await downloadContentFromMessage(msg[type], type.replace('Message', ''));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    }

    setupHandlers() {
        // بوت الربط (Bot 1)
        this.bot1.start((ctx) => ctx.replyWithHTML("👑 <b>نظام الربط العالمي</b>\nأرسل /pair مع الرقم (مثال: /pair 966xxxxxxx)"));
        this.bot1.command('pair', (ctx) => {
            const num = ctx.message.text.split(' ')[1];
            if (!num) return ctx.reply("❌ يرجى إدخال الرقم.");
            this.connectWhatsApp(num, ctx);
        });

        // بوت التحكم (Bot 2)
        this.bot2.start((ctx) => {
            if (ctx.from.id.toString() !== VIP_CONFIG.ADMIN_ID.toString()) return;
            ctx.replyWithHTML("🛠 <b>لوحة التحكم VIP</b>\nالنظام جاهز لاستقبال الأوامر.", 
                Markup.keyboard([['📱 الحالة', '👥 المجموعات'], ['⚙️ الإعدادات']]).resize()
            );
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
                } catch (e) { ctx.reply("❌ فشل الإرسال."); }
            }
        });

        this.bot2.action(/info:(.*)/, async (ctx) => {
            const jid = ctx.match[1];
            try {
                const pp = await this.sock.profilePictureUrl(jid, 'image').catch(() => "https://via.placeholder.com/150");
                const status = await this.sock.fetchStatus(jid).catch(() => ({ status: "لا توجد" }));
                await ctx.replyWithPhoto(pp, { caption: `ℹ️ <b>معلومات الحساب:</b>\nالرقم: <code>${jid}</code>\nالحالة: ${status.status}`, parse_mode: 'HTML' });
            } catch (e) { ctx.reply("❌ خطأ في جلب البيانات."); }
        });
    }

    notifyAdmin(text) {
        this.bot2.telegram.sendMessage(VIP_CONFIG.ADMIN_ID, text, { parse_mode: 'HTML' }).catch(() => {});
    }

    launchBots() {
        this.bot1.launch().then(() => console.log("Bot 1 Live"));
        this.bot2.launch().then(() => console.log("Bot 2 Live"));
    }
}

// البدء الفوري
new VIPEngine();