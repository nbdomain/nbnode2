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
const { bsv } = require('nbpay');
const { add } = require('bsv/lib/networks');


app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));

let indexers = null;
let bsv_resolver = null;
let ar_resolver = null;
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

    if (!domain) {
        res.json({ code: ERR.NOTFOUND, message: `nid missing!` });
        return;
    }
    try {
        const resolver = indexers.resolver(Util.getchain(domain))
        if (!resolver) {
            throw "unsupported domain:" + domain
        }
        const ret = await resolver.readDomain(domain, f);
        res.json(ret);
    } catch (err) {
        console.error(err);
        res.json({ code: 99, message: err.message });
    }
});
async function getAllItems(para, forceFull = false, from = null) {
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
                    const resolver = indexers.resolver(Util.getchain(his[0]))
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
        const resolver = indexers.resolver(Util.getchain(dd[0]))
        if (!resolver) continue;
        const result = await resolver.readDomain(dd[0], forceFull, dd[1])
        if (from && result.obj.ts <= from) continue
        ret.push(result)
    }
    return ret
}
app.get('/q/*', async function (req, res) {
    const para = req.params[0]
    const from = req.query['from']
    const ret = await getAllItems(para, false, +from)
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
    const resolver = indexers.resolver(Util.getchain(account))
    const ret = await resolver.readUser(account)
    res.json(ret)
})

app.get('/util/verify', async function (req, res) {
    try {
        const domain = req.query['domain']
        let publicKey = req.query['publicKey']
        const strSig = req.query['sig']
        const data = req.query['data']
        if (domain) {
            const ret = await bsv_resolver.readDomain(domain, false)
            if (ret.code != 0) {
                res.json({ code: -1, message: ret.message })
                return
            }
            publicKey = ret.obj.owner_key
        }
        let sig = bsv.crypto.Signature.fromString(strSig)
        let pubKey = bsv.PublicKey.fromString(publicKey)
        let hash2 = bsv.crypto.Hash.sha256(bsv.deps.Buffer.from(data, 'hex'))
        res.json({ code: bsv.crypto.ECDSA.verify(hash2, sig, pubKey) ? 0 : -1 })

    } catch (e) {
        res.json({ code: -1, message: e.message })
    }
})

app.post('/sendTx', async function (req, res) {
    const obj = req.body;
    let chain = 'bsv'
    if (obj.chain == 'ar') chain = 'ar'
    console.log("got obj:", obj)
    if (!obj.oData) {
        console.error("old sendtx format")
    }
    let ret = await (Parser.get(chain).parseTX({ rawtx: obj.rawtx, oData: obj.oData, height: -1, verify: true }));
    if (ret.code != 0 || !ret.obj.output || ret.obj.output.err) {
        console.error("parseRaw error err:", ret)
        res.json({ code: -1, message: ret.msg })
        return
    }
    if (obj.more_rawtx) {
        for (const raw of obj.more_rawtx) { //if there are more 
            const rr = await Util.sendRawtx(raw, chain);
            if (rr.code == 0) {
                console.log("send more tx successfully. txid:", rr.txid);
            }
            else {
                console.error("send more tx failed:", rr)
                res.json(rr)
                return
            }
        }
    }
    const ret1 = await Util.sendRawtx(obj.rawtx, chain);
    if (ret1.code == 0) {
        console.log("send tx successfully. txid:", ret1.txid)
        if (ret.obj && ret.obj.oHash) {
            console.log("saving oData... owner:", ret.obj.output.domain)
            await indexers.db.saveData({ data: obj.oData, owner: ret.obj.output.domain, time: ret.obj.ts, from: "api/sendtx" })
        }
        indexers.get(chain)._onMempoolTransaction(ret1.txid, obj.rawtx)
        Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: ret1.txid, chain: chain }) })
    } else {
        console.log("send tx failed")
    }
    res.json(ret1);
});
async function handleNewTx(para, from, force = false) {
    let db = indexers.db, indexer = indexers.bsv;
    if (para.chain == "ar") {
        indexer = indexers.ar
    }
    const chain = para.chain ? para.chain : 'bsv'
    if (!db.hasTransaction(para.txid, chain) || force) {
        const data = await Nodes.getTx(para.txid, from, chain)
        if (data) {
            const item = data.oDataRecord
            const ret = await (Parser.get(chain).parse({ rawtx: data.rawtx, oData: item?.raw, height: -1 }));
            if (ret.code == 0 && ret.rtx?.oHash === item.hash)
                await indexers.db.saveData({ data: item.raw, owner: item.owner, time: item.time, hash: item.hash, from: "api/handleNewTx" })
            else {
                console.error("wrong rawtx format. ret:", ret)
            }
            indexer._onMempoolTransaction(para.txid, data.rawtx)
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
app.get('/nodes', (_, res) => {
    res.json(Nodes.getNodes())
})
app.get('/sub/:domain/', async (req, res) => {
    const domain = req.params['domain']
    const session = await createSession(req, res);
    let db = bsv_resolver.db;
    if (domain.indexOf('.a') != -1) {
        db = ar_resolver.db
    }
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
        let chain = req.query['chain'] ? req.query['chain'] : 'bsv'
        let indexer = chain == 'bsv' ? indexers.bsv : indexers.ar
        ret.rawtx = indexer.rawtx(req.query['txid'])
        if (!ret.rawtx) {
            ret.code = 1; ret.msg = 'not found';
        } else {
            const attrib = Parser.get(chain).getAttrib({ rawtx: ret.rawtx });
            if (attrib.hash) {
                ret.oDataRecord = indexers.db.readData(attrib.hash)
            }
        }
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
app.get('/nodeInfo', (req, res) => {
    let info = { ...CONFIG.node_info, ...CONSTS.node_info };
    info.version = "1.5.1." + fs.readFileSync(__dirname + '/../../../build_number', 'utf8').trim();
    info.tld = CONSTS.tld_config
    //info.dataCount = indexers.db.getDataCount()
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
    const chain = req.query['chain']
    const resolver = indexers.get(chain).resolver
    res.json(await resolver.readNBTX(fromTime ? fromTime : 0, toTime ? toTime : -1))
})
app.get('/test', async (req, res) => {
    /*    let sql = "select * from ar_tx"
        const ret = indexers.db.txdb.prepare(sql).all()
        console.log(ret)
        console.log("count:",ret.length)
        res.end("ok")*/
    //res.json(indexers.db.getAllPaytx('register'))
    //res.json(await handleNewTx({ chain: 'bsv', txid: "c1dc64ef85841f0f3ad74576bbaa2b5b639a17ac9dd1dda1979ef4b64b525e8d" }, "https://tnode.nbdomain.com", true))
    //indexers.bsv.add("3c46dd05ac372382d44e5e0a430b59a97c1f4224ccf98032a7b46e1b56fca7f9")
    //res.json(indexers.db.getDataCount())
    //await indexers.db.verifyTxDB('bsv')
    //await indexers.db.verifyTxDB('ar')
    //indexers.ar.reCrawlAll()
    //console.log(indexers.db.findDomains({ time: { from: (Date.now() / 1000) - 60 * 60 * 24 } }))
    indexers.db.resetDB()
    //Nodes.startTxSync(indexers)
    res.end("ok")
})
app.get('/dataCount', (req, res) => {
    res.json(indexers.db.getDataCount())
})
app.get('/getData', (req, res) => {
    const txid = req.query['txid']
    const chain = req.query['chain'] ? req.query['chain'] : 'bsv'
    const tx = indexers.db.getTransaction(txid, chain);
    if (tx && tx.bytes)
        delete tx.bytes
    let ret = {
        tx: tx
    }

    ret.rawtx = indexers.db.getRawTransaction(txid, chain)

    if (ret.rawtx) {
        ret.attrib = Parser.get(chain).getAttrib({ rawtx: ret.rawtx });
        if (ret.attrib.hash) {
            ret.oDataRecord = indexers.db.readData(ret.attrib.hash)
        }
    }
    res.json(ret)
})
app.get('/find_domain', (req, res) => {
    var addr = req.query.address;
    let result = bsv_resolver.db.findDomains({ address: addr });
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
            result = bsv_resolver.db.findDomains({ address: addr });
        } else if (req.query.option) {
            let option = JSON.parse(req.query.option)
            result = bsv_resolver.db.findDomains(option);
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
    bsv_resolver = indexers.bsv ? indexers.bsv.resolver : null;
    ar_resolver = indexers.ar ? indexers.ar.resolver : null
    return new Promise((resolve) => {
        const server = app.listen(0, function () {
            const port = server.address().port;
            console.log(`API server started on port ${port}...`)
            resolve(port);
        })
    })
}