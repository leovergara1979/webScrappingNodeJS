import puppeteer from "puppeteer";
import fs from 'fs/promises';

( async () => {
        const navegador = await puppeteer.launch({
             headless: false, //'new',
             slowMo : 300,
             //
        })
        const pagina = await navegador.newPage()
        await pagina.goto('https://onefootball.com/es/partido/2404687')
        // await pagina.click('#onetrust-accept-btn-handler')
        // await new Promise((resolve) => setTimeout(resolve, 3000));
        
        
        const result = await pagina.evaluate(() => {
           let goles =  document.querySelector('.MatchScore_data__ahxqz').innerText

           
           return {

            goles,
            }
        })

        console.log(result)

        await fs.writeFile('salida.json', JSON.stringify(result, null, 2))
        await navegador.close()
    })()        

    
