import puppeteer from "puppeteer";
import fs from 'fs/promises';




//*************************************************************solo marcador de goles********************************
const id = 2407192;
( async () => {
    const navegador = await puppeteer.launch({
         //headless: false, //'new',
         //slowMo : 200,
    })
    const pagina = await navegador.newPage()
    await pagina.goto(`https://onefootball.com/es/partido/${id}`)
    
    const element = await pagina.waitForSelector('#onetrust-accept-btn-handler'); 
    await element.click(); 
                           
    
    const result = await pagina.evaluate(() => {
        // let goles =  document.querySelector('.MatchScore_scores__Hnn5f').innerText
        
        let goles =  document.querySelector('.MatchScore_scores__Hnn5f').innerText  
        let info =  document.querySelector('.MatchScore_data__ahxqz').innerText  


        
        return {
            
            goles : goles.toString().replace('\n:\n', '-'), 
            info : info,
            
            
        }
    })
    
    console.log(result)
    
    await fs.writeFile('salida.json', JSON.stringify(result, null, 2))

    //await pagina.screenshot({path: 'capturaPantalla1.png'});
    setTimeout(function(){
        pagina.screenshot({path: 'capturaPantalla.png'});
    }, 1500);

    setTimeout(function(){
        navegador.close()
    }, 2000);
    
})() 





//*************************************************************old funcionando********************************

// ( async () => {
//         const navegador = await puppeteer.launch({
//              headless: false, //'new',
//              slowMo : 200,
//         })
//         const pagina = await navegador.newPage()
//         await pagina.goto('https://onefootball.com/es/partido/2424517')
        
//         //const element = await pagina.waitForSelector('#onetrust-accept-btn-handler');
//         //await element.click(); 
//         await pagina.click('#onetrust-accept-btn-handler')
        
//         const result = await pagina.evaluate(() => {
//             let goles =  document.querySelector('.MatchScore_data__ahxqz').innerText
            
//             return {
                
//                 goles : goles.toString().replace('\n:\n', '-'), 
                
                
//             }
//         })
        
//         console.log(result)
        
//         await fs.writeFile('salida.json', JSON.stringify(result, null, 2))
//         await pagina.screenshot({path: 'capturaPantalla.png'});
//         await navegador.close()
//     })()        

    
