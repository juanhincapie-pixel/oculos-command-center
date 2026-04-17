/**
 * ÓCULOS COMMAND CENTER — Metabase → Google Sheets
 *
 * Este script extrae datos de Metabase (queries 9377 y 9309)
 * y los guarda en dos hojas de este Google Sheets.
 * Los dashboards leen directamente de aquí via URL pública.
 *
 * CONFIGURACIÓN:
 *   1. Crear un Google Sheets nuevo
 *   2. Ir a Extensiones > Apps Script
 *   3. Pegar este código completo
 *   4. Configurar las constantes abajo (METABASE_URL, API_KEY)
 *   5. Ejecutar setupTrigger() una vez para programar la ejecución diaria
 *   6. Ejecutar fetchAllData() manualmente la primera vez para verificar
 *   7. Publicar el Sheets: Archivo > Compartir > Publicar en la web (como JSON)
 */

// ==================== CONFIGURACIÓN ====================
const METABASE_URL = 'https://metabase.livocompany.com';
const API_KEY = 'mb_ezQmg2Ho6e9TCtITMK0wfPjWVcGccErTVn+cEmJ1GN0=';

const QUERIES = {
  sales: { id: '9377', sheetName: 'sales_data' },
  storeStock: { id: '9309', sheetName: 'store_stock_data' }
};

const META_SHEET_NAME = 'meta';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ==================== FUNCIONES PRINCIPALES ====================

/**
 * Función principal: extrae ambas queries y guarda en las hojas.
 * Esta es la que se ejecuta con el trigger diario.
 */
function fetchAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log('=== ÓCULOS: Inicio de extracción de datos ===');
  Logger.log('Fecha: ' + new Date().toISOString());

  let salesRows = 0;
  let stockRows = 0;

  try {
    // Extraer datos de ventas (query 9377)
    Logger.log('Extrayendo datos de ventas (query 9377)...');
    const salesData = fetchMetabaseQuery(QUERIES.sales.id);
    salesRows = salesData.length;
    Logger.log('Ventas: ' + salesRows + ' filas recibidas');
    writeDataToSheet(ss, QUERIES.sales.sheetName, salesData);

    // Extraer datos de stock por tienda (query 9309)
    Logger.log('Extrayendo datos de stock (query 9309)...');
    const stockData = fetchMetabaseQuery(QUERIES.storeStock.id);
    stockRows = stockData.length;
    Logger.log('Stock: ' + stockRows + ' filas recibidas');
    writeDataToSheet(ss, QUERIES.storeStock.sheetName, stockData);

    // Actualizar metadata
    updateMeta(ss, salesRows, stockRows);

    Logger.log('=== ÓCULOS: Extracción completada exitosamente ===');
    Logger.log('Ventas: ' + salesRows + ' filas | Stock: ' + stockRows + ' filas');

  } catch (error) {
    Logger.log('ERROR: ' + error.message);
    // Intentar guardar el error en meta
    try {
      updateMeta(ss, salesRows, stockRows, error.message);
    } catch(e) {}
    throw error;
  }
}

/**
 * Llama a la API de Metabase con reintentos.
 */
function fetchMetabaseQuery(questionId) {
  const url = METABASE_URL + '/api/card/' + questionId + '/query/json';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const options = {
        method: 'post',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({}),
        muteHttpExceptions: true,
        // Timeout de 120 segundos (Metabase puede ser lento)
        timeout: 120
      };

      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();

      if (code >= 200 && code < 300) {
        const data = JSON.parse(response.getContentText());
        return data;
      }

      if (code >= 500 && attempt < MAX_RETRIES) {
        Logger.log('  Query ' + questionId + ' intento ' + attempt + '/' + MAX_RETRIES + ': HTTP ' + code + ', reintentando...');
        Utilities.sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      throw new Error('HTTP ' + code + ': ' + response.getContentText().substring(0, 200));

    } catch (error) {
      if (attempt < MAX_RETRIES && error.message.indexOf('HTTP') === -1) {
        Logger.log('  Query ' + questionId + ' intento ' + attempt + '/' + MAX_RETRIES + ': ' + error.message + ', reintentando...');
        Utilities.sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw new Error('Error en query ' + questionId + ' después de ' + attempt + ' intentos: ' + error.message);
    }
  }
}

/**
 * Escribe un array de objetos JSON en una hoja de Google Sheets.
 * Crea la hoja si no existe. Borra el contenido anterior.
 */
function writeDataToSheet(ss, sheetName, data) {
  if (!data || data.length === 0) {
    Logger.log('  AVISO: Sin datos para ' + sheetName);
    return;
  }

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log('  Hoja "' + sheetName + '" creada');
  }

  // Limpiar hoja
  sheet.clear();

  // Headers: tomar las keys del primer objeto
  const headers = Object.keys(data[0]);

  // Construir la matriz de valores
  const rows = data.map(row => headers.map(h => {
    const val = row[h];
    // Convertir nulls a vacío para Sheets
    if (val === null || val === undefined) return '';
    return val;
  }));

  // Escribir headers + datos de una sola vez (mucho más rápido)
  const allData = [headers, ...rows];
  sheet.getRange(1, 1, allData.length, headers.length).setValues(allData);

  // Formato del header
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#217346');
  headerRange.setFontColor('#ffffff');

  // Congelar primera fila
  sheet.setFrozenRows(1);

  Logger.log('  Hoja "' + sheetName + '": ' + rows.length + ' filas escritas, ' + headers.length + ' columnas');
}

/**
 * Actualiza la hoja de metadata con fecha, conteos y estado.
 */
function updateMeta(ss, salesRows, stockRows, errorMsg) {
  let sheet = ss.getSheetByName(META_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(META_SHEET_NAME);
  }

  sheet.clear();

  const now = new Date();
  const metaData = [
    ['Campo', 'Valor'],
    ['lastUpdate', now.toISOString()],
    ['lastUpdateBRT', Utilities.formatDate(now, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss')],
    ['salesRows', salesRows],
    ['storeStockRows', stockRows],
    ['status', errorMsg ? 'ERROR' : 'OK'],
    ['error', errorMsg || '']
  ];

  sheet.getRange(1, 1, metaData.length, 2).setValues(metaData);

  const headerRange = sheet.getRange(1, 1, 1, 2);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1a2e');
  headerRange.setFontColor('#ffffff');

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 300);
}

// ==================== WEB APP (para que los dashboards lean) ====================

/**
 * Endpoint GET que devuelve los datos como JSON.
 * Después de publicar como Web App, los dashboards llaman a esta URL.
 *
 * Parámetros:
 *   ?sheet=sales_data         → devuelve datos de ventas
 *   ?sheet=store_stock_data   → devuelve datos de stock
 *   ?sheet=meta               → devuelve metadata
 *   ?sheet=all                → devuelve todo en un solo JSON
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestedSheet = (e && e.parameter && e.parameter.sheet) ? e.parameter.sheet : 'all';

  let result;

  if (requestedSheet === 'all') {
    // Devolver todo
    const salesData = sheetToJSON(ss, QUERIES.sales.sheetName);
    const stockData = sheetToJSON(ss, QUERIES.storeStock.sheetName);
    const meta = sheetToMeta(ss);

    result = {
      salesData: salesData,
      storeStockData: stockData,
      meta: meta
    };
  } else if (requestedSheet === 'meta') {
    result = sheetToMeta(ss);
  } else {
    result = sheetToJSON(ss, requestedSheet);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Convierte una hoja de Sheets a un array de objetos JSON.
 */
function sheetToJSON(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] === '' ? null : row[i];
    });
    return obj;
  });
}

/**
 * Lee la hoja meta y devuelve un objeto simple.
 */
function sheetToMeta(ss) {
  const sheet = ss.getSheetByName(META_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { lastUpdate: null };

  const data = sheet.getDataRange().getValues();
  const meta = {};
  // Saltar header row
  for (let i = 1; i < data.length; i++) {
    meta[data[i][0]] = data[i][1];
  }
  return meta;
}

// ==================== TRIGGERS ====================

/**
 * Ejecutar UNA VEZ para crear el trigger de ejecución diaria.
 * Se ejecutará a medianoche hora de São Paulo.
 */
function setupTrigger() {
  // Eliminar triggers anteriores de esta función
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'fetchAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Crear trigger diario a medianoche BRT
  ScriptApp.newTrigger('fetchAllData')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .inTimezone('America/Sao_Paulo')
    .create();

  Logger.log('Trigger creado: fetchAllData se ejecutará diariamente a medianoche (BRT)');
}

/**
 * Ejecutar para eliminar todos los triggers.
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  Logger.log('Todos los triggers eliminados');
}

// ==================== UTILIDADES ====================

/**
 * Función de test: verifica la conexión con Metabase.
 */
function testConnection() {
  Logger.log('Probando conexión con Metabase...');
  Logger.log('URL: ' + METABASE_URL);

  try {
    const response = UrlFetchApp.fetch(METABASE_URL + '/api/health', {
      muteHttpExceptions: true,
      timeout: 30
    });
    Logger.log('Health check: HTTP ' + response.getResponseCode());
    Logger.log('Respuesta: ' + response.getContentText().substring(0, 200));

    // Intentar una query pequeña
    Logger.log('Probando query de ventas (9377)...');
    const data = fetchMetabaseQuery(QUERIES.sales.id);
    Logger.log('OK: ' + data.length + ' filas recibidas');
    Logger.log('Columnas: ' + Object.keys(data[0]).join(', '));

  } catch (error) {
    Logger.log('ERROR: ' + error.message);
  }
}
