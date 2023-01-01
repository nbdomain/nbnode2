/**
 * NBDomain HTTP server for 3rd party.
 */
var url = require('url');
const CONSTS = require('../../const')

var express = require('express');
var bodyParser = require("body-parser");
var cors = require('cors');
const { ERR } = require('../../def')
const { Util } = require('../../util.js')
const Path = require('path')

const { json } = require('body-parser');
const fs = require("fs-extra");
const axios = require('axios');
const Parser = require('../../parser')
const { Nodes } = require('../../nodes')
var app = express();
const { createSession } = require("better-sse");
const coinfly = require("coinfly");
const rateLimit = require('express-rate-limit')
let indexers = null, CONFIG = null;
const today = new Date();

const day = today.getDate();
const today_folder = day % 2 == 0 ? "even/" : "odd/";
const last_folder = day % 2 == 0 ? "odd/" : "even/";

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 60, // Limit each IP to 60 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));
app.use('/pubsub/pub/:topic/:msg', apiLimiter)
app.use('/notify', apiLimiter)

//获取访问ip
function getClientIp(req) {
    const IP =
        req.headers["x-forwarded-for"] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    return IP.split(",")[0];
}

app.get('/', async function (req, res, next) {

    let domain = req.query['nid'];
    let f = req.query['full'] === 'true';
    const price = req.query['price'] !== 'false';

    if (!domain) {
        res.json({ code: ERR.NOTFOUND, message: `nid missing!` });
        return;
    }
    try {
        const resolver = indexers.resolver
        if (!resolver) {
            throw "unsupported domain:" + domain
        }
        const ret = await resolver.readDomain({ fullDomain: domain, forceFull: f, price });
        if (ret.code === 0) {
            ret.chain = Util.getchain(domain)
        }
        res.json(ret);
    } catch (err) {
        console.error(err);
        res.json({ code: 99, message: err.message });
    }
});
async function getAllItems(para, forceFull = false, from = null, price = true) {
    //check ,
    let items = []
    const domains = para.split(',')

    domains.forEach(domain => {
        const his = domain.split('/') //check '/'
        if (his.length == 1) items.push(domain)
        else {
            const moreHis = his[1].split('-') //check '-'
            if (moreHis.length == 1) {
                if (his[1] == 'all') {
                    const resolver = indexers.resolver
                    if (!resolver) return
                    const count = resolver.getDomainHistoryLen(his[0])
                    for (let i = 1; i <= count; i++) {
                        items.push(his[0] + "/" + i)
                    }
                    items.push(his[0])
                } else items.push(domain)
            }
            else {
                for (let i = +moreHis[0]; i <= +moreHis[1]; i++) {
                    items.push(his[0] + "/" + i)
                }
            }
        }
    })
    let ret = []
    for (const item of items) {
        if (item === '') continue;
        const dd = item.split('/')
        const resolver = indexers.resolver
        if (!resolver) continue;
        const result = await resolver.readDomain({ fullDomain: dd[0], forceFull: forceFull, history: dd[1], price })
        if (!result) continue
        if (from && result.obj.ts <= from) continue
        ret.push(result)
    }
    return ret
}
app.get('/q/*', async function (req, res) {
    const para = req.params[0]
    const from = req.query['from']
    const price = req.query['price'] !== "false"
    const ret = await getAllItems(para, false, +from, price)
    res.json(ret)
})
app.get('/qf/*', async function (req, res) {
    const para = req.params[0]
    const from = req.query['from']
    const ret = await getAllItems(para, true, from)
    res.json(ret)
})
app.get('/keys/:domains', async (req, res) => {

})
app.get('/user/:account', async function (req, res) {
    const account = req.params['account']
    const resolver = indexers.resolver
    const ret = await resolver.readUser(account)
    res.json(ret)
})
app.get('/fetchtx/:txid', async (req, res) => {
    const txid = req.params['txid']
    handleNewTx({ txid, force: true })
    res.end("ok")
})
app.get('/deletetx/:txid', async (req, res) => {
    const txid = req.params['txid']
    indexers.db.deleteTransaction(txid)
    res.end("ok")
})

app.post('/sendTx', async function (req, res) {
    const obj = req.body;
    console.log("sendTx got:", obj)
    const ret = await Nodes.sendNewTx(obj)
    res.json(ret);
});
async function handleNewTx({ txid, force = false }) {
    let db = indexers.db
    if (!db.hasTransaction(txid) || force) {
        const data = await Nodes.getTx(txid)
        if (data) {
            console.log("handleNewTx:", txid)
            await indexers.indexer.addTxFull({ txid: txid, sigs: data.tx.sigs, rawtx: data.tx.rawtx || data.rawtx, time: data.tx.time, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, force, chain: data.tx.chain })
        }
    }
}
function save_pr(body, isNotify) {
    var data = JSON.stringify(body);
    var id = body.id;
    let dir = Path.join(__dirname, "/tx/");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    dir += today_folder;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    let filename = dir + id;
    if (isNotify) filename += ".no";

    console.log("save relay data:" + data)
    var ret = fs.writeFileSync(filename, data);

    fs.remove(Path.join(__dirname, "/tx/" + last_folder));
}
app.post('/relay/save', (req, res) => {
    const IP = getClientIp(req);
    console.log("Save relay IP:", IP);
    save_pr(req.body, false);
    res.send({ err: 0 });
})
function get_pr(id, isNotify) {
    let filename = Path.join(__dirname, "/tx/" + today_folder + id);
    //log(id);
    if (isNotify) filename += ".no";
    try {
        let data = fs.readFileSync(filename);
        return data;
    } catch (e) {
        //log(e.message);
    }
    return null;
}
app.get('/relay/get/:id', (req, res) => {
    const notify = req.query.notify ? true : false;
    let id = req.params['id'];
    let data = get_pr(id, notify);
    if (data) {
        res.end(data);
        return;
    }
    res.end("404");
})

app.post('/relay/notify', async (req, res) => {
    const result = req.body;
    console.log("got notify,result=", result);
    save_pr(req.body, true);
    if (result.ack_url) res.end("200");
    else res.json({ code: 0, message: "ok" });
})
app.get('/nodes', async (_, res) => {
    const lib = await coinfly.create('bsv')
    const pkey = CONFIG.key ? await lib.getPublicKey(CONFIG.key) : "NotSet"
    const s = CONFIG.server
    const serverUrl = s.publicUrl//(s.https ? "https://" : "http://") + s.domain + (s.https ? "" : ":" + s.port)
    const nodes = await Nodes.listAllNodes()
    res.json(!s.hideFromList ? nodes.concat([{ id: serverUrl, pkey, weight: 50 }]) : nodes)
})
app.get('/sub/:domain/', async (req, res) => {
    const domain = req.params['domain']
    const session = await createSession(req, res);
    let db = indexers.db;
    db.subscribe(domain, session)
    req.on("close", () => {
        res.end()
        console.log("one sub closed")
    })
})
app.get('/pubsub/sub/:topic', async (req, res) => {
    const topic = req.params['topic']
    const session = await createSession(req, res);
    indexers.pubsub.subscribe(topic, session)
    req.on("close", () => {
        res.end()
        console.log("one sub closed")
    })
})
app.get('/pubsub/pub/:topic/:msg', async (req, res) => {
    const topic = req.params['topic']
    const msg = req.params['msg']
    indexers.pubsub.publish(topic, msg)
    res.json({ code: 0 })
})
let handlingMap = {}
app.get('/notify', async function (req, res) {
    const { id, cmd, data } = req.query
    if (id && handlingMap[id]) {
        res.end('done')
        return
    }
    if (objLen(handlingMap) > 1000) self.handlingMap = {}
    handlingMap[id] = true
    const para = JSON.parse(data)
    if (cmd === 'publish') {
        indexers.pubsub.publish(para.topic, para.msg)
    }
    res.end('ok')
})
app.get('/p2p/:cmd/', async function (req, res) { //sever to server command
    const cmd = req.params['cmd']
    let ret = { code: 0 }
    console.log("get p2p cmd:", cmd, " params:", req.query)
    if (cmd === 'ping') {
        if (req.query['sign']) {

        }
        ret.msg = "pong";
    }
    if (cmd === "newtx") {
        const d = req.query['data'];
        const para = JSON.parse(d)
        const from = req.query['from']
        handleNewTx(para, from)
    }
    if (cmd === "newnode") {
        const d = req.query['data'];
        const para = JSON.parse(d)
        Nodes.addNode(d)
    }
    if (cmd === 'gettx') {
        const txid = req.query['txid']
        if (txid)
            ret = indexers.db.getFullTx({ txid })
    }
    if (cmd === 'getdata') {
        ret = await indexers.db.readData(req.query['hash'], { string: req.query['string'] })
        if (ret.raw) ret.code = 0
        else ret = { code: 1, msg: "not found" }
    }
    res.json(ret)
})
app.get('/qt/:q', function (req, res) {
    const q = req.params['q']
    const result = indexers.db.queryByTags(q);
    res.json(result);
    return;
});

app.get('/nodeInfo', async (req, res) => {
    let info = { ...CONFIG.server, ...CONFIG.node_info, ...CONSTS.payment };
    info.version = "1.6." + fs.readFileSync(Path.join(__dirname, '/../../../build_number'), 'utf8').trim();
    info.tld = CONSTS.tld_config
    const lib = await coinfly.create('bsv')
    if (CONFIG.key)
        info.pkey = await lib.getPublicKey(CONFIG.key)
    info.statusHash = indexers.db.readConfig('txdb', 'statusHash')
    info.height = indexers.db.readConfig('txdb', 'height')
    info.chainid = CONFIG.chainid
    res.json(info);
})
app.get(`/tld`, function (req, res) {

    res.json(CONSTS.tld_config);
});
app.get('/onSale', (req, res) => {
    res.json(indexers.db.getSellDomains())
})
app.get('/queryTX', async (req, res) => {
    const fromTime = req.query['from']
    const toTime = req.query['to']
    const height = req.query['height']
    if (height) {
        res.json(await indexers.db.getBlockTxs(height))
    } else {
        res.json(await indexers.db.queryTX(fromTime ? fromTime : 0, toTime ? toTime : -1))
    }

})
app.get('/getBlocks', async (req, res) => {
    const from = req.query['from']
    const to = req.query['to'] ? req.query['to'] : from

    const ret = indexers.db.getBlocks(from, to)
    res.json(ret)
})

app.get('/admin', async (req, res) => {
    const { Util, db } = indexers
    const cmd = req.query['cmd']
    if (!CONFIG.adminKey || CONFIG.adminKey != req.query['key']) {
        res.end('no access')
        return
    }
    switch (cmd) {
        case 'resetdb': db.resetDB(); break;
        case 'resetblocks': {
            db.resetBlocks()
            indexers.shutdown()
            break;
        }
        case 'pulltx': db.pullNewTx(100); break;
        case 'vdb': db.verifyTxDB(); break;
        case 'restoredm': db.restoreLastGoodDomainDB(); break;
        case 'pnpm': {
            const result = Util.runNpmUpdate(indexers)
            res.end(result)
            return
        }
        case 'update': {
            const result = Util.runNodeUpdate(indexers)
            res.end(result)
            return;
        }
    }
    // await db.saveKey({ key: "test", value: "11111111jjj111111111111", domain: "test.a", tags: { name: 'xx', cap: 123 }, ts: 123322222 })
    // await db.readKey("test.test.a")
    await Util.downloadFile("https://api.nbdomain.com/files/bk_txs.db", Path.join(__dirname, "/test.db"))
    res.end("ok")
})
app.get('/reverify', async (req, res) => {
    const txid = req.query['txid']
    const ret = indexers.db.getFullTx({ txid })
    const tx = ret.tx
    indexers.indexer.addTxFull({ txid: tx.txid, sigs: tx.sigs, rawtx: tx.rawtx, txTime: tx.txTime, force: true, chain: tx.chain })
    res.end("ok")
})
app.get('/dataCount', (req, res) => {
    res.json(indexers.db.getDataCount())
})
app.get('/getData', (req, res) => {
    const txid = req.query['txid']
    const ret = indexers.db.getFullTx({ txid })
    res.json(ret)
})
app.get('/find_domain', (req, res) => {
    var addr = req.query.address;
    let result = indexers.db.findDomains({ address: addr });
    const arr = []
    result.forEach(item => {
        const dd = item.domain.split('.')
        arr.push({ nid: dd[0], tld: dd[1], domain: item.domain })
    })

    res.json({
        code: 0,
        message: "OK",
        obj: arr
    })

})
app.get('/findDomain', function (req, res) {
    try {
        let addr = req.query.address, result = [];
        if (addr) {
            const arrAdd = addr.split(',')
            for (const addr of arrAdd) {
                result.push({ address: addr, result: indexers.db.findDomains({ address: addr }) });
            }
        } else if (req.query.option) {
            let option = JSON.parse(req.query.option)
            result = indexers.db.findDomains(option);
        }
        res.json({
            code: 0,
            message: "OK",
            obj: result
        })
    } catch (err) {
        let resp = {
            code: 99,
            message: err.message
        };
        console.log(err);
        res.json(resp);
        return;
    }
});


//-----------------------Blockchain tools---------------------------------//
app.get('/tools/:chain/balance/:address', async (req, res) => {
    const address = req.params['address']
    const chain = req.params['chain']
    let addr = Util.parseJson(address)
    if (!addr) addr = address
    const ret = await Util.getBalance(addr, chain)
    res.json(ret)
})
app.get('/tools/:chain/status/:txid', async (req, res) => {
    const txid = req.params['txid']
    const chain = req.params['chain']
    const ret = await Util.getTxStatus(txid, chain)
    res.json(ret)
})
app.get('/tools/market/rates/:symbol', async (req, res) => {
    const symbol = req.params['symbol']
    const url = "https://api.huobi.pro/market/trade?symbol=" + symbol
    try {
        let ret = await axios.get(url)
        if (ret && ret.data) {
            ret = ret.data.tick.data[0].price
        }
        res.json({ [symbol]: ret })
    } catch (e) {
        res.json({ err: e.message })
    }
})

module.exports = function (env) {
    indexers = env.indexers;
    CONFIG = indexers.config
    return new Promise((resolve) => {
        const server = app.listen(0, function () {
            const port = server.address().port;
            console.log(`API server started on port ${port}...`)
            resolve(port);
        })
    })
}