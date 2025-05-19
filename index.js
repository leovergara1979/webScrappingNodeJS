import puppeteer from "puppeteer";
import sql from 'mssql';

// ********************************************************************************
// CONFIGURACIÓN DE LA BASE DE DATOS (¡ACTUALIZA ESTOS VALORES!)
// ********************************************************************************
const dbConfig = {
    user: 'sa', // Reemplaza con tu usuario de SQL Server
    password: '1287', // Reemplaza con tu contraseña
    server: 'DESKTOP-DI89Q46', // Reemplaza con el nombre de tu servidor SQL (ej: 'localhost', 'NOMBRESERVIDOR\\SQLEXPRESS')
    database: 'OneFootballScraperDB',
    options: {
        encrypt: false, // Usar true si te conectas a Azure SQL Database
        trustServerCertificate: true // Cambiar a false en producción si tienes un certificado válido
    }
};

// ********************************************************************************
// FUNCIÓN DE SCRAPING (MODIFICADA PARA ACEPTAR ID Y DEVOLVER DATOS)
// ********************************************************************************
async function scrapePartido(idPartidoOneFootball) {
    console.log(`Iniciando scraping para el partido ID: ${idPartidoOneFootball}`);
    const navegador = await puppeteer.launch({
        // headless: 'new', // Recomendado para ejecución desatendida
        // slowMo : 200, // Descomentar para depuración visual lenta
    });
    const pagina = await navegador.newPage();
    try {
        await pagina.goto(`https://onefootball.com/es/partido/${idPartidoOneFootball}`);

        try {
            const element = await pagina.waitForSelector('#onetrust-accept-btn-handler', { timeout: 10000 });
            await element.click();
            console.log(`[${idPartidoOneFootball}] Banner de cookies aceptado.`);
        } catch (error) {
            console.log(`[${idPartidoOneFootball}] No se encontró el banner de cookies o ya fue aceptado.`);
        }

        const result = await pagina.evaluate(() => {
            let golesElement = document.querySelector('.MatchScore_scores__Hnn5f');
            let infoElement = document.querySelector('.MatchScore_data__ahxqz');

            let goles = golesElement ? golesElement.innerText : null; // Devolver null si no se encuentra
            let info = infoElement ? infoElement.innerText : null;   // Devolver null si no se encuentra

            return {
                golesRaw: goles, // Usamos replace más adelante
                infoRaw: info,
            };
        });
        console.log(`[${idPartidoOneFootball}] Datos crudos extraídos:`, result);
        return result;

    } catch (error) {
        console.error(`[${idPartidoOneFootball}] Error durante el scraping:`, error);
        return null; // Indicar fallo en el scraping
    } finally {
        await navegador.close();
        console.log(`[${idPartidoOneFootball}] Navegador cerrado.`);
    }
}

// ********************************************************************************
// FUNCIONES AUXILIARES PARA PARSEAR DATOS
// ********************************************************************************
function parseResultados(datosCrudos) {
    if (!datosCrudos) return null;

    let golesEquipoA = null;
    let golesEquipoB = null;
    if (datosCrudos.golesRaw) {
        const marcador = datosCrudos.golesRaw.replace('\n:\n', '-');
        const partesMarcador = marcador.split('-');
        if (partesMarcador.length === 2) {
            golesEquipoA = parseInt(partesMarcador[0].trim(), 10);
            golesEquipoB = parseInt(partesMarcador[1].trim(), 10);
            // Validar que sean números
            if (isNaN(golesEquipoA)) golesEquipoA = null;
            if (isNaN(golesEquipoB)) golesEquipoB = null;
        }
    }

    let estadoPartido = null;
    let detallePrincipalInfo = null;
    let detalleSecundarioInfo = null;
    if (datosCrudos.infoRaw) {
        const infoOriginal = datosCrudos.infoRaw.trim();
        if (infoOriginal.includes('|')) {
            const partesInfo = infoOriginal.split('|').map(p => p.trim());
            detallePrincipalInfo = partesInfo[0] || null;
            detalleSecundarioInfo = partesInfo[1] || null;
        } else {
            // Asumimos que si no hay '|', es el estado del partido o un detalle único
            // Podríamos tener una lista de estados conocidos: 'FINALIZADO', 'EN JUEGO', etc.
            if (['FINALIZADO', 'EN JUEGO', 'SUSPENDIDO', 'POSPUESTO', 'APLAZADO'].includes(infoOriginal.toUpperCase())) {
                estadoPartido = infoOriginal;
            } else {
                detallePrincipalInfo = infoOriginal; // O manejarlo como se prefiera
            }
        }
    }

    return {
        goles_equipo_A: golesEquipoA,
        goles_equipo_B: golesEquipoB,
        estado_partido: estadoPartido,
        detalle_principal_info: detallePrincipalInfo,
        detalle_secundario_info: detalleSecundarioInfo,
        info_completa_original: datosCrudos.infoRaw,
        json_completo_respuesta: JSON.stringify(datosCrudos) // Guardamos los datos crudos también
    };
}

// ********************************************************************************
// FUNCIÓN PRINCIPAL DEL PROCESO
// ********************************************************************************
async function procesarPartidos() {
    let pool;
    try {
        console.log('Conectando a la base de datos...');
        pool = await sql.connect(dbConfig);
        console.log('Conexión exitosa.');

        const queryPartidosPendientes = `
            SELECT id_partido_onefootball, intentos_scraping 
            FROM PartidosParaScrapear 
            WHERE estado = 'pendiente' OR (estado = 'error_scraping' AND intentos_scraping < 3)
            ORDER BY fecha_creacion;
        `;
        const resultPartidos = await pool.request().query(queryPartidosPendientes);
        const partidosParaProcesar = resultPartidos.recordset;

        if (partidosParaProcesar.length === 0) {
            console.log('No hay partidos pendientes para procesar.');
            return;
        }

        console.log(`Se encontraron ${partidosParaProcesar.length} partidos para procesar.`);

        for (const partido of partidosParaProcesar) {
            const idActual = partido.id_partido_onefootball;
            const currentIntentos = partido.intentos_scraping;
            console.log(`--- Procesando Partido ID: ${idActual} (Intento: ${currentIntentos + 1}) ---`);
            
            await pool.request()
                .input('id', sql.BigInt, idActual)
                .input('intentos', sql.Int, currentIntentos + 1)
                .query(`UPDATE PartidosParaScrapear 
                        SET estado = 'procesando', intentos_scraping = @intentos, fecha_ultimo_intento = GETDATE() 
                        WHERE id_partido_onefootball = @id;`);

            const datosScrapeadosCrudos = await scrapePartido(idActual);

            if (datosScrapeadosCrudos && datosScrapeadosCrudos.infoRaw) {
                const datosParseados = parseResultados(datosScrapeadosCrudos); // Parsear siempre que haya datos crudos

                // Verificar si el registro ya existe en ResultadosScrapeados
                const checkExistingQuery = `SELECT 1 FROM ResultadosScrapeados WHERE id_partido_onefootball = @id_partido;`;
                const existingResult = await pool.request().input('id_partido', sql.BigInt, idActual).query(checkExistingQuery);
                const recordExists = existingResult.recordset.length > 0;

                if (recordExists) {
                    // Actualizar registro existente
                    const updateQuery = `
                        UPDATE ResultadosScrapeados 
                        SET goles_equipo_A = @golesA, goles_equipo_B = @golesB, estado_partido = @estadoP, 
                            detalle_principal_info = @detalleP, detalle_secundario_info = @detalleS, 
                            info_completa_original = @infoOriginal, json_completo_respuesta = @jsonFull, 
                            fecha_scrapeo = GETDATE()
                        WHERE id_partido_onefootball = @id_partido;
                    `;
                    await pool.request()
                        .input('id_partido', sql.BigInt, idActual)
                        .input('golesA', sql.Int, datosParseados.goles_equipo_A)
                        .input('golesB', sql.Int, datosParseados.goles_equipo_B)
                        .input('estadoP', sql.NVarChar, datosParseados.estado_partido)
                        .input('detalleP', sql.NVarChar, datosParseados.detalle_principal_info)
                        .input('detalleS', sql.NVarChar, datosParseados.detalle_secundario_info)
                        .input('infoOriginal', sql.NVarChar, datosParseados.info_completa_original)
                        .input('jsonFull', sql.NVarChar, datosParseados.json_completo_respuesta)
                        .query(updateQuery);
                    console.log(`[${idActual}] Resultados actualizados en la base de datos.`);
                } else {
                    // Insertar nuevo registro
                    const insertQuery = `
                        INSERT INTO ResultadosScrapeados 
                            (id_partido_onefootball, goles_equipo_A, goles_equipo_B, estado_partido, detalle_principal_info, detalle_secundario_info, info_completa_original, json_completo_respuesta, fecha_scrapeo)
                        VALUES 
                            (@id_partido, @golesA, @golesB, @estadoP, @detalleP, @detalleS, @infoOriginal, @jsonFull, GETDATE());
                    `;
                    await pool.request()
                        .input('id_partido', sql.BigInt, idActual)
                        .input('golesA', sql.Int, datosParseados.goles_equipo_A)
                        .input('golesB', sql.Int, datosParseados.goles_equipo_B)
                        .input('estadoP', sql.NVarChar, datosParseados.estado_partido)
                        .input('detalleP', sql.NVarChar, datosParseados.detalle_principal_info)
                        .input('detalleS', sql.NVarChar, datosParseados.detalle_secundario_info)
                        .input('infoOriginal', sql.NVarChar, datosParseados.info_completa_original)
                        .input('jsonFull', sql.NVarChar, datosParseados.json_completo_respuesta)
                        .query(insertQuery);
                    console.log(`[${idActual}] Resultados nuevos guardados en la base de datos.`);
                }

                // Ahora determinar si el partido ha finalizado para actualizar PartidosParaScrapear
                const infoLower = datosScrapeadosCrudos.infoRaw.toLowerCase();
                if (infoLower.includes("fin del partido")) {
                    await pool.request()
                        .input('id', sql.BigInt, idActual)
                        .query(`UPDATE PartidosParaScrapear SET estado = 'procesado', fecha_ultimo_intento = GETDATE() WHERE id_partido_onefootball = @id;`);
                    console.log(`[${idActual}] Estado actualizado a 'procesado' (Partido finalizado).`);
                } else {
                    console.log(`[${idActual}] El partido no indica 'Fin del partido' en infoRaw (infoRaw: "${datosScrapeadosCrudos.infoRaw}"). Se reintentará.`);
                    await pool.request()
                        .input('id', sql.BigInt, idActual)
                        .query(`UPDATE PartidosParaScrapear SET estado = 'pendiente', fecha_ultimo_intento = GETDATE() WHERE id_partido_onefootball = @id;`);
                    console.log(`[${idActual}] Estado establecido a 'pendiente' para reintento.`);
                }
            } else if (datosScrapeadosCrudos && !datosScrapeadosCrudos.infoRaw && datosScrapeadosCrudos.golesRaw) {
                 console.log(`[${idActual}] Se obtuvieron goles pero no información de estado (infoRaw es nulo/vacío). Marcando para reintento.`);
                 await pool.request()
                    .input('id', sql.BigInt, idActual)
                    .query(`UPDATE PartidosParaScrapear SET estado = 'pendiente', fecha_ultimo_intento = GETDATE() WHERE id_partido_onefootball = @id;`);
                 console.log(`[${idActual}] Estado establecido a 'pendiente' para reintento debido a falta de infoRaw.`);
            } else {
                console.error(`[${idActual}] No se pudieron obtener datos del scraping o los datos crudos fueron nulos.`);
                await pool.request()
                    .input('id', sql.BigInt, idActual)
                    .query(`UPDATE PartidosParaScrapear SET estado = 'error_scraping', fecha_ultimo_intento = GETDATE() WHERE id_partido_onefootball = @id;`);
                console.log(`[${idActual}] Estado actualizado a 'error_scraping'.`);
            }
            console.log(`--- Fin del procesamiento para Partido ID: ${idActual} ---\n`);
        }

    } catch (err) {
        console.error('Error en el proceso principal:', err);
    } finally {
        if (pool) {
            try {
                await pool.close();
                console.log('Conexión a la base de datos cerrada.');
            } catch (err) {
                console.error('Error cerrando la conexión a la base de datos:', err);
            }
        }
    }
}

// Ejecutar la función principal
procesarPartidos();
