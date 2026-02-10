console.log('✅ Background service worker iniciado');
let activeConnections = new Map();
let scrapingTabs = new Map();
let popupPort = null;

// Manejar conexiones
chrome.runtime.onConnect.addListener((port) => {
    console.log(`🔗 Nueva conexión: ${port.name}`);
    
    if (port.name === 'scraping') {
        handlePopupConnection(port);
    } else if (port.name === 'content') {
        handleContentConnection(port);
    }
    
    // Manejar desconexión
    port.onDisconnect.addListener(() => {
        console.log(`🔌 Conexión cerrada: ${port.name}`);
        cleanupConnection(port);
    });
});
function handlePopupConnection(port) {
    popupPort = port;
    
    port.onMessage.addListener(async (message) => {
        console.log('📨 Mensaje del popup:', message);
        
        switch (message.type) {
            case 'start':
                await startScraping(message);
                break;
            case 'cancel':
                cancelScraping(message);
                break;
            case 'ping':
                port.postMessage({ type: 'pong', timestamp: Date.now() });
                break;
        }
    });
    
    // Enviar confirmación de conexión
    port.postMessage({ type: 'connected', timestamp: Date.now() });
}

// Manejar conexión del content script
function handleContentConnection(port) {
    const tabId = port.sender?.tab?.id;
    
    if (tabId) {
        activeConnections.set(tabId, port);
        
        port.onMessage.addListener((message) => {
            console.log(`📨 Mensaje de content (tab ${tabId}):`, message);
            
            // Reenviar al popup si está conectado
            if (popupPort) {
                popupPort.postMessage(message);
            }
            
            // Manejar mensajes específicos
            if (message.type === 'scrapingComplete' || message.type === 'scrapingError') {
                cleanupTab(tabId);
            }
        });
    }
}

// Iniciar scraping
async function startScraping(message) {
    const { keyword, site, timestamp } = message;
    const connectionKey = `${keyword}-${site}`;
    
    console.log(`🚀 Iniciando scraping: ${keyword} en ${site}`);
    
    // Construir URL de búsqueda
    let searchUrl;
    if (site === 'falabella') {
        searchUrl = `https://www.falabella.com.pe/falabella-pe/search?Ntt=${encodeURIComponent(keyword)}`;
    } else if (site === 'mercadolibre') {
        searchUrl = `https://listado.mercadolibre.com.pe/${encodeURIComponent(keyword.replace(/\s+/g, '-'))}`;
    }
    
    try {
        // Crear nueva pestaña
        const tab = await chrome.tabs.create({
            url: searchUrl,
            active: false
        });
        
        // Guardar referencia
        scrapingTabs.set(connectionKey, tab.id);
        
        // Esperar a que la pestaña cargue
        await waitForTabLoad(tab.id);
        
        // Inyectar content script si no se inyectó automáticamente
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        
        // Enviar mensaje al content script
        setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
                action: 'startScraping',
                keyword: keyword,
                site: site,
                url: searchUrl,
                timestamp: timestamp
            }).catch(error => {
                console.error('Error enviando mensaje a content:', error);
                handleScrapingError(keyword, site, error.message);
            });
        }, 2000);
        
    } catch (error) {
        console.error('Error iniciando scraping:', error);
        handleScrapingError(keyword, site, error.message);
    }
}

// Cancelar scraping
function cancelScraping(message) {
    const { keyword, site } = message;
    const connectionKey = `${keyword}-${site}`;
    
    const tabId = scrapingTabs.get(connectionKey);
    if (tabId) {
        // Enviar mensaje de cancelación al content script
        chrome.tabs.sendMessage(tabId, {
            action: 'cancelScraping'
        }).catch(() => {
            // Ignorar errores si la pestaña ya está cerrada
        });
        
        // Cerrar pestaña
        chrome.tabs.remove(tabId);
        
        // Limpiar referencias
        scrapingTabs.delete(connectionKey);
        
        // Notificar al popup
        if (popupPort) {
            popupPort.postMessage({
                type: 'cancelled',
                keyword: keyword,
                site: site,
                timestamp: Date.now()
            });
        }
        
        console.log(`⏹️ Scraping cancelado: ${keyword} en ${site}`);
    }
}

// Esperar a que cargue la pestaña
function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        
        // Timeout de seguridad
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 10000);
    });
}

// Manejar errores de scraping
function handleScrapingError(keyword, site, error) {
    if (popupPort) {
        popupPort.postMessage({
            type: 'error',
            keyword: keyword,
            site: site,
            error: error,
            timestamp: Date.now()
        });
    }
    
    // Limpiar tab si existe
    const connectionKey = `${keyword}-${site}`;
    const tabId = scrapingTabs.get(connectionKey);
    if (tabId) {
        chrome.tabs.remove(tabId);
        scrapingTabs.delete(connectionKey);
    }
}

// Limpiar conexión
function cleanupConnection(port) {
    // Buscar y eliminar de activeConnections
    for (const [tabId, p] of activeConnections.entries()) {
        if (p === port) {
            activeConnections.delete(tabId);
            break;
        }
    }
    
    // Si es el popup, limpiar referencia
    if (port === popupPort) {
        popupPort = null;
    }
}

// Limpiar tab
function cleanupTab(tabId) {
    // Cerrar tab
    chrome.tabs.remove(tabId).catch(() => {
        // Ignorar errores si ya está cerrado
    });
    
    // Eliminar de activeConnections
    activeConnections.delete(tabId);
    
    // Eliminar de scrapingTabs
    for (const [key, id] of scrapingTabs.entries()) {
        if (id === tabId) {
            scrapingTabs.delete(key);
            break;
        }
    }
}

// Manejar mensajes directos (para content scripts que no usan connect)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Mensaje directo recibido:', message);
    
    if (message.type === 'progress' || message.type === 'result' || message.type === 'error') {
        // Reenviar al popup
        if (popupPort) {
            popupPort.postMessage({
                ...message,
                tabId: sender.tab?.id
            });
        }
    }
    
    sendResponse({ received: true });
});

// Limpiar al iniciar (por si hubo cierre inesperado)
chrome.runtime.onStartup.addListener(() => {
    console.log('🔄 Background iniciado después de reinicio');
    activeConnections.clear();
    scrapingTabs.clear();
});

// Manejar cierre de pestañas
chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTab(tabId);
});

// Mantener vivo el service worker
setInterval(() => {
    console.log('❤️ Service worker activo');
}, 30000);