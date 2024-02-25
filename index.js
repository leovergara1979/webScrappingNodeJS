 import puppeteer from "puppeteer";
import fs from 'fs/promises';

( async () => {
        const navegador = await puppeteer.launch({
             //headless: false, //'new',
             slowMo : 200,
             //
        })
        const pagina = await navegador.newPage()
        await pagina.goto('https://onefootball.com/es/partido/2404687')
        await pagina.screenshot({path: 'capturaPantalla.png'});

        const result = await pagina.evaluate(() => {
           let goles =  document.querySelector('.MatchScore_data__ahxqz').innerText

           
           return {

            goles : goles.toString().replace('\n:\n', '-'), 

            }
        })

        console.log(result)

        await fs.writeFile('salida.json', JSON.stringify(result, null, 2))
        await navegador.close()
    })()        

    
