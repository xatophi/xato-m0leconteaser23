const express = require('express')
const bot = require('./bot')
const fetch = require('node-fetch')

const {Semaphore} = require('async-mutex');

const BOT_SECRET = process.env.BOT_SECRET || 'changeme'
const MAX_PARALLEL_BOT = parseInt(process.env.MAX_PARALLEL_BOT) || 4
const CHALL_URL = process.env.CHALL_URL || 'http://app:3000'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password'

const semaphore = new Semaphore(MAX_PARALLEL_BOT);

const app = express()
app.use(express.json());

const MAX_QUEUE = 5
let inqueue = 0

app.post('/visit', async function (req, res) {
    
    if (req.body.secret !== BOT_SECRET){
        return res.status(500).json({ success: false, msg: 'bad secret' })
    }

    const id_user = req.body.id_user;
    if (typeof id_user === 'string' && /[a-f0-9\-]+/.test(id_user)) {
        try {
            if (inqueue > (MAX_QUEUE + MAX_PARALLEL_BOT)){
                console.error('Too many requests')
                return res.status(500).json({ success: false, msg: 'Too many requests to the bot, please retry later. If the problem persists contact an admin' });
            }

            inqueue ++
            console.log('QUEUE: ' + inqueue)
            console.log('Visiting requests for user: ' + id_user)
            
            semaphore.runExclusive(async ()=>{
                try { 
                    const tocheck = await (await fetch(CHALL_URL + '/to-check?password=' + ADMIN_PASSWORD + '&id_user=' + id_user)).json()
                    console.log(tocheck)
                
                    if (tocheck.length > 0){
                        await bot.visit(tocheck)
                    }
                } catch (e) {
                    console.error(e)
                }
                inqueue -- 
                console.log('QUEUE: ' + inqueue)
            })

            return res.json({ success: true, msg: 'A bot will visit your requests' });
        } catch (e) {
            console.log(e);
            return res.status(500).json({ success: false, msg: 'failed' });
        }
    }
    res.status(400).json({ success: false, msg: 'bad url' });
})


app.listen(9999, '0.0.0.0');
