const express = require('express')
const jwt = require('jsonwebtoken')
const fs = require('fs')
const cookieParser = require('cookie-parser')
const bcrypt = require('bcrypt')
const uuid = require('lil-uuid')
const fetch = require('node-fetch')
const multer  = require('multer')
const upload = multer({});
require('express-async-errors')

const knex = require('knex')({
    client: 'better-sqlite3',
    connection: {
      filename: ":memory:",
    },
    useNullAsDefault: true,
});  

const FLAG = process.env.FLAG || 'ptm{test}'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password'
const SECRET_KEY = process.env.SECRET_KEY || uuid()
const CACHE_HOSTNAME = process.env.CACHE_HOSTNAME || 'localhost'
const BOT_URL = process.env.BOT_URL || 'http://bot:9999/visit'
const BOT_SECRET = process.env.BOT_SECRET || 'http://bot:9999/visit'

const app = express()
const port = 3000

app.set('view engine', 'ejs');

const Memcached = require('memcached-promise');
const memcached = new Memcached(CACHE_HOSTNAME + ':11211');

const Tokens = require('csrf')
const csrf = new Tokens()

app.use(express.static('public'))
app.use(cookieParser())
app.use(express.urlencoded({extended: false}))  
app.use(upload.single('file'))  

app.use((req,res,next)=>{
    res.locals.errormsg = undefined
    res.locals.successmsg = undefined
    next()
})

async function get_template(user, id){
    return await memcached.get( 'template_' + user + '_' + id )
}

async function get_ntemplates(user){
    const n = await memcached.get( 'ntemplates_' + user )
    if (n === undefined){
        return 0
    }
    return parseInt(n)
}

async function set_template(user, id, value){
    await memcached.set( 'template_' + user + '_' + id, value, 0 )
    await memcached.set( 'ntemplates_' + user , id + 1, 0 )
}

async function get_printed(user, id_template, id_print){
    return await memcached.get( 'printed_' + user + '_' + id_template + '_' + id_print )
}

async function set_printed(user, id_template, id_print, value){
    await memcached.set( 'printed_' + user + '_' + id_template + '_' + id_print, value, 0 )
}

app.use(async (req, res, next)=> {
    res.locals.loggedUserId = undefined
    res.locals.loggedUser = undefined
    res.locals.isPremium = false
    
    try {
        const decoded = jwt.verify(req.cookies.session, SECRET_KEY)
        
        let r = await knex.select('username').from('users').where('id_user','=',decoded.user).first()
        if (r){
            res.locals.loggedUserId = decoded.user
            res.locals.loggedUser = r.username
            if (r.username === 'admin'){
                res.locals.isPremium = true
            }
        }
        

        // Let's just be safe for the moment, the admin went crazy...

        /* 
        r = await knex('premium').where({id_user: decoded.user, result: 1}).count()
        if (r[0]['count(*)'] >= 1){
            res.locals.isPremium = true
        }
        */
    } catch {

    }
    next()
})


app.get('/login', async (req, res)=>{
    res.render('login')
})

app.post('/login', async (req, res) => {

    const r = await knex.select('id_user','password').from('users').where('username','=',req.body.username).first()

    if (!r){
        res.locals.errormsg = 'Bad credentials'
        return res.render('login')
    }
    if (!bcrypt.compareSync(req.body.password, r.password)){
        res.locals.errormsg = 'Bad credentials'
        return res.render('login')
    } 
    
    const token = jwt.sign({ user: r.id_user }, SECRET_KEY);
    res.cookie('session', token)

    return res.redirect('/')
})

app.get('/register', (req, res)=>{
    res.render('register')
})

app.post('/register', async (req, res) => {

    try {
        await knex('users').insert({id_user: uuid(), username: req.body.username, password: bcrypt.hashSync(req.body.password,10)})
    } catch (e){
        console.error(e)
        res.locals.errormsg = 'User already exists'
        return res.render('register') 
    }

    res.locals.successmsg = 'Registered!'
    return res.render('register') 
})

app.get('/', (req, res) => {

    const csrfsecret = csrf.secretSync()
    res.cookie('csrf', btoa(csrfsecret))

    return res.render('index', {flag: FLAG})

})

app.get('/to-check', async (req,res)=>{

    const {password, id_user} = req.query
    if (!id_user || password !== ADMIN_PASSWORD){
        return res.json([])
    }

    const r = await knex('premium').select('id_request').where({checked: false, id_user})
    await knex('premium').update({checked: true}).where({checked: false, id_user})
    
    return res.json(r.map(x=>x.id_request))
})

// only logged users in next endpoints and check csrf
app.use((req,res,next)=>{
    if (!res.locals.loggedUser){
        return res.status(403).send('Forbidden')
    }

    const csrfsecret = atob(req.cookies.csrf)
    res.locals.csrftoken = csrf.create(csrfsecret)

    if (req.method === 'POST'){
        if (!csrf.verify(csrfsecret, req.body.csrf) ){
            return res.send('Bad csrf')
        }
    }

    next()
})

app.get('/get-templates', (req,res)=>{
    template_names = fs.readdirSync(__dirname + '/public/templates')
    return res.render('get_templates', {template_names})
})

app.post('/get-templates', async (req,res)=>{
    let templates = req.body.templates
    if (!templates){
        return res.send('please, select a template')
    }

    if (!Array.isArray(templates)){
        if (typeof templates === 'string'){
            templates = [templates]
        } else {
            return res.status(400).send('bad request')
        }
    }

    //need to check the trial version limits
    if (templates.length > 1 && res.locals.isPremium !== true){
        res.locals.errormsg = 'Sorry, you can only import one template in the trial version'    
        return res.status(403).render('get_templates')
    }
    
    const regex_bad_filename = /\.\.|\//g

    for (let i=0; i<templates.length; i++){            
        const template = templates[i]
        if (regex_bad_filename.test(template) || !fs.existsSync(__dirname + '/public/templates/' + template)){
            res.locals.errormsg = 'Template not found'
        } else {
            const temp_text = fs.readFileSync(__dirname + '/public/templates/' + template, 'utf8')
            await set_template(res.locals.loggedUser, i, temp_text)
        }
    }
    if (!res.locals.errormsg){
        res.locals.successmsg = 'Imported successfully'
    }

    return res.render('get_templates')
})

app.post('/get-templates-url', async (req,res)=>{
    let {url} = req.body
    if (!url || typeof url !== 'string' || !url.startsWith('http')){
        return res.send('bad url')
    }

    const f_res = await fetch(url)
    if (f_res.status !== 200){
        res.locals.errormsg = 'Failed to fetch the template'
    } else {
        const temp_text = await f_res.text()
        await set_template(res.locals.loggedUser, 0, temp_text)
        res.locals.successmsg = 'Imported successfully'
    }  

    return res.render('get_templates')
})

app.get('/my-templates', async (req,res)=>{
    const n = await get_ntemplates(res.locals.loggedUser)
    let templates = []
    for (let i=0; i<n; i++){
        templates.push( (await get_template(res.locals.loggedUser,i) ))
    }
    return res.render('my_templates', {templates})
})


app.get('/my-templates/:id', async (req,res)=>{
    const regex_num = /^\d+$/g
    if (! regex_num.test(req.params.id)){
        return res.status(400).send('Invalid template id')
    }

    const template = (await get_template(res.locals.loggedUser,parseInt(req.params.id)) )

    if (!template){
        return res.status(404).send('Template not found')
    }
    
    return res.render('my_template', {template})
})

app.get('/print/:id', async (req,res)=>{
    const regex_num = /^\d+$/g
    if (! regex_num.test(req.params.id)){
        return res.status(400).send('Invalid template id')
    }

    const template = (await get_template(res.locals.loggedUser,parseInt(req.params.id)) )

    if (!template){
        return res.status(404).send('Template not found')
    }
    
    return res.render('print', {template})
})

app.post('/print/:id', async (req,res)=>{
    const regex_num = /^\d+$/g
    if (! regex_num.test(req.params.id)){
        return res.status(400).send('Invalid template id')
    }

    const tosub0 = req.body.tosub0
    const sub0 = req.body.sub0 ? (Array.isArray(req.body.sub0) ? req.body.sub0 : [req.body.sub0]) : []
    
    const tosub1 = req.body.tosub1
    const sub1 = req.body.sub1 ? (Array.isArray(req.body.sub1) ? req.body.sub1 : [req.body.sub1]) : []
    
    let template = (await get_template(res.locals.loggedUser,parseInt(req.params.id)) )

    if (!template){
        return res.status(404).send('Template not found')
    }

    let printid = 0
    for (let i=0; i<sub0.length; i++){

        const print_0 = template.split(tosub0).join(sub0[i])
        
        if(sub1.length > 0 && print_0.includes(tosub1)){
            for (let j=0; j<sub1.length; j++){
                const print_1 = print_0.split(tosub1).join(sub1[j])
                await set_printed(res.locals.loggedUser, req.params.id, printid, print_1)
                printid ++
            }
         } else {
            await set_printed(res.locals.loggedUser, req.params.id, printid, print_0)
            printid ++
        }
    }

    res.locals.successmsg = 'Printed!'
    return res.render('print', {template})
})

app.get('/view-print/:id', async (req,res)=>{
    const regex_num = /^\d+$/g
    if (! regex_num.test(req.params.id)){
        return res.status(400).send('Invalid template id')
    }
    
    return res.render('view_print',{templateid: req.params.id,  isPremium: res.locals.isPremium})
})

app.get('/printed/:idtemplate/:idprint', async (req,res)=>{
    
    const print = (await get_printed(res.locals.loggedUser,parseInt(req.params.idtemplate),parseInt(req.params.idprint)) )

    if (!print){
        return res.status(404).send('Print not found')
    }

    res.attachment('printedbyptm_' + req.params.idtemplate + '_' + req.params.idprint + '.txt');
    return res.send(print)
})

app.get('/view-print/:id', async (req,res)=>{
    const regex_num = /^\d+$/g
    if (! regex_num.test(req.params.id)){
        return res.status(400).send('Invalid template id')
    }

    const print = (await get_printed(res.locals.loggedUser,parseInt(req.params.idtemplate),parseInt(req.params.idprint)) )

    if (!print){
        return res.status(404).send('Print not found')
    }
    
    return res.render('printed_template',{print})
})

app.get('/my-account', async (req,res)=>{
    const premium_reqs = await knex.select().from('premium').where('id_user','=',res.locals.loggedUserId)
    return res.render('my_account',{premium_reqs})
})

app.get('/my-requests', async (req,res)=>{
    let r = await knex.select().from('premium').where('id_user','=',res.locals.loggedUserId)
    const premium_reqs = await Promise.all( r.map(async x=>{
        let y = {msg:'', result: x.result}

        try {
            const j = JSON.parse(await memcached.get( 'message_' + x.id_request))
            y.msg = j.msg
        } catch (error) {}

        return y
    }) )
    return res.render('my_requests',{premium_reqs})
})

app.post('/new-request', async (req,res)=>{

    if (! req.body.message || typeof req.body.message !== 'string'){
        res.locals.errormsg = 'Bad request'
        return res.status(400).render('my_account')        
    }
    if (! req.file){
        res.locals.errormsg = 'Select a file'
        return res.status(400).render('my_account')
    }
    
    const image = req.file.buffer.toString('base64');

    const id_request = uuid()
    await knex('premium').insert({id_user: res.locals.loggedUserId, id_request, result: 0, checked: false})
    await memcached.add( 'message_' + id_request , JSON.stringify({msg: req.body.message, img: image}), 0)

    res.locals.successmsg = 'Request created!'
    return res.render('my_account')
})


app.get('/review', async (req,res)=>{

    try {
        const bot_resp = await (await fetch(BOT_URL,{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                secret: BOT_SECRET,
                id_user: res.locals.loggedUserId
            })
        })).json()
        
        if (bot_resp.success){
            res.locals.successmsg = bot_resp.msg
        } else {
            res.locals.errormsg = bot_resp.msg
        }

    } catch (error) {
        console.error(error)
        res.locals.errormsg = 'Bot unreachable, contact an admin'
    }

    return res.render('header')
})

// admin reserved enpoints
app.use((req,res,next) => {
    if (res.locals.loggedUser !== 'admin'){
        return res.status(403).send('Sorry, this page is reserved to the admin')
    }
    next()
})


app.get('/check-request', async (req,res)=>{
    const id = req.query.id
    
    if (!id || typeof id !== 'string'){
        return res.status(400).send('Missing request id')
    }
    const x = await memcached.get( 'message_' + id)
    if (!x){
        return res.status(404).send('Request not found')
    }

    let request = JSON.parse(x)
    res.render('check_request', {request})
})

app.post('/check-request', async (req,res)=>{
    const id = req.query.id
    
    if (!id || typeof id !== 'string'){
        return res.status(400).send('Missing request id')
    }

    let r = await knex.select().from('premium').where('id_request','=',id).first()
    if (!r){
        return res.status(404).send('Request not found')
    }

    let result = -1
    if (req.body.accept === 'true'){
        result = 1
    }

    await knex('premium').where('id_request','=',id).update({result})
    
    res.send('Done')
})


;
  
(async () => {
    // create empty db
    await knex.schema.dropTableIfExists('users')

    await knex.schema.createTable('users', function (table) {
        table.string('id_user',40).primary()
        table.string('username',40).unique()
        table.string('password')
    })

    await knex('users').insert({id_user: uuid(), username: 'admin', password: bcrypt.hashSync(ADMIN_PASSWORD,10)})

    await knex.schema.createTable('premium', function (table) {
        table.string('id_request',40).primary()
        table.string('id_user',40)
        table.integer('result') // 0 : waiting , 1: approved , -1: rejected
        table.boolean('checked') 
    })

    // start the server
    app.listen(port, () => {
    console.log(`App listening on port ${port}`)
    })
    
})()