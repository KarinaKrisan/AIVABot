require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR WEB ---
const app = express();
app.get('/', (req, res) => res.send('Bot Ativo'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));

// --- CONFIGURAÇÕES ---
const TOKEN = process.env.TELEGRAM_TOKEN || "8518699788:AAHqiiDam0EyvIGLrERVAk7LlqXy-DyAH-8";
const PROJECT_ID = "dashboard-financeiro-8ae9f";
const FIREBASE_KEY = "AIzaSyBP0zktM6dLddWb_qHpm52OiBWU9785R28";
const OCR_KEY = "K85154282888957";

const bot = new Telegraf(TOKEN);
const session = {};

// --- FUNÇÕES ---

function getHoje() { return new Date().toISOString().split('T')[0]; }

async function buscarPorChatId(chatId) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_KEY}`;
    const body = { structuredQuery: { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: "telegramChatId" }, op: "EQUAL", value: { integerValue: chatId } } }, limit: 1 } };
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
            date: { stringValue: getHoje() },
            dateISO: { stringValue: new Date().toISOString() },
            createdAt: { timestampValue: new Date().toISOString() }
        }
    };
    await axios.post(url, body);
}

// --- BOT ---

bot.start((ctx) => ctx.reply("Olá! Digite seu código de 6 dígitos para conectar."));

// Conexão (Código Simplificado)
bot.hears(/^\d{6}$/, async (ctx) => {
    const codigo = ctx.message.text;
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_KEY}`;
    const body = { structuredQuery: { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: "botCode" }, op: "EQUAL", value: { stringValue: codigo } } }, limit: 1 } };
    
    try {
        const res = await axios.post(url, body);
        if (res.data && res.data[0]?.document) {
            const docId = res.data[0].document.name.split('/').pop();
            await axios.patch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${docId}?updateMask.fieldPaths=telegramChatId&updateMask.fieldPaths=telegramConnected&key=${FIREBASE_KEY}`, { fields: { telegramChatId: { integerValue: ctx.chat.id }, telegramConnected: { booleanValue: true } } });
            ctx.reply("✅ Conectado!");
        } else {
            ctx.reply("🚫 Código não encontrado.");
        }
    } catch (e) { ctx.reply("Erro ao conectar."); }
});

// Leitura de Foto (DEBUG ATIVADO)
bot.on('photo', async (ctx) => {
    const user = await buscarPorChatId(ctx.chat.id);
    if (!user) return ctx.reply("🔒 Conecte-se primeiro.");

    const msg = await ctx.reply("👁️ Analisando imagem...");
    
    try {
        const link = await ctx.telegram.getFileLink(ctx.message.photo.pop().file_id);
        const form = new FormData();
        form.append('url', link.href);
        form.append('language', 'por');
        form.append('apikey', OCR_KEY);
        form.append('isTable', 'true'); // Ajuda em cupons fiscais
        
        const res = await axios.post('https://api.ocr.space/parse/image', form, { headers: form.getHeaders() });
        
        // 1. Pega o texto lido
        const text = res.data.ParsedResults?.[0]?.ParsedText || "";
        console.log("TEXTO LIDO PELA API:", text); // Olhe isso nos logs do Render!

        // 2. Tenta achar o valor (Procura R$, Total, ou apenas números grandes com vírgula)
        // Regex explicado: Procura R$ ou nada, seguido de digitos, virgula, 2 digitos.
        const matches = text.match(/(?:R\$|Total|Valor)?\s?(\d+[.,]\d{2})/gi);
        
        let valorEncontrado = 0;
        
        if (matches) {
            // Pega o último valor encontrado (geralmente o Total fica no final do cupom)
            const ultimoValor = matches[matches.length - 1];
            // Limpa o texto para ficar só numero (ex: "R$ 50,00" vira "50.00")
            const numeroLimpo = ultimoValor.replace(/[^\d,]/g, '').replace(',', '.');
            valorEncontrado = parseFloat(numeroLimpo);
        }

        if (valorEncontrado > 0) {
            session[ctx.chat.id] = { uid: user.name.split('/').pop(), amount: valorEncontrado, description: 'Gasto (Foto)' };
            ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
            ctx.reply(`💰 Li: R$ ${valorEncontrado.toFixed(2)}\nQual a categoria?`, Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Casa', 'cat_necessidades'), Markup.button.callback('🍔 Comida', 'cat_estilo')],
                [Markup.button.callback('🚗 Carro', 'cat_dividas'), Markup.button.callback('💳 Outros', 'cat_investimentos')]
            ]));
        } else {
            ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
            ctx.reply(`⚠️ A imagem estava ruim ou a API falhou.\n\nTexto que li: _"${text.substring(0, 50)}..."_\n\nDigite manual: \`gasto 50 mercado\``, {parse_mode: 'Markdown'});
        }

    } catch (e) {
        console.error(e);
        ctx.reply("❌ Erro na API de leitura. Tente digitar o gasto.");
    }
});

// Comandos Manuais
bot.hears(/^(?:\/)?gasto/i, async (ctx) => {
    const user = await buscarPorChatId(ctx.chat.id);
    if (!user) return ctx.reply("🔒 Conecte-se.");
    const parts = ctx.message.text.split(' ');
    const valor = parseFloat(parts[1]?.replace(',', '.'));
    if (!valor) return ctx.reply("⚠️ Ex: gasto 50 almoço");
    session[ctx.chat.id] = { uid: user.name.split('/').pop(), amount: valor, description: parts.slice(2).join(' ') || 'Gasto' };
    ctx.reply(`💸 R$ ${valor.toFixed(2)} - Categoria?`, Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Casa', 'cat_necessidades'), Markup.button.callback('🍔 Comida', 'cat_estilo')],
        [Markup.button.callback('🚗 Carro', 'cat_dividas'), Markup.button.callback('💳 Outros', 'cat_investimentos')]
    ]));
});

bot.action(/cat_(.+)/, async (ctx) => {
    const d = session[ctx.chat.id];
    if (!d) return ctx.reply("⌛ Expirou.");
    await salvarGasto(d.uid, d, ctx.match[1]);
    ctx.editMessageText(`✅ Salvo: R$ ${d.amount.toFixed(2)}`);
    delete session[ctx.chat.id];
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
