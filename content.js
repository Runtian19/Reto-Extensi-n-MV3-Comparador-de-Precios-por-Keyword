// content.js - Script de scraping para Falabella y MercadoLibre Perú

console.log('✅ Content script cargado en:', window.location.hostname);

// Variables globales
let scrapingState = {
    isActive: false,
    keyword: null,
    site: null,
    products: [],
    progressInterval: null,
    currentPage: 1,
    maxPages: 1
};

// Conectar con background
const port = chrome.runtime.connect({ name: 'content' });

// Escuchar mensajes del background
port.onMessage.addListener((message) => {
    console.log('📨 Mensaje del background:', message);
    
    if (message.action === 'startScraping') {
        startScrapingProcess(message.keyword, message.site);
    } else if (message.action === 'cancelScraping') {
        cancelScrapingProcess();
    }
});

// Iniciar proceso de scraping
async function startScrapingProcess(keyword, site) {
    if (scrapingState.isActive) {
        sendError('Ya hay un scraping en curso');
        return;
    }
    
    // Inicializar estado
    scrapingState = {
        isActive: true,
        keyword: keyword,
        site: site,
        products: [],
        progressInterval: null,
        currentPage: 1,
        maxPages: site === 'falabella' ? 3 : 5 // Límite de páginas a scrapear
    };
    
    console.log(`🚀 Iniciando scraping de ${keyword} en ${site}`);
    
    // Enviar progreso inicial
    sendProgress(0);
    
    // Determinar qué función usar
    if (site === 'falabella') {
        await scrapeFalabella();
    } else if (site === 'mercadolibre') {
        await scrapeMercadoLibre();
    }
}

// Scraping para Falabella Perú
async function scrapeFalabella() {
    try {
        console.log('🔍 Scraping Falabella Perú...');
        
        // Esperar a que cargue la página
        await waitForPageLoad();
        
        let allProducts = [];
        let hasMorePages = true;
        
        // Scrapear múltiples páginas
        while (scrapingState.isActive && hasMorePages && scrapingState.currentPage <= scrapingState.maxPages) {
            console.log(`📄 Procesando página ${scrapingState.currentPage}`);
            
            // Scrapear productos de la página actual
            const pageProducts = await scrapeFalabellaPage();
            allProducts = [...allProducts, ...pageProducts];
            
            // Enviar progreso
            sendProgress(allProducts.length);
            
            // Verificar si hay más páginas
            hasMorePages = await goToNextPageFalabella();
            
            if (hasMorePages) {
                scrapingState.currentPage++;
                await waitForPageLoad();
                await delay(2000); // Esperar entre páginas
            }
        }
        
        // Verificar mínimo de productos
        if (allProducts.length < 60) {
            console.warn(`⚠️ Solo se obtuvieron ${allProducts.length} productos (mínimo recomendado: 60)`);
        }
        
        // Normalizar y enviar resultados
        const normalizedProducts = normalizeProducts(allProducts, 'falabella');
        sendResults(normalizedProducts);
        
    } catch (error) {
        console.error('Error scraping Falabella:', error);
        sendError(error.message);
    }
}

// Scraping para MercadoLibre Perú
async function scrapeMercadoLibre() {
    try {
        console.log('🔍 Scraping MercadoLibre Perú...');
        
        await waitForPageLoad();
        
        let allProducts = [];
        let hasMorePages = true;
        
        while (scrapingState.isActive && hasMorePages && scrapingState.currentPage <= scrapingState.maxPages) {
            console.log(`📄 Procesando página ${scrapingState.currentPage}`);
            
            const pageProducts = await scrapeMercadoLibrePage();
            allProducts = [...allProducts, ...pageProducts];
            
            sendProgress(allProducts.length);
            
            hasMorePages = await goToNextPageMercadoLibre();
            
            if (hasMorePages) {
                scrapingState.currentPage++;
                await waitForPageLoad();
                await delay(2000);
            }
        }
        
        if (allProducts.length < 100) {
            console.warn(`⚠️ Solo se obtuvieron ${allProducts.length} productos (mínimo recomendado: 100)`);
        }
        
        const normalizedProducts = normalizeProducts(allProducts, 'mercadolibre');
        sendResults(normalizedProducts);
        
    } catch (error) {
        console.error('Error scraping MercadoLibre:', error);
        sendError(error.message);
    }
}

// Scrapear una página de Falabella
async function scrapeFalabellaPage() {
    const products = [];
    
    try {
        // Selectores para Falabella Perú
        const productSelectors = [
            'div.pod',
            'div.search-results > div',
            'div[data-pod]',
            'section[data-testid="search-results"] > div',
            'div.pod-container'
        ];
        
        let productElements = [];
        for (const selector of productSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                productElements = elements;
                console.log(`Usando selector: ${selector} (${elements.length} elementos)`);
                break;
            }
        }
        
        if (productElements.length === 0) {
            console.warn('No se encontraron productos en la página');
            return products;
        }
        
        // Procesar cada producto
        productElements.forEach((element, index) => {
            try {
                const product = extractFalabellaProduct(element, index);
                if (product) {
                    products.push(product);
                }
            } catch (error) {
                console.warn(`Error procesando producto ${index}:`, error);
            }
        });
        
    } catch (error) {
        console.error('Error scrapeando página de Falabella:', error);
    }
    
    return products;
}

// Extraer producto de Falabella
function extractFalabellaProduct(element, position) {
    // Buscar título
    const titleSelectors = [
        'b.pod-subTitle',
        'div.pod-title',
        'h3[data-testid="product-title"]',
        'a[data-testid="product-link"]',
        '.pod-title'
    ];
    
    let title = '';
    let url = '';
    
    for (const selector of titleSelectors) {
        const titleElement = element.querySelector(selector);
        if (titleElement) {
            title = titleElement.textContent?.trim() || '';
            
            // Obtener URL del enlace
            const linkElement = titleElement.closest('a') || element.querySelector('a');
            if (linkElement && linkElement.href) {
                url = linkElement.href;
            }
            break;
        }
    }
    
    // Buscar precio
    const priceSelectors = [
        'li.price-0 span',
        'span[data-testid="price"]',
        'div.prices span',
        'span.copy10',
        '.pod-prices .price'
    ];
    
    let priceText = '';
    let price = null;
    
    for (const selector of priceSelectors) {
        const priceElement = element.querySelector(selector);
        if (priceElement) {
            priceText = priceElement.textContent?.trim() || '';
            price = extractPrice(priceText);
            if (price) break;
        }
    }
    
    // Buscar marca/seller (opcional)
    const brandSelectors = [
        'span.pod-subTitle-2',
        'div.brand',
        'span[data-testid="brand"]',
        '.pod-subTitle-2'
    ];
    
    let brand = null;
    for (const selector of brandSelectors) {
        const brandElement = element.querySelector(selector);
        if (brandElement) {
            brand = brandElement.textContent?.trim();
            break;
        }
    }
    
    // Validar que tenga información mínima
    if (!title || !price) {
        return null;
    }
    
    return {
        position: position + 1,
        title: title,
        priceText: priceText,
        price: price,
        url: url,
        brand: brand,
        seller: null,
        site: 'falabella',
        keyword: scrapingState.keyword,
        timestamp: new Date().toISOString()
    };
}

// Scrapear una página de MercadoLibre
async function scrapeMercadoLibrePage() {
    const products = [];
    
    try {
        // Selectores para MercadoLibre Perú
        const productSelectors = [
            'li.ui-search-layout__item',
            'div.ui-search-result',
            'ol.ui-search-layout > li',
            'section[data-testid="results-section"] > div',
            '.ui-search-result'
        ];
        
        let productElements = [];
        for (const selector of productSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                productElements = elements;
                console.log(`Usando selector: ${selector} (${elements.length} elementos)`);
                break;
            }
        }
        
        if (productElements.length === 0) {
            console.warn('No se encontraron productos en la página');
            return products;
        }
        
        productElements.forEach((element, index) => {
            try {
                const product = extractMercadoLibreProduct(element, index);
                if (product) {
                    products.push(product);
                }
            } catch (error) {
                console.warn(`Error procesando producto ${index}:`, error);
            }
        });
        
    } catch (error) {
        console.error('Error scrapeando página de MercadoLibre:', error);
    }
    
    return products;
}

// Extraer producto de MercadoLibre
function extractMercadoLibreProduct(element, position) {
    // Título
    const titleSelectors = [
        'h2.ui-search-item__title',
        'a.ui-search-item__group__element',
        'div.ui-search-result__content-wrapper h2',
        '.ui-search-item__title'
    ];
    
    let title = '';
    let url = '';
    
    for (const selector of titleSelectors) {
        const titleElement = element.querySelector(selector);
        if (titleElement) {
            title = titleElement.textContent?.trim() || '';
            
            const linkElement = titleElement.closest('a') || element.querySelector('a.ui-search-link');
            if (linkElement && linkElement.href) {
                url = linkElement.href;
            }
            break;
        }
    }
    
    // Precio
    const priceSelectors = [
        'span.price-tag-fraction',
        'span.andes-money-amount__fraction',
        'div.ui-search-price__second-line span',
        '.ui-search-price__second-line .price-tag-fraction'
    ];
    
    let priceText = '';
    let price = null;
    
    for (const selector of priceSelectors) {
        const priceElement = element.querySelector(selector);
        if (priceElement) {
            priceText = priceElement.textContent?.trim() || '';
            price = extractPrice(priceText);
            if (price) break;
        }
    }
    
    // Seller/Marca
    const sellerSelectors = [
        'span.ui-search-official-store-label',
        'p.ui-search-official-store-label',
        'span.ui-search-item__group__element.ui-search-link__title',
        '.ui-search-official-store-label'
    ];
    
    let seller = null;
    for (const selector of sellerSelectors) {
        const sellerElement = element.querySelector(selector);
        if (sellerElement) {
            seller = sellerElement.textContent?.trim();
            break;
        }
    }
    
    // Validar
    if (!title || !price) {
        return null;
    }
    
    return {
        position: position + 1,
        title: title,
        priceText: priceText,
        price: price,
        url: url,
        brand: null,
        seller: seller,
        site: 'mercadolibre',
        keyword: scrapingState.keyword,
        timestamp: new Date().toISOString()
    };
}

// Ir a siguiente página (Falabella)
async function goToNextPageFalabella() {
    try {
        // Buscar botón de siguiente página
        const nextButtonSelectors = [
            'a[title="Siguiente"]',
            'button[aria-label="Siguiente"]',
            'li.pagination-next a',
            'a.pagination-next',
            '.pagination-next'
        ];
        
        let nextButton = null;
        for (const selector of nextButtonSelectors) {
            const button = document.querySelector(selector);
            if (button) {
                nextButton = button;
                break;
            }
        }
        
        if (!nextButton) {
            console.log('No hay más páginas en Falabella');
            return false;
        }
        
        // Hacer clic en el botón
        nextButton.click();
        return true;
        
    } catch (error) {
        console.error('Error yendo a siguiente página (Falabella):', error);
        return false;
    }
}

// Ir a siguiente página (MercadoLibre)
async function goToNextPageMercadoLibre() {
    try {
        const nextButtonSelectors = [
            'a[title="Siguiente"]',
            'li.andes-pagination__button--next a',
            'span.andes-pagination__arrow--next',
            '.andes-pagination__button--next a'
        ];
        
        let nextButton = null;
        for (const selector of nextButtonSelectors) {
            const button = document.querySelector(selector);
            if (button) {
                nextButton = button;
                break;
            }
        }
        
        if (!nextButton) {
            console.log('No hay más páginas en MercadoLibre');
            return false;
        }
        
        nextButton.click();
        return true;
        
    } catch (error) {
        console.error('Error yendo a siguiente página (MercadoLibre):', error);
        return false;
    }
}

// Normalizar productos
function normalizeProducts(products, site) {
    return products.map((product, index) => ({
        site: site,
        keyword: scrapingState.keyword,
        timestamp: new Date().toISOString(),
        position: index + 1,
        title: product.title || '',
        priceText: product.priceText || '',
        price: product.price,
        url: product.url || '',
        brand: product.brand || null,
        seller: product.seller || null,
        originalIndex: product.position || index + 1
    })).filter(p => p.title && p.price); // Filtrar productos válidos
}

// Extraer precio numérico (adaptado para soles peruanos)
function extractPrice(priceText) {
    if (!priceText) return null;
    
    try {
        // Eliminar caracteres no numéricos excepto puntos, comas y el símbolo de soles S/.
        const cleanText = priceText.replace(/[^\d.,S\/]/g, '');
        
        // Encontrar los números (pueden estar separados por comas o puntos)
        const matches = cleanText.match(/(\d[\d.,]*)/);
        if (!matches) return null;
        
        let numberStr = matches[0];
        
        // Si tiene punto como separador de miles y coma decimal, limpiar
        // Asumimos que el punto es separador de miles y la coma decimal
        if (numberStr.includes('.') && numberStr.includes(',')) {
            numberStr = numberStr.replace(/\./g, '').replace(',', '.');
        } 
        // Si solo tiene comas, podrían ser decimales o separadores de miles
        else if (numberStr.includes(',') && !numberStr.includes('.')) {
            // Si hay más de una coma, asumir que son separadores de miles
            const commaCount = (numberStr.match(/,/g) || []).length;
            if (commaCount > 1) {
                numberStr = numberStr.replace(/,/g, '');
            } else {
                // Solo una coma, asumir que es decimal
                numberStr = numberStr.replace(',', '.');
            }
        }
        // Si solo tiene puntos, asumir que son separadores de miles
        else if (numberStr.includes('.') && !numberStr.includes(',')) {
            const dotCount = (numberStr.match(/\./g) || []).length;
            if (dotCount > 1) {
                numberStr = numberStr.replace(/\./g, '');
            }
            // Si solo tiene un punto, podría ser decimal, pero en Perú no se usa punto decimal
        }
        
        // Convertir a número
        const price = parseFloat(numberStr);
        
        // Validar
        if (isNaN(price) || price <= 0) {
            return null;
        }
        
        return Math.round(price);
    } catch (error) {
        console.warn('Error extrayendo precio:', error, 'Texto:', priceText);
        return null;
    }
}

// Cancelar scraping
function cancelScrapingProcess() {
    if (scrapingState.progressInterval) {
        clearInterval(scrapingState.progressInterval);
    }
    
    scrapingState.isActive = false;
    
    // Enviar mensaje de cancelación
    port.postMessage({
        type: 'cancelled',
        keyword: scrapingState.keyword,
        site: scrapingState.site,
        timestamp: new Date().toISOString()
    });
    
    console.log('⏹️ Scraping cancelado por el usuario');
}

// Enviar progreso
function sendProgress(count) {
    port.postMessage({
        type: 'progress',
        keyword: scrapingState.keyword,
        site: scrapingState.site,
        count: count,
        timestamp: new Date().toISOString()
    });
}

// Enviar resultados
function sendResults(products) {
    port.postMessage({
        type: 'result',
        keyword: scrapingState.keyword,
        site: scrapingState.site,
        data: products,
        count: products.length,
        timestamp: new Date().toISOString()
    });
    
    scrapingState.isActive = false;
    console.log(`✅ Scraping completado: ${products.length} productos`);
}

// Enviar error
function sendError(errorMessage) {
    port.postMessage({
        type: 'error',
        keyword: scrapingState.keyword,
        site: scrapingState.site,
        error: errorMessage,
        timestamp: new Date().toISOString()
    });
    
    scrapingState.isActive = false;
}

// Funciones auxiliares
function waitForPageLoad() {
    return new Promise((resolve) => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve, { once: true });
        }
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Manejar mensajes directos (backup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startScraping') {
        startScrapingProcess(message.keyword, message.site);
        sendResponse({ started: true });
    } else if (message.action === 'cancelScraping') {
        cancelScrapingProcess();
        sendResponse({ cancelled: true });
    }
    return true;
});

console.log('👁️ Content script listo para scraping');