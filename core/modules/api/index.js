/**
 * NBDomain HTTP server for 3rd party.
 */
var url = require('url');
const { CONFIG } = require('../../config')
const CONSTS = require('../../const')
var express = require('express');
var bodyParser = require("body-parser");
var cors = require('cors');
const { ERR } = require('../../def')
const { Util } = require('../../util.js')

const { json } = require('body-parser');
const fs = require("fs-extra");
const axios = require('axios');
const Parser = require('../../parser')
const { Nodes } = require('../../nodes')
var app = express();
const { createSession } = require("better-sse");
const coinfly = require("coinfly")


app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));

let indexers = null;
const today = new Date();

const day = today.getDate();
const today_folder = day % 2 == 0 ? "even/" : "odd/";
const last_folder = day % 2 == 0 ? "odd/" : "even/";

const auth = async (req, res) => {
    /*try {
        const token = req.header('Authorization').replace('Bearer ', '').trim()
        req.token = token
        let authConfig = JSON.parse(fs.readFileSync(CONFIG.auth_file));
        if (!(token in authConfig.keys && authConfig.keys[token].enable == 1)) {
            throw new Error()
        }
        return true;
    } catch (error) {
        console.log(error)
        res.status(401).send({ error: 'Please authenticate!' })
    }
    return false;*/
    return true;
}

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
    if (!auth(req, res)) {
        return;
    }
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
    const ret = await Nodes.sendNewTx(obj)
    res.json(ret);
});
async function handleNewTx(para, from, force = false) {
    let db = indexers.db
    if (!db.isTransactionParsed(para.txid, false) || force) {
        const data = await Nodes.getTx(para.txid, from)
        if (data) {
            console.log("handleNewTx:", para.txid)
            await indexers.indexer.addTxFull({ txid: para.txid, rawtx: data.tx.rawtx || data.rawtx, time: data.tx.time, txTime: data.tx.txTime, oDataRecord: data.oDataRecord, chain: data.tx.chain })
        }
    }
}
function save_pr(body, isNotify) {
    var data = JSON.stringify(body);
    var id = body.id;
    let dir = __dirname + "/tx/";
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    dir += today_folder;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    let filename = dir + id;
    if (isNotify) filename += ".no";

    console.log("save relay data:" + data)
    var ret = fs.writeFileSync(filename, data);

    fs.remove(__dirname + "/tx/" + last_folder);
}
app.post('/relay/save', (req, res) => {
    const IP = getClientIp(req);
    console.log("Save relay IP:", IP);
    save_pr(req.body, false);
    res.send({ err: 0 });
})
function get_pr(id, isNotify) {
    let filename = __dirname + "/tx/" + today_folder + id;
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
    const pkey = await lib.getPublicKey(CONFIG.key)
    const s = CONFIG.server
    const serverUrl = s.publicUrl//(s.https ? "https://" : "http://") + s.domain + (s.https ? "" : ":" + s.port)
    const nodes = Nodes.getNodes(false)
    res.json(serverUrl ? nodes.concat([{ id: serverUrl, pkey, weight: 50 }]) : nodes)
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
app.get('/queryKeys', function (req, res) {
    const num = req.query['num'] ? req.query['num'] : 50;
    const tags = req.query['tags'] ? req.query['tags'] : null;
    const from = req.query['from'] ? req.query['from'] : null;
    const includeHistory = req.query['includeHistory'] ? req.query['includeHistory'] : 0;
    const result = indexers.db.queryKeys({ v: 1, num: num, tags: tags, from: from });
    if (includeHistory == 0) {
        result.data = result.data.filter(item => item.key.indexOf('/') == -1)
    }
    res.json(result);
    return;
});
app.get('/queryTags', function (req, res) {
    const exp = req.query['exp'];
    const result = indexers.db.queryTags(exp ? exp : null);
    res.json(result);
    return;
});
app.get('/nodeInfo', async (req, res) => {
    let info = { ...CONFIG.server, ...CONSTS.node_info };
    info.version = "1.6." + fs.readFileSync(__dirname + '/../../../build_number', 'utf8').trim();
    info.tld = CONSTS.tld_config
    const lib = await coinfly.create('bsv')
    if (CONFIG.key)
        info.pkey = await lib.getPublicKey(CONFIG.key)
    info.statusHash = indexers.db.readConfig('txdb', 'statusHash')
    info.height = indexers.db.readConfig('txdb', 'height')
    res.json(info);
})
app.get(`/tld`, function (req, res) {
    if (!auth(req, res)) {
        return;
    }
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

app.get('/test', async (req, res) => {
    /*    let sql = "select * from ar_tx"
        const ret = indexers.db.txdb.prepare(sql).all()
        console.log(ret)
        console.log("count:",ret.length)
        res.end("ok")*/
    //res.json(indexers.db.getAllPaytx('register'))
    //const { rpcHandler } = require('../../nodeAPI')
    //const para = { txid: "c1dc64ef85841f0f3ad74576bbaa2b5b639a17ac9dd1dda1979ef4b64b525e8d" }
    //await rpcHandler.handleNewTx({ indexers, para, from: "https://tnode.nbdomain.com", force: true })
    //indexers.bsv.add("3c46dd05ac372382d44e5e0a430b59a97c1f4224ccf98032a7b46e1b56fca7f9")
    //res.json(indexers.db.getDataCount())
    //await indexers.db.verifyTxDB('bsv')
    //await indexers.db.verifyTxDB('ar')
    //indexers.ar.reCrawlAll()
    //console.log(indexers.db.findDomains({ time: { from: (Date.now() / 1000) - 60 * 60 * 24 } }))
    //indexers.db.resetDB()
    //Nodes.pullNewTxs()
    //const ntx = +req.query['ntx']
    //const block = await indexers.blockMgr.createBlock(0, ntx)
    //indexers.db.dropTable('blocks')
    //indexers.db.deleteBlock(req.query['height'])
    const db = indexers.db
    const cmd = req.query['cmd']
    switch (cmd) {
        case 'resetdb': db.resetDB(); break;
        case 'resetblocks': db.dropTable('blocks'); break;
        case 'pulltx': db.pullNewTx(100); break;
        case 'vdb': db.verifyTxDB(); break;
    }
    Nodes.sendNewTx({})
    res.end("ok")
})
app.get('/reverify', async (req, res) => {
    const txid = req.query['txid']
    const ret = indexers.db.getFullTx({ txid })
    const tx = ret.tx
    indexers.indexer.addTxFull({ txid: tx.txid, rawtx: tx.rawtx, time: tx.time, force: true, chain: tx.chain })
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
    return new Promise((resolve) => {
        const server = app.listen(0, function () {
            const port = server.address().port;
            console.log(`API server started on port ${port}...`)
            resolve(port);
        })
    })
}