require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express'); // O Truque para o Render

// --- 1. O TRUQUE PARA O RENDER NÃO DESLIGAR ---
const app = express();
app.get('/', (req, res) => res.send('🤖 Bot AIVA está Online e Operante!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Web rodando na porta ${PORT}`));

console.log("🚀 Iniciando AIVA Bot...");

// --- 2. CONFIGURAÇÕES ---
const TOKEN = process.env.TELEGRAM_TOKEN || "8518699788:AAHqiiDam0EyvIGLrERVAk7LlqXy-DyAH-8";
const PROJECT_ID = "dashboard-financeiro-8ae9f"; 
const FIREBASE_KEY = "AIzaSyBP0zktM6dLddWb_qHpm52OiBWU9785R28"; 
const OCR_KEY = "K85154282888957";

const bot = new Telegraf(TOKEN);
const session = {}; 

// --- 3. FUNÇÕES (REST API) ---

async function buscarUsuario(codigo) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_KEY}`;
    const body = {
        structuredQuery: {
            from: [{ collectionId: "users" }],
            where: {
                fieldFilter: {
                    field: { fieldPath: "botCode" },
                    op: "EQUAL",
                    value: { stringValue: codigo.trim() }
                }
            },
            limit: 1
        }
    };
    try {
        const res = await axios.post(url, body);
        if (res.data && res.data.length > 0 && res.data[0].document) return res.data[0].document;
        return null;
    } catch (e) { return null; }
}

async function conectarNoBanco(docName, chatId) {
    const docId = docName.split('/').pop();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${docId}?updateMask.fieldPaths=telegramChatId&updateMask.fieldPaths=telegramConnected&key=${FIREBASE_KEY}`;
    const body = { fields: { telegramChatId: { integerValue: chatId }, telegramConnected: { booleanValue: true } } };
    await axios.patch(url, body);
}

async function buscarPorChatId(chatId) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_KEY}`;
    const body = {
        structuredQuery: {
            from: [{ collectionId: "users" }],
            where: {
                fieldFilter: {
                    field: { fieldPath: "telegramChatId" },
                    op: "EQUAL",
                    value: { integerValue: chatId }
                }
            },
            limit: 1
        }
    };
    try {
        const res = await axios.post(url, body);
        if (res.data && res.data[0]?.document) return res.data[0].document;
    } catch (e) { return null; }
    return null;
}

async function salvarGasto(uid, data, categoria) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/transactions?key=${FIREBASE_KEY}`;
    const body = {
        fields: {
            type: { stringValue: "expense" },
            amount: { doubleValue: data.amount },
            description: { stringValue: data.description },
            category: { stringValue: categoria },
            dateISO: { stringValue: new Date().toISOString() },
            createdAt: { timestampValue: new Date().toISOString() }
        }
    };
    await axios.post(url, body);
}

// --- 4. COMANDOS ---

bot.start((ctx) => {
    ctx.reply(`👋 Olá! Envie o **código de 6 dígitos** do site para conectar.`);
});

const conectar = async (ctx, codigo) => {
    if (!codigo) return ctx.reply("⚠️ Código vazio.");
    await ctx.reply(`🔍 Verificando: ${codigo}...`);
    const userDoc = await buscarUsuario(codigo);
    
    if (userDoc) {
        await conectarNoBanco(userDoc.name, ctx.chat.id);
        ctx.reply("✅ **Conectado!**\nAgora envie uma foto do comprovante ou digite: `gasto 50 mercado`", {parse_mode: 'Markdown'});
    } else {
        ctx.reply("🚫 Código não encontrado. Verifique no site.");
    }
};

bot.hears(/^\d{6}$/, (ctx) => conectar(ctx, ctx.message.text));
bot.command('conectar', (ctx) => conectar(ctx, ctx.message.text.split(' ')[1]));

bot.on('photo', async (ctx) => {
    const user = await buscarPorChatId(ctx.chat.id);
    if (!user) return ctx.reply("🔒 Envie o código de 6 números primeiro.");
    
    const msg = await ctx.reply("👁️ Lendo foto...");
    try {
        const link = await ctx.telegram.getFileLink(ctx.message.photo.pop().file_id);
        const form = new FormData();
        form.append('url', link.href);
        form.append('language', 'por');
        form.append('apikey', OCR_KEY);
        
        const res = await axios.post('https://api.ocr.space/parse/image', form, { headers: form.getHeaders() });
        const text = res.data.ParsedResults?.[0]?.ParsedText || "";
        const valor = text.match(/(?:R\$|Total|Valor)\s?[:.]?\s?(\d+[.,]\d{2})/i);
        
        if (valor) {
            const v = parseFloat(valor[1].replace(',', '.'));
            session[ctx.chat.id] = { uid: user.name.split('/').pop(), amount: v, description: 'Gasto (Foto)' };
            ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
            ctx.reply(`💰 R$ ${v}\nCategoria?`, Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Casa', 'cat_necessidades'), Markup.button.callback('🍔 Comida', 'cat_estilo')]
            ]));
        } else {
            ctx.reply("❓ Não entendi o valor. Tente digitar.");
        }
    } catch (e) { ctx.reply("❌ Erro na leitura."); }
});

bot.hears(/^(?:\/)?gasto/i, async (ctx) => {
    const user = await buscarPorChatId(ctx.chat.id);
    if (!user) return ctx.reply("🔒 Conecte-se primeiro.");
    const parts = ctx.message.text.split(' ');
    const valor = parseFloat(parts[1]?.replace(',', '.'));
    if (!valor) return ctx.reply("⚠️ Use: gasto 50 padaria");
    session[ctx.chat.id] = { uid: user.name.split('/').pop(), amount: valor, description: parts.slice(2).join(' ') || 'Gasto' };
    ctx.reply(`💸 R$ ${valor} - Categoria?`, Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Casa', 'cat_necessidades'), Markup.button.callback('🍔 Comida', 'cat_estilo')]
    ]));
});

bot.action(/cat_(.+)/, async (ctx) => {
    const d = session[ctx.chat.id];
    if (!d) return ctx.reply("⌛ Expirou.");
    await salvarGasto(d.uid, d, ctx.match[1]);
    ctx.editMessageText(`✅ Salvo: R$ ${d.amount}`);
    delete session[ctx.chat.id];
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));