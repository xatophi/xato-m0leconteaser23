const puppeteer = require('puppeteer')

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password'
const CHALL_URL = process.env.CHALL_URL || 'http://app:3000'


async function visit(request_ids) {
    const browser = await puppeteer.launch({
        args: [
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--no-sandbox',
            '--safebrowsing-disable-auto-update'
        ]
    })

    try {
        let page = await browser.newPage()

        //login
        await page.goto(CHALL_URL + '/login')

        await page.waitForSelector('#username')
        await page.focus('#username')
        await page.keyboard.type('admin')
        await page.focus('#password')
        await page.keyboard.type(ADMIN_PASSWORD)

        await Promise.all([
            page.waitForNavigation({timeout: 500}),
            page.click('#submit',{timeout: 500})
        ])  

        for (const rid of request_ids){
            const url = CHALL_URL + '/check-request?id=' + rid 

            //console.log(url)

            try {
                await page.goto(url, {timeout: 1000});
                await page.waitForSelector('#deny',{timeout: 1000})
                await Promise.all([
                    page.waitForNavigation({timeout: 500}),
                    page.click(Math.random() > 0.3 ? '#deny' : '#accept',{timeout: 500})
                ])  
            } catch (error) {
                console.error(error)
            }

        }

        // close browser
        await page.close()
        await browser.close()
    } catch (e) {
        console.error(e)
        await browser.close()
        //throw (e)
    }

}

module.exports = { visit }
