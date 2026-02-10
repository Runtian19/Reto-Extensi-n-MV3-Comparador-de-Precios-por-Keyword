// popup.js - Código principal del popup

document.addEventListener('DOMContentLoaded', function() {
    // Elementos del DOM
    const elements = {
        keywordInput: document.getElementById('keywordInput'),
        addKeywordBtn: document.getElementById('addKeywordBtn'),
        keywordsList: document.getElementById('keywordsList'),
        statusText: document.getElementById('statusText'),
        productCount: document.getElementById('productCount'),
        activeKeyword: document.getElementById('activeKeyword'),
        activeSite: document.getElementById('activeSite'),
        cancelBtn: document.getElementById('cancelBtn'),
        clearBtn: document.getElementById('clearBtn'),
        falabellaCount: document.getElementById('falabellaCount'),
        mercadolibreCount: document.getElementById('mercadolibreCount'),
        totalCount: document.getElementById('totalCount'),
        quickStats: document.getElementById('quickStats')
    };

    // Variables de estado
    let state = {
        currentKeyword: null,
        currentSite: null,
        isScraping: false,
        port: null,
        keywords: [],
        products: {}
    };

    // Inicialización
    init();

    // Event Listeners
    elements.addKeywordBtn.addEventListener('click', addKeyword);
    elements.keywordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addKeyword();
    });
    elements.cancelBtn.addEventListener('click', cancelScraping);
    elements.clearBtn.addEventListener('click', clearAllData);

    // Función de inicialización
    function init() {
        loadKeywords();
        updateStats();
        setupPortConnection();
        
        // Verificar si hay scraping en curso
        chrome.storage.local.get(['scrapingState'], function(result) {
            if (result.scrapingState && result.scrapingState.isScraping) {
                restoreScrapingState(result.scrapingState);
            }
        });
    }

    // Función para configurar conexión con background
    function setupPortConnection() {
        try {
            // Conectar con el nombre 'scraping' (como espera el background)
            state.port = chrome.runtime.connect({ name: 'scraping' });
            
            state.port.onMessage.addListener(function(message) {
                console.log('Mensaje recibido del background:', message);
                
                switch (message.type) {
                    case 'progress':
                        handleProgress(message);
                        break;
                    case 'result':
                        handleResult(message);
                        break;
                    case 'error':
                        handleError(message);
                        break;
                    case 'cancelled':
                        handleCancelled();
                        break;
                    case 'connected':
                        updateStatus('connected', 'Conectado al background');
                        break;
                }
            });
            
            state.port.onDisconnect.addListener(function() {
                console.log('Conexión con background cerrada');
                updateStatus('error', 'Desconectado del background');
                // Intentar reconectar después de 2 segundos
                setTimeout(setupPortConnection, 2000);
            });
            
        } catch (error) {
            console.error('Error conectando al background:', error);
            updateStatus('error', 'Error de conexión');
            // Intentar reconectar después de 2 segundos
            setTimeout(setupPortConnection, 2000);
        }
    }

    // Función para cargar keywords desde storage
    function loadKeywords() {
        chrome.storage.local.get(['keywords', 'products'], function(result) {
            state.keywords = result.keywords || [];
            state.products = result.products || {};
            renderKeywordsList();
            updateStats();
        });
    }

    // Función para agregar keyword
    function addKeyword() {
        const keyword = elements.keywordInput.value.trim();
        
        if (!keyword) {
            showNotification('Escribe una palabra clave primero', 'error');
            return;
        }
        
        if (state.keywords.includes(keyword)) {
            showNotification('Esta keyword ya existe', 'warning');
            return;
        }
        
        // Agregar a la lista
        state.keywords.push(keyword);
        state.products[keyword] = {
            falabella: [],
            mercadolibre: [],
            timestamp: new Date().toISOString()
        };
        
        // Guardar en storage
        saveToStorage();
        
        // Actualizar UI
        renderKeywordsList();
        elements.keywordInput.value = '';
        updateStats();
        
        showNotification(`Keyword "${keyword}" agregada`, 'success');
    }

    // Función para iniciar scraping
    function startScraping(keyword, site) {
        if (state.isScraping) {
            showNotification('Ya hay un scraping en curso', 'warning');
            return;
        }
        
        state.isScraping = true;
        state.currentKeyword = keyword;
        state.currentSite = site;
        
        // Actualizar UI
        updateStatus('running', 'Scraping en progreso...');
        elements.activeKeyword.textContent = keyword;
        elements.activeSite.textContent = site === 'falabella' ? 'Falabella' : 'MercadoLibre';
        elements.cancelBtn.disabled = false;
        elements.productCount.textContent = '0';
        
        // Guardar estado actual
        saveScrapingState();
        
        // Enviar mensaje al background
        if (state.port) {
            state.port.postMessage({
                type: 'start',
                keyword: keyword,
                site: site,
                timestamp: new Date().toISOString()
            });
        } else {
            showNotification('Error: No hay conexión con el background', 'error');
            resetScrapingState();
        }
    }

    // Función para manejar progreso
    function handleProgress(message) {
        if (state.currentKeyword === message.keyword && state.currentSite === message.site) {
            elements.productCount.textContent = message.count;
            
            // Actualizar estadísticas en tiempo real
            if (message.products) {
                updateKeywordStats(message.keyword, message.site, message.products.length);
            }
        }
    }

    // Función para manejar resultados
    function handleResult(message) {
        if (state.currentKeyword === message.keyword && state.currentSite === message.site) {
            // Guardar productos
            if (state.products[message.keyword]) {
                state.products[message.keyword][message.site] = message.data;
            } else {
                state.products[message.keyword] = {
                    [message.site]: message.data,
                    timestamp: new Date().toISOString()
                };
            }
            
            // Actualizar storage
            saveToStorage();
            
            // Actualizar UI
            updateStatus('done', 'Scraping completado');
            updateStats();
            renderKeywordsList();
            
            // Mostrar notificación
            const productCount = message.data.length;
            const siteName = message.site === 'falabella' ? 'Falabella' : 'MercadoLibre';
            showNotification(`${productCount} productos obtenidos de ${siteName}`, 'success');
            
            resetScrapingState();
        }
    }

    // Función para manejar errores
    function handleError(message) {
        updateStatus('error', `Error: ${message.error}`);
        showNotification(`Error en scraping: ${message.error}`, 'error');
        resetScrapingState();
    }

    // Función para manejar cancelación
    function handleCancelled() {
        updateStatus('cancelled', 'Scraping cancelado');
        showNotification('Scraping cancelado por el usuario', 'warning');
        resetScrapingState();
    }

    // Función para cancelar scraping
    function cancelScraping() {
        if (state.isScraping && state.port) {
            state.port.postMessage({
                type: 'cancel',
                keyword: state.currentKeyword,
                site: state.currentSite
            });
        }
    }

    // Función para restablecer estado de scraping
    function resetScrapingState() {
        state.isScraping = false;
        state.currentKeyword = null;
        state.currentSite = null;
        
        elements.cancelBtn.disabled = true;
        elements.activeKeyword.textContent = 'Ninguna';
        elements.activeSite.textContent = 'Ninguno';
        
        // Limpiar estado de scraping en storage
        chrome.storage.local.remove(['scrapingState']);
    }

    // Función para guardar estado de scraping
    function saveScrapingState() {
        chrome.storage.local.set({
            scrapingState: {
                isScraping: state.isScraping,
                currentKeyword: state.currentKeyword,
                currentSite: state.currentSite,
                timestamp: new Date().toISOString()
            }
        });
    }

    // Función para restaurar estado de scraping
    function restoreScrapingState(scrapingState) {
        state.isScraping = scrapingState.isScraping;
        state.currentKeyword = scrapingState.currentKeyword;
        state.currentSite = scrapingState.currentSite;
        
        if (state.isScraping) {
            updateStatus('running', 'Scraping en progreso...');
            elements.activeKeyword.textContent = state.currentKeyword;
            elements.activeSite.textContent = state.currentSite === 'falabella' ? 'Falabella' : 'MercadoLibre';
            elements.cancelBtn.disabled = false;
            
            // Reconectar con el background
            setupPortConnection();
        }
    }

    // Función para guardar datos en storage
    function saveToStorage() {
        chrome.storage.local.set({
            keywords: state.keywords,
            products: state.products
        });
    }

    // Función para eliminar keyword
    function deleteKeyword(keyword) {
        if (confirm(`¿Estás seguro de eliminar "${keyword}" y todos sus datos?`)) {
            const index = state.keywords.indexOf(keyword);
            if (index > -1) {
                state.keywords.splice(index, 1);
                delete state.products[keyword];
                
                saveToStorage();
                renderKeywordsList();
                updateStats();
                
                showNotification(`Keyword "${keyword}" eliminada`, 'success');
            }
        }
    }

    // Función para mostrar estadísticas
    function showStats(keyword) {
        const products = state.products[keyword];
        if (!products) {
            showNotification('No hay datos para esta keyword', 'warning');
            return;
        }
        
        const falabellaCount = products.falabella ? products.falabella.length : 0;
        const mercadolibreCount = products.mercadolibre ? products.mercadolibre.length : 0;
        
        const statsMessage = `
            Estadísticas para "${keyword}":
            
            Falabella: ${falabellaCount} productos
            MercadoLibre: ${mercadolibreCount} productos
            Total: ${falabellaCount + mercadolibreCount} productos
            
            Última actualización: ${new Date(products.timestamp).toLocaleString()}
        `;
        
        alert(statsMessage.replace(/^\s+/gm, ''));
    }

    // Función para limpiar todos los datos
    function clearAllData() {
        if (confirm('¿Estás seguro de eliminar TODAS las keywords y datos? Esta acción no se puede deshacer.')) {
            state.keywords = [];
            state.products = {};
            
            saveToStorage();
            renderKeywordsList();
            updateStats();
            
            showNotification('Todos los datos han sido eliminados', 'success');
        }
    }

    // Función para renderizar lista de keywords
    function renderKeywordsList() {
        if (state.keywords.length === 0) {
            elements.keywordsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No hay keywords guardadas</p>
                    <p class="small">Agrega una keyword para comenzar</p>
                </div>
            `;
            return;
        }
        
        elements.keywordsList.innerHTML = state.keywords.map(keyword => {
            const products = state.products[keyword] || {};
            const falabellaCount = products.falabella ? products.falabella.length : 0;
            const mercadolibreCount = products.mercadolibre ? products.mercadolibre.length : 0;
            const timestamp = products.timestamp ? new Date(products.timestamp).toLocaleDateString() : 'Nunca';
            
            return `
                <div class="keyword-item" data-keyword="${keyword}">
                    <div class="keyword-header">
                        <div class="keyword-text">
                            <i class="fas fa-hashtag"></i>
                            ${keyword}
                        </div>
                        <div class="keyword-actions">
                            <button class="action-btn search-falabella" data-action="search" data-site="falabella">
                                <i class="fas fa-store"></i> Falabella
                            </button>
                            <button class="action-btn search-mercadolibre" data-action="search" data-site="mercadolibre">
                                <i class="fas fa-shopping-cart"></i> MercadoLibre
                            </button>
                            <button class="action-btn stats-btn" data-action="stats">
                                <i class="fas fa-chart-bar"></i> Estadísticas
                            </button>
                            <button class="action-btn delete-btn" data-action="delete">
                                <i class="fas fa-trash"></i> Eliminar
                            </button>
                        </div>
                    </div>
                    <div class="keyword-stats">
                        <div>
                            <span class="stat-small">Falabella: <strong>${falabellaCount}</strong> productos</span>
                        </div>
                        <div>
                            <span class="stat-small">MercadoLibre: <strong>${mercadolibreCount}</strong> productos</span>
                        </div>
                        <div>
                            <span class="stat-small">Total: <strong>${falabellaCount + mercadolibreCount}</strong> productos</span>
                        </div>
                        <div>
                            <span class="stat-small">Última actualización: <strong>${timestamp}</strong></span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Agregar event listeners a los botones
        document.querySelectorAll('.keyword-item').forEach(item => {
            const keyword = item.getAttribute('data-keyword');
            
            item.querySelectorAll('[data-action="search"]').forEach(btn => {
                btn.addEventListener('click', function() {
                    const site = this.getAttribute('data-site');
                    startScraping(keyword, site);
                });
            });
            
            item.querySelector('[data-action="stats"]').addEventListener('click', function() {
                showStats(keyword);
            });
            
            item.querySelector('[data-action="delete"]').addEventListener('click', function() {
                deleteKeyword(keyword);
            });
        });
    }

    // Función para actualizar estadísticas
    function updateStats() {
        let falabellaTotal = 0;
        let mercadolibreTotal = 0;
        
        Object.values(state.products).forEach(product => {
            falabellaTotal += product.falabella ? product.falabella.length : 0;
            mercadolibreTotal += product.mercadolibre ? product.mercadolibre.length : 0;
        });
        
        elements.falabellaCount.textContent = falabellaTotal;
        elements.mercadolibreCount.textContent = mercadolibreTotal;
        elements.totalCount.textContent = falabellaTotal + mercadolibreTotal;
    }

    // Función para actualizar estadísticas de keyword específica
    function updateKeywordStats(keyword, site, count) {
        const keywordItem = document.querySelector(`.keyword-item[data-keyword="${keyword}"]`);
        if (keywordItem) {
            const statElement = keywordItem.querySelector(`.stat-small strong:nth-child(${site === 'falabella' ? 1 : 2})`);
            if (statElement) {
                statElement.textContent = count;
            }
        }
    }

    // Función para actualizar estado
    function updateStatus(status, text) {
        elements.statusText.textContent = text;
        elements.statusText.className = `status-${status}`;
    }

    // Función para mostrar notificaciones
    function showNotification(message, type = 'info') {
        // Crear elemento de notificación
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        // Estilos para la notificación
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#48bb78' : type === 'error' ? '#f56565' : type === 'warning' ? '#ed8936' : '#4299e1'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        // Agregar al body
        document.body.appendChild(notification);
        
        // Remover después de 3 segundos
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
        
        // Agregar estilos de animación si no existen
        if (!document.querySelector('#notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }
});