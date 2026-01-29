// --- CORREÇÃO: FORMATO DE DATA UNIVERSAL ---

// Função auxiliar para pegar data YYYY-MM-DD (Padrão do Site)
function getHoje() {
    return new Date().toISOString().split('T')[0];
}

// Salvar Gasto (Saída)
async function salvarGasto(uid, data, categoria) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/transactions?key=${FIREBASE_KEY}`;
    
    const body = {
        fields: {
            type: { stringValue: "expense" },
            amount: { doubleValue: data.amount },
            description: { stringValue: data.description },
            category: { stringValue: categoria },
            
            // 🔥 O SEGREDO: Enviando a data em 3 formatos para o site não se perder
            date: { stringValue: getHoje() },          // "2026-01-29" (Para filtros simples)
            dateISO: { stringValue: new Date().toISOString() }, // (Para ordenação)
            createdAt: { timestampValue: new Date().toISOString() } // (Para o Firebase)
        }
    };
    
    // Log para você ver no Render se deu erro
    try {
        await axios.post(url, body);
        console.log(`Gasto salvo para ${uid}: ${data.amount}`);
    } catch (e) {
        console.error("Erro no Firebase:", e.response ? e.response.data : e.message);
        throw e; // Joga o erro para o bot avisar no chat
    }
}

// Salvar Renda (Entrada)
async function salvarRenda(uid, data) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/transactions?key=${FIREBASE_KEY}`;
    
    const body = {
        fields: {
            type: { stringValue: "income" },
            amount: { doubleValue: data.amount },
            description: { stringValue: data.description },
            category: { stringValue: "renda" },
            
            // 🔥 MESMA CORREÇÃO AQUI
            date: { stringValue: getHoje() },
            dateISO: { stringValue: new Date().toISOString() },
            createdAt: { timestampValue: new Date().toISOString() }
        }
    };

    try {
        await axios.post(url, body);
        console.log(`Renda salva para ${uid}: ${data.amount}`);
    } catch (e) {
        console.error("Erro no Firebase:", e.response ? e.response.data : e.message);
        throw e;
    }
}
